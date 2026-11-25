import { expect, test, type Page } from '@playwright/test';
import { center, commands, startEngine, Touch } from './helpers';
import { scaleOffsets } from '../../src/store/scales';

type Packed = { keys: ArrayLike<number>; fx: ArrayLike<number> };
async function lastPattern(page: Page, pat = 0): Promise<Packed | undefined> {
  const c = (await commands(page)).filter((x) => x.type === 'pattern' && x.index === pat).pop();
  return c?.data as Packed | undefined;
}
/** Filled steps of sound 1 (lane 0) in pattern 0. */
const lane0 = async (page: Page) => {
  const d = await lastPattern(page);
  let n = 0;
  for (let i = 0; i < 16; i++) n += d?.keys[i] ? 1 : 0;
  return n;
};
async function tapCtl(t: Touch, page: Page, loc: ReturnType<Page['getByTestId']>, holdMs = 40) {
  const c = await center(loc);
  await t.down(9, c.x, c.y);
  await page.waitForTimeout(holdMs);
  await t.up(9);
}
const btn = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test.describe('notes, scales, step picker, erase, fx record (touch)', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch only');

  test('key and scale selectors change the project and the engine', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await tapCtl(t, page, btn(page, 'SOUND'));
    await expect(page.getByRole('dialog', { name: 'Sounds' })).toBeVisible();
    await page.getByTestId('chip-key').tap();
    await page.getByTestId('opt-key-2').tap();
    await page.getByTestId('chip-scale').tap();
    await page.getByTestId('opt-scale-minPent').tap();
    await expect(page.getByTestId('chip-key')).toContainText('D');
    await expect(page.getByTestId('chip-scale')).toContainText('Minor pentatonic');
    await expect
      .poll(async () => (await commands(page)).filter((c) => c.type === 'scale').pop())
      .toMatchObject({ key: 2, offsets: scaleOffsets('minPent') });
  });

  test('melodic pads show note names; key and scale change them', async ({ page }) => {
    await startEngine(page);
    const lbl = (k: number) => page.getByTestId(`pad-${k}`).locator('.lbl');
    await expect(lbl(1)).toHaveText(/^[A-G]#?-?\d$/);
    const before = await lbl(2).textContent();
    const t = await Touch.open(page);
    await tapCtl(t, page, btn(page, 'SOUND'));
    await page.getByTestId('chip-scale').tap();
    await page.getByTestId('opt-scale-minPent').tap();
    await page.locator('.sheet-wrap.open .backdrop').dispatchEvent('pointerdown');
    await expect(page.locator('.sheet-wrap.open')).toHaveCount(0);
    await expect(lbl(2)).not.toHaveText(before!);
    await expect(page.getByTestId('pad-1')).toHaveClass(/\btonic\b/);
  });

  test('step sheet: tap sets a single key and closes; hold adds a chord member', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await tapCtl(t, page, btn(page, 'WRITE'));
    const openSheet = async () => {
      const p = await center(page.getByTestId('pad-3'));
      await t.down(1, p.x, p.y);
      await page.waitForTimeout(650);
      await expect(page.getByRole('dialog', { name: 'Step' })).toBeVisible();
      await t.up(1);
    };
    await openSheet();
    await expect(page.getByText('Tap = set note · Hold = add to chord')).toBeVisible();
    await page.getByTestId('key-3').tap();
    await expect.poll(async () => (await lastPattern(page))?.keys[2]).toBe(4);
    await expect(page.locator('.sheet-wrap.open')).toHaveCount(0);
    await openSheet();
    const k = await center(page.getByTestId('key-6'));
    await t.down(2, k.x, k.y);
    await page.waitForTimeout(600);
    await t.up(2);
    await expect.poll(async () => (await lastPattern(page))?.keys[2]).toBe(4 | 32);
    await expect(page.getByRole('dialog', { name: 'Step' })).toBeVisible();
    await expect(page.locator('.sheet-wrap.open')).toHaveCount(1);
  });

  test('live erase: REC + pad removes keys while playing; one undo restores', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await tapCtl(t, page, btn(page, 'WRITE'));
    for (let k = 1; k <= 16; k++) await tapCtl(t, page, page.getByTestId(`pad-${k}`));
    await expect.poll(() => lane0(page)).toBe(16);
    await tapCtl(t, page, btn(page, 'WRITE'));
    await tapCtl(t, page, btn(page, 'PLAY'));
    await page.waitForTimeout(300);
    const r = await center(btn(page, 'REC'));
    const p = await center(page.getByTestId('pad-1'));
    const plays = (await commands(page)).filter((c) => c.type === 'play' && c.on).length;
    await t.down(1, r.x, r.y);
    await t.down(2, p.x, p.y);
    await page.waitForTimeout(2300);
    await t.up(2);
    await t.up(1);
    await tapCtl(t, page, btn(page, 'PLAY'));
    expect((await commands(page)).filter((c) => c.type === 'play' && c.on).length).toBe(plays);
    expect(await lane0(page)).toBeLessThanOrEqual(4);
    await expect(btn(page, 'REC')).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('button', { name: 'Undo' }).tap();
    await expect.poll(() => lane0(page)).toBe(16);
  });

  test('FX record: armed + playing, FX + pad 1 writes the fx lane', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await tapCtl(t, page, btn(page, 'REC'));
    await tapCtl(t, page, btn(page, 'PLAY'));
    await page.waitForTimeout(300);
    const f = await center(btn(page, 'FX'));
    const p = await center(page.getByTestId('pad-1'));
    await t.down(1, f.x, f.y);
    await t.down(2, p.x, p.y);
    await page.waitForTimeout(600);
    await t.up(2);
    await t.up(1);
    await expect.poll(async () => Array.from((await lastPattern(page))?.fx ?? []).filter((x) => x === 0).length).toBeGreaterThanOrEqual(2);
    await tapCtl(t, page, btn(page, 'PLAY'));
  });

  test('SAMPLE button: tap and hold + pad show a message, no note', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    const n0 = (await commands(page)).filter((c) => c.type === 'play').length;
    await tapCtl(t, page, btn(page, 'SAMPLE'));
    const s = await center(btn(page, 'SAMPLE'));
    const p = await center(page.getByTestId('pad-4'));
    await t.down(1, s.x, s.y);
    await t.down(2, p.x, p.y);
    await t.up(2);
    await t.up(1);
    expect((await commands(page)).filter((c) => c.type === 'play').length).toBe(n0);
  });

  test('SOUND held: dot shows notes in the edit pattern; card long-press clears the lane', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await tapCtl(t, page, btn(page, 'WRITE'));
    await tapCtl(t, page, page.getByTestId('pad-2'));
    await tapCtl(t, page, btn(page, 'WRITE'));
    const s = await center(btn(page, 'SOUND'));
    await t.down(1, s.x, s.y);
    await expect(page.getByTestId('pad-1').locator('.dot')).toHaveClass(/\bon\b/);
    await expect(page.getByTestId('pad-5').locator('.dot')).not.toHaveClass(/\bon\b/);
    await t.up(1);
    await page.waitForTimeout(300);
    await tapCtl(t, page, btn(page, 'SOUND'));
    await expect(page.getByRole('dialog', { name: 'Sounds' })).toBeVisible();
    const c = await center(page.getByTestId('card-1'));
    await t.down(1, c.x, c.y);
    await page.waitForTimeout(600);
    await t.up(1);
    await expect(page.getByTestId('clear-lane')).toBeVisible();
    await page.getByTestId('clear-lane').tap();
    await expect.poll(() => lane0(page)).toBe(0);
  });

  test('layout: four-button function row fits 360x640', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto('/');
    await expect(page.getByTestId('pad-16')).toBeVisible();
    const m = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(m.sh).toBeLessThanOrEqual(m.ch);
    expect(m.sw).toBeLessThanOrEqual(m.cw);
    const boxes = [];
    for (const n of ['SOUND', 'PATTERN', 'BPM', 'SAMPLE']) {
      const b = (await btn(page, n).boundingBox())!;
      expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
      boxes.push(b);
    }
    for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.x).toBeGreaterThanOrEqual(boxes[i - 1]!.x + boxes[i - 1]!.width - 0.5);
    expect(boxes[3]!.x + boxes[3]!.width).toBeLessThanOrEqual(360);
  });
});
