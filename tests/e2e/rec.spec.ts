import { expect, test, type Page } from '@playwright/test';
import { center, commands, startEngine, Touch } from './helpers';
import { makeWav } from './fakeMic';

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

  test('REC tap arms, tap again disarms', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await tapCtl(t, page, btn(page, 'REC'));
    await expect(btn(page, 'REC')).toHaveAttribute('aria-pressed', 'true');
    await tapCtl(t, page, btn(page, 'REC'));
    await expect(btn(page, 'REC')).toHaveAttribute('aria-pressed', 'false');
  });

  test('hold REC + pad while stopped plays a note, no arm', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    const n0 = (await commands(page)).filter((c) => c.type === 'play' && c.on).length;
    const r = await center(btn(page, 'REC'));
    const p = await center(page.getByTestId('pad-1'));
    await t.down(1, r.x, r.y);
    await page.waitForTimeout(400);
    await t.down(2, p.x, p.y);
    await t.up(2);
    await t.up(1);
    await expect.poll(async () => (await commands(page)).filter((c) => c.type === 'play' && c.on).length).toBeGreaterThan(n0);
    await expect(btn(page, 'REC')).toHaveAttribute('aria-pressed', 'false');
    expect(await lane0Sum(page)).toBe(0);
  });

  test('hold REC + pad while playing records the hit and does not arm', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await tapCtl(t, page, btn(page, 'PLAY'));
    await page.waitForTimeout(500);
    const r = await center(btn(page, 'REC'));
    const p = await center(page.getByTestId('pad-1'));
    await t.down(1, r.x, r.y);
    await page.waitForTimeout(350);
    await expect.poll(async () => (await metro(page)).at(-1)).toBe(true);
    await t.down(2, p.x, p.y);
    await page.waitForTimeout(60);
    await t.up(2);
    await t.up(1);
    await expect.poll(() => lane0Sum(page)).toBeGreaterThanOrEqual(1);
    await expect(btn(page, 'REC')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await metro(page)).at(-1)).toBe(false);
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

  test('settings: Export WAV downloads a RIFF file', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await tapCtl(t, page, btn(page, 'WRITE'));
    await tapCtl(t, page, page.getByTestId('pad-1'));
    await tapCtl(t, page, btn(page, 'WRITE'));
    await page.getByTestId('menu').click();
    await expect(page.getByTestId('export-row')).toBeVisible();
    await page.getByTestId('export-x1').click();
    await page.screenshot({ path: 'docs/screenshots/settings-export-390x844.png' });
    const dl = page.waitForEvent('download', { timeout: 30_000 });
    await page.getByTestId('export-wav').click();
    await expect(page.getByTestId('export-progress')).toBeVisible();
    const d = await dl;
    expect(d.suggestedFilename()).toMatch(/^tko-.+-\d+bpm-\d{8}-\d{4}\.wav$/);
    const buf = await (await import('node:fs/promises')).readFile((await d.path())!);
    expect(buf.subarray(0, 4).toString()).toBe('RIFF');
    expect(buf.length).toBeGreaterThan(44);
    await expect(page.getByTestId('toast')).toContainText(/Exported/);
  });

  test('settings: About links, no metronome toggles', async ({ page }) => {
    await startEngine(page);
    await page.getByTestId('menu').tap();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await expect(page.getByTestId('about-author')).toHaveAttribute('href', 'http://x.com/ricardostaudt');
    await expect(page.getByTestId('about-author')).toHaveAttribute('rel', /noopener/);
    await expect(page.getByTestId('about-author')).toHaveAttribute('target', '_blank');
    await expect(page.getByTestId('about-claude')).toHaveAttribute('href', 'https://claude.com/claude-code');
    await expect(page.getByTestId('set-metro')).toHaveCount(0);
    await expect(page.getByTestId('set-metro-rec')).toHaveCount(0);
    await expect(page.getByRole('switch')).toHaveCount(0);
  });

  test('settings: Reset to defaults needs a second tap and restores the factory kit', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    // an imported sample in slot 1 and a step
    await page.getByRole('button', { name: 'SAMPLE', exact: true }).tap();
    await expect(page.getByRole('dialog', { name: 'Sample' })).toBeVisible();
    await page.waitForTimeout(400);
    await page.getByTestId('import-file').setInputFiles({ name: 'kitchen.wav', mimeType: 'audio/wav', buffer: makeWav(1.2, 4) });
    const sid = async () => {
      const cs = await commands(page);
      return cs.filter((c) => c.type === 'sound' && (c.params as { index: number }).index === 0).map((c) => (c.params as { sampleId: string | null }).sampleId).at(-1);
    };
    await expect.poll(async () => (await sid()) ?? '', { timeout: 15_000 }).toMatch(/^u/);
    await page.locator('.sheet-wrap.open .backdrop').dispatchEvent('pointerdown');
    await page.waitForTimeout(400);
    await tapCtl(t, page, btn(page, 'WRITE'));
    await tapCtl(t, page, page.getByTestId('pad-5'));
    await expect.poll(() => lane0Sum(page)).toBe(1);
    await page.getByTestId('menu').tap();
    await expect(page.getByTestId('reset')).toHaveText('Reset to defaults');
    await page.getByTestId('reset').tap();
    await expect(page.getByTestId('reset')).toHaveText('Tap again to reset this project');
    await page.getByTestId('reset').tap();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();
    await expect.poll(() => lane0Sum(page)).toBe(0);
    await expect.poll(sid, { timeout: 15_000 }).toBe('factory:0');
    await expect(page.getByTestId('lcd')).toBeVisible();
  });
});
