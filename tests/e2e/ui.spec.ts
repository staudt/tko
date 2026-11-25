import { expect, test } from '@playwright/test';
import { center, commands, dragKnob, startEngine, tapAt, Touch, type Cmd } from './helpers';

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
      for (const name of ['SOUND', 'PATTERN', 'BPM', 'SAMPLE', 'ERASE', 'REC', 'FX', 'PLAY', 'WRITE']) {
        const b = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
        expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
      }
    });
  }
});

test.describe('tab modes layout', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch only');
  test('each mode fits 360x640 without scrolling, popovers stay on screen', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await startEngine(page);
    const t = await Touch.open(page);
    const fits = async () => {
      const m = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(m.sh).toBeLessThanOrEqual(m.ch);
      expect(m.sw).toBeLessThanOrEqual(m.cw);
      for (let k = 1; k <= 16; k++) {
        const b = (await page.getByTestId(`pad-${k}`).boundingBox())!;
        expect(b.width).toBeGreaterThanOrEqual(56);
        expect(b.y + b.height).toBeLessThanOrEqual(640);
      }
    };
    for (const [name, longPad] of [['SOUND', 16], ['PATTERN', 16], ['PATTERN', 1], ['FX', 0]] as const) {
      await tapAt(t, page, page.getByRole('button', { name, exact: true }));
      await fits();
      if (longPad) {
        await tapAt(t, page, page.getByTestId(`pad-${longPad}`), 650);
        const b = (await page.getByTestId('popover').boundingBox())!;
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(360);
        expect(b.y + b.height).toBeLessThanOrEqual(640);
        expect(b.height).toBeGreaterThanOrEqual(88);
        await page.getByTestId('pop-backdrop').dispatchEvent('pointerdown');
        await expect(page.getByTestId('popover')).toHaveCount(0);
      }
      await tapAt(t, page, page.getByRole('button', { name, exact: true }));
    }
  });
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
    await expect(page.locator('.sheet-wrap.open')).toHaveCount(0);
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

  test('tap SOUND: pads show names, tap pad 10 selects sound 10 and returns to play', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    const snd = page.getByRole('button', { name: 'SOUND', exact: true });
    await tapAt(t, page, snd);
    await expect(snd).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('pad-10').locator('.lbl')).toHaveText(/\S/);
    await expect(page.getByTestId('pad-1').locator('.sub')).toHaveText('melodic');
    await expect(page.getByTestId('pad-10').locator('.sub')).toHaveText('drum');
    await expect(page.getByTestId('hint')).toContainText('select sound');
    const before = (await commands(page)).filter((c) => c.type === 'play' && c.on).length;
    await tapAt(t, page, page.getByTestId('pad-10'));
    await expect(page.getByTestId('lcd')).toHaveAttribute('data-snd', '10');
    await expect(snd).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('pad-10').locator('.sub')).toHaveCount(0);
    // key 0 of the new sound was auditioned
    await expect.poll(async () => (await commands(page)).filter((c) => c.type === 'play' && c.on).length).toBe(before + 1);
    expect((await commands(page)).filter((c) => c.type === 'play' && c.on).pop()).toMatchObject({ sound: 9, key: 0 });
    // tapping SOUND again exits without selecting
    await tapAt(t, page, snd);
    await tapAt(t, page, snd);
    await expect(snd).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('lcd')).toHaveAttribute('data-snd', '10');
  });

  test('sound mode knobs: A = key, B = scale', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await tapAt(t, page, page.getByRole('button', { name: 'SOUND', exact: true }));
    await expect(page.getByTestId('knob-a-label')).toHaveText(/^KEY [A-G]#?$/);
    await expect(page.getByTestId('knob-b-label')).toHaveText(/^SCALE /);
    await dragKnob(t, page, page.getByTestId('knob-a'), 40);
    await expect.poll(async () => (await commands(page)).filter((c) => c.type === 'scale').pop()?.key).toBeGreaterThan(0);
    const k1 = (await commands(page)).filter((c) => c.type === 'scale').pop()!.offsets;
    await dragKnob(t, page, page.getByTestId('knob-b'), 50);
    await expect.poll(async () => JSON.stringify((await commands(page)).filter((c) => c.type === 'scale').pop()?.offsets)).not.toBe(JSON.stringify(k1));
    await expect(page.getByTestId('knob-b-label')).not.toHaveText('SCALE CHROMATIC');
    // still in sound mode after turning knobs
    await expect(page.getByRole('button', { name: 'SOUND', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('tap FX: hold pad 3 -> fx 2 on, release -> off; two pads at once -> two on', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    const fx = page.getByRole('button', { name: 'FX', exact: true });
    await tapAt(t, page, fx);
    await expect(fx).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('pad-1').locator('.lbl')).toHaveText('Stutter');
    await expect(page.getByTestId('hint')).toContainText('effects');
    const p3 = await center(page.getByTestId('pad-3'));
    const p6 = await center(page.getByTestId('pad-6'));
    await t.down(1, p3.x, p3.y);
    await expect.poll(async () => (await commands(page)).some((c) => c.type === 'fx' && c.fx === 2 && c.on === true)).toBe(true);
    await t.down(2, p6.x, p6.y);
    await expect.poll(async () => (await commands(page)).some((c) => c.type === 'fx' && c.fx === 5 && c.on === true)).toBe(true);
    // knobs follow the most recent held effect
    await expect(page.getByTestId('knob-a-label')).toContainText('CUTOFF');
    await t.up(2);
    await expect.poll(async () => (await commands(page)).some((c) => c.type === 'fx' && c.fx === 5 && c.on === false)).toBe(true);
    await expect(page.getByTestId('knob-a-label')).toContainText('LENGTH');
    await t.up(1);
    await expect.poll(async () => (await commands(page)).some((c) => c.type === 'fx' && c.fx === 2 && c.on === false)).toBe(true);
    expect((await commands(page)).some((c) => c.type === 'play' && c.on === true)).toBe(false);
    // tapping FX again leaves the mode
    await tapAt(t, page, fx);
    await expect(fx).toHaveAttribute('aria-pressed', 'false');
  });

  test('tabs are exclusive; WRITE switches back to play', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    const b = (n: string) => page.getByRole('button', { name: n, exact: true });
    await tapAt(t, page, b('SOUND'));
    await tapAt(t, page, b('PATTERN'));
    await expect(b('SOUND')).toHaveAttribute('aria-pressed', 'false');
    await expect(b('PATTERN')).toHaveAttribute('aria-pressed', 'true');
    await tapAt(t, page, b('FX'));
    await expect(b('PATTERN')).toHaveAttribute('aria-pressed', 'false');
    await expect(b('FX')).toHaveAttribute('aria-pressed', 'true');
    await tapAt(t, page, b('WRITE'));
    await expect(b('FX')).toHaveAttribute('aria-pressed', 'false');
    await expect(b('WRITE')).toHaveAttribute('aria-pressed', 'true');
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
