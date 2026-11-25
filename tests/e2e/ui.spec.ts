import { expect, test } from '@playwright/test';
import { center, commands, startEngine, Touch, type Cmd } from './helpers';

test.describe('layout', () => {
  for (const [w, h] of [[360, 640], [390, 844], [430, 932]] as const) {
    test(`fits ${w}x${h} without scrolling`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/');
      await expect(page.getByTestId('pad-16')).toBeVisible();
      const m = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(m.sh).toBeLessThanOrEqual(m.ch);
      expect(m.sw).toBeLessThanOrEqual(m.cw);
      for (let k = 1; k <= 16; k++) {
        const b = (await page.getByTestId(`pad-${k}`).boundingBox())!;
        expect(b.width, `pad ${k} w`).toBeGreaterThanOrEqual(56);
        expect(b.height, `pad ${k} h`).toBeGreaterThanOrEqual(56);
        expect(b.y + b.height).toBeLessThanOrEqual(h);
      }
      for (const name of ['SOUND', 'PATTERN', 'BPM', 'REC', 'FX', 'PLAY', 'WRITE']) {
        const b = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
        expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
      }
    });
  }
});

test.describe('touch', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch only');

  test('two pads at once -> two plays, two offs', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    const a = await center(page.getByTestId('pad-1'));
    const b = await center(page.getByTestId('pad-6'));
    await t.down(1, a.x, a.y);
    await t.down(2, b.x, b.y);
    await expect.poll(async () => (await commands(page)).filter((c) => c.type === 'play' && c.on === true).length).toBe(2);
    await t.up(1);
    await t.up(2);
    await expect.poll(async () => (await commands(page)).filter((c) => c.type === 'play' && c.on === false).length).toBe(2);
    const plays = (await commands(page)).filter((c) => c.type === 'play');
    expect(plays.filter((c) => c.on).map((c) => c.key).sort()).toEqual([0, 5]);
  });

  test('hold SOUND + pad 10 selects sound 10, no note', async ({ page }) => {
    await startEngine(page);
    const before = (await commands(page)).filter((c) => c.type === 'play').length;
    const t = await Touch.open(page);
    const s = await center(page.getByRole('button', { name: 'SOUND', exact: true }));
    const p = await center(page.getByTestId('pad-10'));
    await t.down(1, s.x, s.y);
    await t.down(2, p.x, p.y);
    await t.up(2);
    await expect(page.getByTestId('lcd')).toHaveAttribute('data-snd', '10');
    await expect(page.getByLabel('SND 10').first()).toBeAttached();
    await page.waitForTimeout(400);
    await t.up(1);
    expect((await commands(page)).filter((c) => c.type === 'play').length).toBe(before);
    await expect(page.locator('.sheet-wrap')).not.toHaveClass(/open/);
  });

  test('hold a pad, drag knob A with another finger', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    const p = await center(page.getByTestId('pad-3'));
    const k = await center(page.getByTestId('knob-a'));
    await t.down(1, p.x, p.y);
    await t.down(2, k.x, k.y);
    for (let i = 1; i <= 10; i++) await t.move(2, k.x, k.y - i * 8);
    await expect.poll(async () => (await commands(page)).some((c) => c.type === 'sound' && ((c.params as { pitch: number }).pitch ?? 0) > 0)).toBe(true);
    const cs = await commands(page);
    expect(cs.some((c: Cmd) => c.type === 'play' && c.on === false)).toBe(false);
    await t.up(2);
    await t.up(1);
    await expect.poll(async () => (await commands(page)).some((c) => c.type === 'play' && c.on === false)).toBe(true);
  });

  test('hold FX + pad 3 -> fx 2 on, release -> off', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    const f = await center(page.getByRole('button', { name: 'FX', exact: true }));
    const p = await center(page.getByTestId('pad-3'));
    await t.down(1, f.x, f.y);
    await t.down(2, p.x, p.y);
    await expect.poll(async () => (await commands(page)).some((c) => c.type === 'fx' && c.fx === 2 && c.on === true)).toBe(true);
    await t.up(2);
    await expect.poll(async () => (await commands(page)).some((c) => c.type === 'fx' && c.fx === 2 && c.on === false)).toBe(true);
    await t.up(1);
    expect((await commands(page)).some((c) => c.type === 'play' && c.on === true)).toBe(false);
  });

  test('quick tap SOUND opens sheet, card selects', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    const s = await center(page.getByRole('button', { name: 'SOUND', exact: true }));
    await t.down(1, s.x, s.y);
    await t.up(1);
    await expect(page.getByRole('dialog', { name: 'Sounds' })).toBeVisible();
    await expect(page.getByTestId('card-12')).toBeVisible();
    await page.getByTestId('card-12').tap();
    await expect(page.getByTestId('lcd')).toHaveAttribute('data-snd', '12');
    await expect(page.locator('.sheet-wrap')).not.toHaveClass(/open/);
  });

  test('pointercancel releases everything and panics', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    const p = await center(page.getByTestId('pad-2'));
    await t.down(1, p.x, p.y);
    await expect.poll(async () => (await commands(page)).some((c) => c.type === 'play' && c.on === true)).toBe(true);
    await t.cancel();
    await expect.poll(async () => (await commands(page)).some((c) => c.type === 'panic')).toBe(true);
    await expect(page.getByTestId('pad-2')).not.toHaveClass(/\bon\b/);
  });
});
