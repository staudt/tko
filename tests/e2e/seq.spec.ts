import { expect, test, type Page } from '@playwright/test';
import { center, commands, startEngine, Touch } from './helpers';

type Packed = { keys: ArrayLike<number>; lockA: ArrayLike<number>; len: ArrayLike<number> };
/** The latest 'pattern' command for pattern `pat` (undefined if none). */
async function lastPattern(page: Page, pat = 0): Promise<Packed | undefined> {
  const cs = await commands(page);
  const c = cs.filter((x) => x.type === 'pattern' && x.index === pat).pop();
  return c?.data as Packed | undefined;
}
const patternCount = async (page: Page, pat = 0) => (await commands(page)).filter((x) => x.type === 'pattern' && x.index === pat).length;
const NO_LOCK = -128;

async function tapCtl(t: Touch, page: Page, loc: ReturnType<Page['getByTestId']>, holdMs = 40) {
  const c = await center(loc);
  await t.down(9, c.x, c.y);
  await page.waitForTimeout(holdMs);
  await t.up(9);
}
const btn = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test.describe('sequencer (touch)', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch only');

  test('write mode: tap a step toggles it; undo reverts', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await tapCtl(t, page, btn(page, 'WRITE'));
    await expect(btn(page, 'WRITE')).toHaveAttribute('aria-pressed', 'true');
    // sound 1 (index 0), step 5 (index 4)
    const n0 = await patternCount(page);
    await tapCtl(t, page, page.getByTestId('pad-5'));
    await expect.poll(async () => (await lastPattern(page))?.keys[0 * 16 + 4]).toBeGreaterThan(0);
    await expect(page.getByTestId('pad-5')).toHaveClass(/\blit\b/);
    // no live note was played as a pad press (only the audition)
    await tapCtl(t, page, page.getByTestId('pad-5'));
    await expect.poll(async () => (await lastPattern(page))?.keys[4]).toBe(0);
    // toggle on again, then undo
    await tapCtl(t, page, page.getByTestId('pad-5'));
    await expect.poll(async () => (await lastPattern(page))?.keys[4]).toBeGreaterThan(0);
    const n1 = await patternCount(page);
    expect(n1).toBeGreaterThan(n0);
    await page.getByRole('button', { name: 'Undo' }).tap();
    await expect.poll(async () => (await lastPattern(page))?.keys[4]).toBe(0);
    await page.getByRole('button', { name: 'Redo' }).tap();
    await expect.poll(async () => (await lastPattern(page))?.keys[4]).toBeGreaterThan(0);
  });

  test('WRITE held + pad chooses the key new steps use, and it is remembered', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    // select drum sound 10 (index 9)
    const snd = await center(btn(page, 'SOUND'));
    const p10 = await center(page.getByTestId('pad-10'));
    await t.down(1, snd.x, snd.y);
    await t.down(2, p10.x, p10.y);
    await t.up(2);
    await t.up(1);
    // hold WRITE + pad 4 → write key 3 (mode stays off)
    const w = await center(btn(page, 'WRITE'));
    const p4 = await center(page.getByTestId('pad-4'));
    await t.down(1, w.x, w.y);
    await t.down(2, p4.x, p4.y);
    await expect(page.getByTestId('pad-4')).toHaveClass(/\blit\b/);
    await t.up(2);
    await t.up(1);
    await expect(btn(page, 'WRITE')).toHaveAttribute('aria-pressed', 'false');
    // WRITE on, tap steps 1 and 9 → both use key 3
    await tapCtl(t, page, btn(page, 'WRITE'));
    await expect(page.getByTestId('readout')).toContainText('WRITE ·');
    await tapCtl(t, page, page.getByTestId('pad-1'));
    await tapCtl(t, page, page.getByTestId('pad-9'));
    await expect.poll(async () => (await lastPattern(page))?.keys[9 * 16 + 8]).toBe(1 << 3);
    expect((await lastPattern(page))?.keys[9 * 16 + 0]).toBe(1 << 3);
    // remembered across reloads
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tko.lastKey') ?? '[]')[9])).toBe(3);
  });

  test('hold a step + drag knob A sets a pitch lock', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await tapCtl(t, page, btn(page, 'WRITE'));
    const p = await center(page.getByTestId('pad-3'));
    const k = await center(page.getByTestId('knob-a'));
    await t.down(1, p.x, p.y);
    await t.down(2, k.x, k.y);
    for (let i = 1; i <= 10; i++) await t.move(2, k.x, k.y - i * 8);
    await expect(page.getByTestId('knob-a-label')).toContainText('LOCK PITCH +');
    await expect.poll(async () => (await lastPattern(page))?.lockA[2]).toBeGreaterThan(0);
    await t.up(2);
    await t.up(1);
    // releasing after a knob drag must not toggle the step off
    await page.waitForTimeout(100);
    expect((await lastPattern(page))!.keys[2]).toBeGreaterThan(0);
    // double tap on the knob while holding removes the lock
    await t.down(1, p.x, p.y);
    await t.down(2, k.x, k.y);
    await t.up(2);
    await t.down(2, k.x, k.y);
    await t.up(2);
    await expect.poll(async () => (await lastPattern(page))?.lockA[2]).toBe(NO_LOCK);
    await t.up(1);
  });

  test('hold step 2 + tap step 6 sets length 4', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await tapCtl(t, page, btn(page, 'WRITE'));
    await tapCtl(t, page, page.getByTestId('pad-2'));
    const a = await center(page.getByTestId('pad-2'));
    const b = await center(page.getByTestId('pad-6'));
    await t.down(1, a.x, a.y);
    await t.down(2, b.x, b.y);
    await t.up(2);
    await t.up(1);
    await expect.poll(async () => (await lastPattern(page))?.len[1]).toBe(4);
    expect((await lastPattern(page))!.keys[5]).toBe(0);
  });

  test('long-press a step opens the Step sheet; tap a key sets it and closes', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await tapCtl(t, page, btn(page, 'WRITE'));
    const p = await center(page.getByTestId('pad-7'));
    await t.down(1, p.x, p.y);
    await page.waitForTimeout(650);
    await expect(page.getByRole('dialog', { name: 'Step' })).toBeVisible();
    await t.up(1);
    // opening the sheet created nothing
    await page.getByTestId('key-5').tap();
    await expect.poll(async () => (await lastPattern(page))?.keys[6]).toBe(16);
    await expect(page.locator('.sheet-wrap.open')).toHaveCount(0);
  });

  test('hold PATTERN + pads 2, 4 -> chain [1,3]; applied on release', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    const f = await center(btn(page, 'PATTERN'));
    const a = await center(page.getByTestId('pad-2'));
    const b = await center(page.getByTestId('pad-4'));
    await t.down(1, f.x, f.y);
    await t.down(2, a.x, a.y);
    await t.up(2);
    await t.down(2, b.x, b.y);
    await t.up(2);
    const before = (await commands(page)).filter((c) => c.type === 'chain').length;
    expect(before).toBe(1); // only the initial sync
    await t.up(1);
    await expect.poll(async () => (await commands(page)).filter((c) => c.type === 'chain').pop()?.patterns).toEqual([1, 3]);
    await expect(page.getByTestId('lcd')).toHaveAttribute('data-pat', '2');
    await expect(page.locator('.sheet-wrap.open')).toHaveCount(0);
  });

  test('pattern sheet: select, copy, paste, clear', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await tapCtl(t, page, btn(page, 'WRITE'));
    await tapCtl(t, page, page.getByTestId('pad-1'));
    await tapCtl(t, page, btn(page, 'PATTERN'));
    await expect(page.getByRole('dialog', { name: 'Patterns' })).toBeVisible();
    await page.getByTestId('act-copy').tap();
    await page.getByTestId('pcard-3').tap();
    await expect(page.getByTestId('lcd')).toHaveAttribute('data-pat', '3');
    await page.getByTestId('act-paste').tap();
    await expect.poll(async () => (await lastPattern(page, 2))?.keys[0]).toBeGreaterThan(0);
    await page.getByTestId('act-clear-pattern').tap();
    await expect.poll(async () => (await lastPattern(page, 2))?.keys[0]).toBe(0);
  });

  test('BPM sheet: 4 taps 500 ms apart -> ~120 BPM', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await tapCtl(t, page, btn(page, 'BPM'));
    await expect(page.getByRole('dialog', { name: 'Tempo' })).toBeVisible();
    await page.getByTestId('preset-80').tap();
    await expect.poll(async () => (await commands(page)).filter((c) => c.type === 'tempo').pop()?.bpm).toBe(80);
    const c = await center(page.getByTestId('tap-pad'));
    const t0 = Date.now();
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(Math.max(0, t0 + i * 500 - Date.now()));
      await t.down(3, c.x, c.y);
      await t.up(3);
    }
    await expect.poll(async () => (await commands(page)).filter((c) => c.type === 'tempo').pop()?.bpm as number).toBeGreaterThan(114);
    const bpm = (await commands(page)).filter((c) => c.type === 'tempo').pop()?.bpm as number;
    expect(bpm).toBeLessThan(126);
  });

  test('hold BPM + pad 12 -> master volume 12/16', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    const f = await center(btn(page, 'BPM'));
    const p = await center(page.getByTestId('pad-12'));
    await t.down(1, f.x, f.y);
    await t.down(2, p.x, p.y);
    await t.up(2);
    await t.up(1);
    await expect.poll(async () => (await commands(page)).filter((c) => c.type === 'volume').pop()?.gain).toBe(0.75);
    await expect(page.locator('.sheet-wrap.open')).toHaveCount(0);
  });
});

