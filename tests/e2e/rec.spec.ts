import { expect, test, type Page } from '@playwright/test';
import { center, commands, startEngine, Touch } from './helpers';

const btn = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
async function tapCtl(t: Touch, page: Page, loc: ReturnType<Page['getByTestId']>, holdMs = 40) {
  const c = await center(loc);
  await t.down(9, c.x, c.y);
  await page.waitForTimeout(holdMs);
  await t.up(9);
}
type Packed = { keys: ArrayLike<number> };
async function lane0Sum(page: Page): Promise<number> {
  const cs = await commands(page);
  const latest = new Map<number, Packed>();
  for (const c of cs) if (c.type === 'pattern') latest.set(c.index as number, c.data as Packed);
  let n = 0;
  for (const d of latest.values()) for (let i = 0; i < 16; i++) n += d.keys[i] ? 1 : 0;
  return n;
}
const metro = async (page: Page) => (await commands(page)).filter((c) => c.type === 'metronome').map((c) => c.on);

test.describe('recording (touch)', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch only');

  test('REC tap arms, tap again disarms; hold + pad does not arm or play', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await tapCtl(t, page, btn(page, 'REC'));
    await expect(btn(page, 'REC')).toHaveAttribute('aria-pressed', 'true');
    await tapCtl(t, page, btn(page, 'REC'));
    await expect(btn(page, 'REC')).toHaveAttribute('aria-pressed', 'false');
    const n0 = (await commands(page)).filter((c) => c.type === 'play').length;
    const r = await center(btn(page, 'REC'));
    const p = await center(page.getByTestId('pad-3'));
    await t.down(1, r.x, r.y);
    await page.waitForTimeout(400);
    await t.down(2, p.x, p.y);
    await t.up(2);
    await t.up(1);
    await expect(btn(page, 'REC')).toHaveAttribute('aria-pressed', 'false');
    expect((await commands(page)).filter((c) => c.type === 'play').length).toBe(n0);
  });

  test('armed + playing: pad hits are recorded, undo removes the whole take; metronome follows', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await tapCtl(t, page, btn(page, 'REC'));
    await tapCtl(t, page, btn(page, 'PLAY'));
    await expect.poll(async () => (await metro(page)).at(-1)).toBe(true);
    await page.waitForTimeout(600);
    for (let i = 0; i < 4; i++) {
      await tapCtl(t, page, page.getByTestId('pad-1'), 40);
      await page.waitForTimeout(370);
    }
    await expect.poll(() => lane0Sum(page)).toBeGreaterThanOrEqual(1);
    // stop + disarm
    await tapCtl(t, page, btn(page, 'PLAY'));
    await expect.poll(async () => (await metro(page)).at(-1)).toBe(false);
    await page.getByRole('button', { name: 'Undo' }).tap();
    await expect.poll(() => lane0Sum(page)).toBe(0);
  });

  test('settings: latency persists after reload; calibration view opens', async ({ page }) => {
    await startEngine(page);
    await page.getByTestId('menu').tap();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await page.getByTestId('lat-plus').tap();
    await page.getByTestId('lat-plus').tap();
    await expect(page.getByTestId('latency-value')).toHaveText('2 ms');
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem('tko.settings')!)).offsetMs).toBe(2);
    await page.reload();
    await page.getByTestId('menu').tap();
    await expect(page.getByTestId('latency-value')).toHaveText('2 ms');
    await page.getByTestId('calibrate').tap();
    await expect(page.getByTestId('cal-view')).toBeVisible();
    await expect(page.getByTestId('cal-pad')).toBeVisible();
  });
});
