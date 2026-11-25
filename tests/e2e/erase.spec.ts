import { expect, test, type Page } from '@playwright/test';
import { center, commands, startEngine, Touch } from './helpers';

type Packed = { keys: ArrayLike<number>; fx: ArrayLike<number> };
async function lastPattern(page: Page, pat = 0): Promise<Packed | undefined> {
  const c = (await commands(page)).filter((x) => x.type === 'pattern' && x.index === pat).pop();
  return c?.data as Packed | undefined;
}
const lane0 = async (page: Page) => {
  const d = await lastPattern(page);
  let n = 0;
  for (let i = 0; i < 16; i++) n += d?.keys[i] ? 1 : 0;
  return n;
};
const fxCount = async (page: Page) => Array.from((await lastPattern(page))?.fx ?? []).filter((x) => x >= 0 && x < 255 && x !== -1).length;
async function tapCtl(t: Touch, page: Page, loc: ReturnType<Page['getByTestId']>, holdMs = 40) {
  const c = await center(loc);
  await t.down(9, c.x, c.y);
  await page.waitForTimeout(holdMs);
  await t.up(9);
}
const btn = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const fillLane = async (t: Touch, page: Page) => {
  await tapCtl(t, page, btn(page, 'WRITE'));
  for (let k = 1; k <= 16; k++) await tapCtl(t, page, page.getByTestId(`pad-${k}`));
  await expect.poll(() => lane0(page)).toBe(16);
};

test.describe('ERASE button (touch)', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch only');

  test('ERASE + pad 1 clears sound 1 while stopped, silently; one undo restores', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await fillLane(t, page);
    await tapCtl(t, page, btn(page, 'WRITE'));
    const plays = (await commands(page)).filter((c) => c.type === 'play' && c.on).length;
    const e = await center(btn(page, 'ERASE'));
    const p = await center(page.getByTestId('pad-1'));
    await t.down(1, e.x, e.y);
    await expect(page.getByTestId('pad-1').locator('.dot')).toHaveClass(/\bon\b/);
    await expect(page.getByTestId('pad-5').locator('.dot')).not.toHaveClass(/\bon\b/);
    await t.down(2, p.x, p.y);
    await expect.poll(() => lane0(page)).toBe(0);
    await t.up(2);
    await t.up(1);
    expect((await commands(page)).filter((c) => c.type === 'play' && c.on).length).toBe(plays);
    await page.getByRole('button', { name: 'Undo' }).tap();
    await expect.poll(() => lane0(page)).toBe(16);
  });

  test('write mode: ERASE + step pad clears just that step', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await fillLane(t, page);
    const e = await center(btn(page, 'ERASE'));
    const p = await center(page.getByTestId('pad-3'));
    await t.down(1, e.x, e.y);
    await t.down(2, p.x, p.y);
    await t.up(2);
    await t.up(1);
    await expect.poll(() => lane0(page)).toBe(15);
    expect((await lastPattern(page))?.keys[2]).toBe(0);
  });

  test('ERASE + FX clears the fx lane', async ({ page }) => {
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
    await tapCtl(t, page, btn(page, 'PLAY'));
    await tapCtl(t, page, btn(page, 'REC'));
    await expect.poll(() => fxCount(page)).toBeGreaterThan(0);
    const e = await center(btn(page, 'ERASE'));
    await t.down(1, e.x, e.y);
    await t.down(2, f.x, f.y);
    await t.up(2);
    await t.up(1);
    await expect.poll(() => fxCount(page)).toBe(0);
  });

  test('tap ERASE opens the sheet; Clear pattern empties; Clear ALL needs two taps', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await fillLane(t, page);
    await tapCtl(t, page, btn(page, 'WRITE'));
    await tapCtl(t, page, btn(page, 'ERASE'));
    const dlg = page.getByRole('dialog', { name: 'Erase' });
    await expect(dlg).toBeVisible();
    await expect(page.getByTestId('erase-pattern')).toContainText('pattern 01');
    await page.getByTestId('erase-pattern').tap();
    await expect.poll(() => lane0(page)).toBe(0);
    await expect(page.locator('.sheet-wrap.open')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).tap();
    await expect.poll(() => lane0(page)).toBe(16);
    await tapCtl(t, page, btn(page, 'ERASE'));
    await page.getByTestId('erase-all').tap();
    await expect(page.getByTestId('erase-all')).toContainText('Tap again');
    expect(await lane0(page)).toBe(16);
    await page.getByTestId('erase-all').tap();
    await expect.poll(() => lane0(page)).toBe(0);
    await expect(page.locator('.sheet-wrap.open')).toHaveCount(0);
  });

  test('live erase: ERASE held alone while playing clears the selected sound', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await fillLane(t, page);
    await tapCtl(t, page, btn(page, 'WRITE'));
    await tapCtl(t, page, btn(page, 'PLAY'));
    await page.waitForTimeout(300);
    const e = await center(btn(page, 'ERASE'));
    await t.down(1, e.x, e.y);
    await page.waitForTimeout(2600);
    await t.up(1);
    await tapCtl(t, page, btn(page, 'PLAY'));
    await expect(page.locator('.sheet-wrap.open')).toHaveCount(0);
    expect(await lane0(page)).toBeLessThanOrEqual(2);
    await page.getByRole('button', { name: 'Undo' }).tap();
    await expect.poll(() => lane0(page)).toBe(16);
  });

  test('layout: ERASE fits 360x640 and is >= 44 px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto('/');
    const b = (await btn(page, 'ERASE').boundingBox())!;
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
    expect(b.x + b.width).toBeLessThanOrEqual(360);
    const m = await page.evaluate(() => document.documentElement.scrollHeight <= document.documentElement.clientHeight);
    expect(m).toBe(true);
  });
});