test.describe('sequencer layout', () => {
  test('fits 360x640 in write mode and with each sheet open', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await startEngine(page).catch(() => {});
    const noScroll = async () => {
      const m = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(m.sh).toBeLessThanOrEqual(m.ch);
      expect(m.sw).toBeLessThanOrEqual(m.cw);
    };
    const sheetFits = async (name: string) => {
      const b = (await page.getByRole('dialog', { name }).boundingBox())!;
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height).toBeLessThanOrEqual(640.5);
      expect(b.x + b.width).toBeLessThanOrEqual(360.5);
    };
    const t = await Touch.open(page);
    await tapCtl(t, page, btn(page, 'WRITE'));
    await tapCtl(t, page, page.getByTestId('pad-1'));
    await noScroll();
    for (let k = 1; k <= 16; k++) {
      const b = (await page.getByTestId(`pad-${k}`).boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(56);
      expect(b.y + b.height).toBeLessThanOrEqual(640);
    }
    for (const [name, open] of [
      ['Patterns', () => tapCtl(t, page, btn(page, 'PATTERN'))],
      ['Tempo', () => tapCtl(t, page, btn(page, 'BPM'))],
      ['Step', async () => {
        const p = await center(page.getByTestId('pad-1'));
        await t.down(1, p.x, p.y);
        await page.waitForTimeout(650);
        await t.up(1);
      }],
    ] as const) {
      await open();
      await expect(page.getByRole('dialog', { name })).toBeVisible();
      await page.waitForTimeout(300);
      await noScroll();
      await sheetFits(name);
      await page.locator('.sheet-wrap.open .backdrop').dispatchEvent('pointerdown');
      await expect(page.locator('.sheet-wrap.open')).toHaveCount(0);
    }
  });
});
