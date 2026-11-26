import { expect, test, type Page } from '@playwright/test';
import { center, commands, startEngine, Touch, type Cmd } from './helpers';
import { installDeniedMic, installFakeMic, makeWav } from './fakeMic';

const btn = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
type SoundParams = { index: number; sampleId: string | null; start: number; end: number; slices: number[] };
async function lastSound(page: Page, index: number): Promise<SoundParams | undefined> {
  const cs = await commands(page);
  return cs.filter((c: Cmd) => c.type === 'sound' && (c.params as SoundParams).index === index).map((c) => c.params as SoundParams).at(-1);
}
async function openSampleSheet(page: Page, t: Touch) {
  const c = await center(btn(page, 'SAMPLE'));
  await t.down(8, c.x, c.y);
  await page.waitForTimeout(60);
  await t.up(8);
  await expect(page.getByRole('dialog', { name: 'Sample' })).toBeVisible();
  await page.waitForTimeout(400); // slide-in transition
}
async function selectSound(page: Page, n: number) {
  const t = await Touch.open(page);
  const c = await center(btn(page, 'SOUND'));
  await t.down(7, c.x, c.y);
  await page.waitForTimeout(60);
  await t.up(7);
  await page.getByTestId(`pad-${n}`).tap();
  await expect(page.getByTestId('lcd')).toHaveAttribute('data-snd', String(n));
}
const importWav = async (page: Page) => {
  await page.getByTestId('import-file').setInputFiles({ name: 'kitchen.wav', mimeType: 'audio/wav', buffer: makeWav(1.2, 4) });
};

test.describe('sampling', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch only');

  test('hold SAMPLE + pad 3 records into slot 3', async ({ page }) => {
    await installFakeMic(page);
    await startEngine(page);
    const t = await Touch.open(page);
    const s = await center(btn(page, 'SAMPLE'));
    const p = await center(page.getByTestId('pad-3'));
    await t.down(1, s.x, s.y);
    await t.down(2, p.x, p.y);
    await expect(btn(page, 'SAMPLE')).toHaveClass(/recording/);
    await page.waitForTimeout(1100);
    await t.up(2);
    await t.up(1);
    await expect.poll(async () => (await lastSound(page, 2))?.sampleId ?? '', { timeout: 15_000 }).toMatch(/^u/);
    await expect(page.getByTestId('readout')).toContainText('REC 3');
    await expect(btn(page, 'SAMPLE')).not.toHaveClass(/recording/);
    await expect(page.getByRole('dialog', { name: 'Sample' })).not.toBeVisible();
  });

  test('mic denied: message, slot unchanged', async ({ page }) => {
    await installDeniedMic(page);
    await startEngine(page);
    const t = await Touch.open(page);
    const s = await center(btn(page, 'SAMPLE'));
    const p = await center(page.getByTestId('pad-3'));
    await t.down(1, s.x, s.y);
    await t.down(2, p.x, p.y);
    await expect(page.getByTestId('toast')).toContainText(/denied/i);
    await t.up(2);
    await t.up(1);
    expect((await lastSound(page, 2))?.sampleId ?? 'factory:2').toBe('factory:2');
    await expect(btn(page, 'SAMPLE')).not.toHaveClass(/recording/);
  });

  test('sheet: import a file, restore factory', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await openSampleSheet(page, t);
    await importWav(page);
    await expect.poll(async () => (await lastSound(page, 0))?.sampleId ?? '', { timeout: 15_000 }).toMatch(/^u/);
    await expect(page.getByTestId('sample-name')).toContainText('kitchen');
    await page.getByTestId('restore-factory').click();
    await expect.poll(async () => (await lastSound(page, 0))?.sampleId).toBe('factory:0');
  });

  test('sheet: record button records', async ({ page }) => {
    await installFakeMic(page);
    await startEngine(page);
    const t = await Touch.open(page);
    await openSampleSheet(page, t);
    await page.getByTestId('sample-record').click();
    await expect(page.getByTestId('level')).toBeVisible();
    await page.waitForTimeout(1000);
    await page.getByTestId('sample-record').click();
    await expect.poll(async () => (await lastSound(page, 0))?.sampleId ?? '', { timeout: 15_000 }).toMatch(/^u/);
  });

  test('sheet: rename', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await openSampleSheet(page, t);
    await page.getByTestId('sample-name').click();
    await page.getByTestId('name-input').fill('Bell');
    await page.getByTestId('name-input').press('Enter');
    await expect(page.getByTestId('sample-name')).toContainText('Bell');
  });

  test('melodic trim handle drag changes start', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await openSampleSheet(page, t);
    const h = await center(page.getByTestId('handle-start'));
    const w = (await page.getByTestId('wave').boundingBox())!;
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x + w.width * 0.15, h.y, { steps: 6 });
    await page.mouse.move(h.x + w.width * 0.3, h.y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await lastSound(page, 0))?.start ?? 0).toBeGreaterThan(0.2);
    await expect.poll(async () => (await lastSound(page, 0))?.end ?? 0).toBe(1);
    const st = (await lastSound(page, 0))!.start;
    await expect(page.getByTestId('wave')).toHaveAttribute('data-start', st.toFixed(4));
    await expect(page.getByTestId('label-start')).not.toHaveText('0.00 s');
    await expect(page.getByTestId('trim-info')).toContainText('trim');
  });

  test('trim handles are visible and clamp at the ends', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await openSampleSheet(page, t);
    const w = (await page.getByTestId('wave').boundingBox())!;
    for (const id of ['handle-start', 'handle-end', 'label-start', 'label-end']) {
      const b = (await page.getByTestId(id).boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
    // drag the end handle far past the start handle: clamped, start untouched
    const h = await center(page.getByTestId('handle-end'));
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x - w.width * 0.5, h.y, { steps: 6 });
    await page.mouse.move(h.x - w.width * 1.2, h.y, { steps: 6 });
    await expect(page.getByTestId('bubble')).toBeVisible();
    await page.mouse.up();
    const sp = (await lastSound(page, 0))!;
    expect(sp.start).toBe(0);
    expect(sp.end).toBeGreaterThan(0);
    expect(sp.end).toBeLessThan(0.1);
  });

  test('play button toggles play / stop; import auto-plays', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await openSampleSheet(page, t);
    await page.getByTestId('import-file').setInputFiles({ name: 'long.wav', mimeType: 'audio/wav', buffer: makeWav(8, 4) });
    const pb = page.getByTestId('play-btn');
    await expect(pb).toHaveAttribute('data-playing', 'true', { timeout: 15_000 });
    await pb.click();
    await expect(pb).toHaveAttribute('data-playing', 'false');
    await pb.click();
    await expect(pb).toHaveAttribute('data-playing', 'true');
    await expect(page.getByTestId('sample-len')).toContainText('8.0 s');
    await pb.click();
    await expect(pb).toHaveAttribute('data-playing', 'false');
  });

  test('recording in the sheet auto-plays the result', async ({ page }) => {
    await installFakeMic(page);
    await startEngine(page);
    const t = await Touch.open(page);
    await openSampleSheet(page, t);
    await page.getByTestId('sample-record').click();
    await page.waitForTimeout(1000);
    await page.getByTestId('sample-record').click();
    await expect.poll(async () => Number(await page.getByTestId('play-btn').getAttribute('data-previews')), { timeout: 15_000 }).toBeGreaterThan(0);
  });

  const drumSheet = async (page: Page, n = 10) => {
    await startEngine(page);
    await selectSound(page, n);
    const t = await Touch.open(page);
    await openSampleSheet(page, t);
    return t;
  };
  const importBursts = async (page: Page, bursts = 3) => {
    await page.getByTestId('import-file').setInputFiles({ name: 'hits.wav', mimeType: 'audio/wav', buffer: makeWav(1.2, bursts) });
    await expect.poll(async () => (await lastSound(page, 9))?.sampleId ?? '', { timeout: 15_000 }).toMatch(/^u/);
  };
  const slicesOf = async (page: Page) => (await lastSound(page, 9))!.slices;

  test('sheet has no resample or normalize controls', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await openSampleSheet(page, t);
    for (const id of ['normalize', 'resample-go', 'resample-1', 'resample-2', 'resample-4']) await expect(page.getByTestId(id)).toHaveCount(0);
  });

  test('drum slot: import of 3 bursts auto-slices to 4 boundaries (hits only)', async ({ page }) => {
    await drumSheet(page);
    await importBursts(page);
    await expect.poll(async () => (await slicesOf(page)).length).toBe(4);
    await expect(page.getByTestId('slice-count')).toHaveText('3 slices');
    const sl = await slicesOf(page);
    for (let i = 1; i < sl.length; i++) expect(sl[i]!).toBeGreaterThan(sl[i - 1]!);
    // switching melodic -> drum without slices also auto-slices only the hits
    await page.getByTestId('kind-melodic').click();
    await expect.poll(async () => (await slicesOf(page)).length).toBe(0);
    await page.getByTestId('kind-drum').click();
    await expect.poll(async () => (await slicesOf(page)).length).toBe(4);
  });

  test('drum slot: stepper sets N equal slices', async ({ page }) => {
    await drumSheet(page);
    await importBursts(page);
    await expect(page.getByTestId('slice-count')).toHaveText('3 slices');
    await page.getByTestId('slices-plus').click();
    await expect.poll(async () => (await slicesOf(page)).length).toBe(5);
    await expect(page.getByTestId('slice-count')).toHaveText('4 slices');
    const sl = await slicesOf(page);
    expect(sl[1]).toBeCloseTo(0.25, 3);
    expect(sl[2]).toBeCloseTo(0.5, 3);
    for (let i = 0; i < 3; i++) await page.getByTestId('slices-minus').click();
    await expect(page.getByTestId('slice-count')).toHaveText('1 slice');
    await expect(page.getByTestId('slices-minus')).toBeDisabled();
    for (let i = 0; i < 15; i++) await page.getByTestId('slices-plus').click();
    await expect(page.getByTestId('slice-count')).toHaveText('16 slices');
    await expect(page.getByTestId('slices-plus')).toBeDisabled();
    await expect.poll(async () => (await slicesOf(page)).length).toBe(17);
  });

  test('drum slot: long-press removes a marker, double-tap adds one', async ({ page }) => {
    const t = await drumSheet(page);
    await page.getByTestId('import-file').setInputFiles({ name: 'hits.wav', mimeType: 'audio/wav', buffer: makeWav(1.2, 4) });
    await expect.poll(async () => (await lastSound(page, 9))?.sampleId ?? '', { timeout: 15_000 }).toMatch(/^u/);
    await expect.poll(async () => (await slicesOf(page)).length).toBe(5);
    const before = await slicesOf(page);
    // long-press marker 2 without moving
    const m = await center(page.getByTestId('marker-2'));
    await t.down(3, m.x, m.y);
    await page.waitForTimeout(700);
    await t.up(3);
    await expect.poll(async () => (await slicesOf(page)).length).toBe(4);
    await expect(page.getByTestId('slice-note')).toHaveText('SLICE REMOVED');
    const after = await slicesOf(page);
    expect(after).toEqual(before.filter((_, i) => i !== 2));
    // double-tap on the wave, between markers
    const w = (await page.getByTestId('wave').boundingBox())!;
    const x = w.x + w.width * 0.15;
    const y = w.y + w.height / 2;
    await t.down(4, x, y);
    await t.up(4);
    await page.waitForTimeout(80);
    await t.down(4, x, y);
    await t.up(4);
    await expect.poll(async () => (await slicesOf(page)).length).toBe(5);
    await expect(page.getByTestId('slice-note')).toHaveText('SLICE ADDED');
    const added = (await slicesOf(page)).find((v) => v > 0.1 && v < 0.2);
    expect(added).toBeCloseTo(0.15, 1);
    // end markers are fixed
    const sl = await slicesOf(page);
    expect(sl[0]).toBe(0);
    expect(sl.at(-1)).toBe(1);
  });

  test('drum slot: dragging a marker onto its neighbour merges them (one undo step)', async ({ page }) => {
    await drumSheet(page);
    await page.getByTestId('slices-minus').click(); // 15 slices
    await expect.poll(async () => (await slicesOf(page)).length).toBe(16);
    const m = await center(page.getByTestId('marker-8'));
    const n = await center(page.getByTestId('marker-9'));
    await page.mouse.move(m.x, m.y);
    await page.mouse.down();
    await page.mouse.move((m.x + n.x) / 2, m.y, { steps: 3 });
    await page.mouse.move(n.x - 3, m.y, { steps: 3 });
    await page.mouse.up();
    await expect.poll(async () => (await slicesOf(page)).length).toBe(15);
    await expect(page.getByTestId('slice-note')).toHaveText('SLICE REMOVED');
  });

  test('drum slot: marker drag still moves a marker', async ({ page }) => {
    await drumSheet(page);
    await page.getByTestId('slices-minus').click();
    await page.getByTestId('slices-plus').click(); // 16 equal slices
    await expect.poll(async () => (await slicesOf(page))[8]).toBeCloseTo(0.5, 3);
    const m = await center(page.getByTestId('marker-8'));
    await page.mouse.move(m.x, m.y);
    await page.mouse.down();
    await page.mouse.move(m.x + 4, m.y, { steps: 4 });
    await page.mouse.move(m.x + 8, m.y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await slicesOf(page))[8] ?? 0).toBeGreaterThan(0.52);
    expect((await slicesOf(page)).length).toBe(17);
  });

  test('pads beyond the slice count are dimmed and silent', async ({ page }) => {
    const t = await drumSheet(page);
    await importBursts(page);
    await expect(page.getByTestId('slice-count')).toHaveText('3 slices');
    await t.down(5, 195, 20); // backdrop closes the sheet
    await t.up(5);
    await page.waitForTimeout(500);
    await expect(page.getByTestId('pad-4')).toHaveClass(/none/);
    await expect(page.getByTestId('pad-4')).toContainText('—');
    await expect(page.getByTestId('pad-3')).not.toHaveClass(/none/);
    const plays = async () => (await commands(page)).filter((c) => c.type === 'play' && c.on && c.sound === 9);
    const n0 = (await plays()).length;
    await page.getByTestId('pad-4').tap();
    await page.waitForTimeout(150);
    expect((await plays()).length).toBe(n0);
    await page.getByTestId('pad-3').tap();
    await expect.poll(async () => (await plays()).length).toBe(n0 + 1);
    // WRITE key-pick: dimmed too, silent
    const wc = await center(btn(page, 'WRITE'));
    await t.down(6, wc.x, wc.y);
    await expect(page.getByTestId('pad-4')).toHaveClass(/none/);
    const n1 = (await plays()).length;
    await page.getByTestId('pad-4').tap();
    await page.waitForTimeout(150);
    expect((await plays()).length).toBe(n1);
    await t.up(6);
  });

  test('layout fits at 360x640 with the sheet open', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await startEngine(page);
    const t = await Touch.open(page);
    await openSampleSheet(page, t);
    const sheet = (await page.getByRole('dialog', { name: 'Sample' }).boundingBox())!;
    expect(sheet.y).toBeGreaterThanOrEqual(-1);
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(641);
    const m = await page.evaluate(() => {
      const b = document.querySelector('.sheet-wrap.open .sheet-body') as HTMLElement;
      return { scroll: b.scrollHeight, client: b.clientHeight, hx: document.documentElement.scrollWidth, w: window.innerWidth, sx: b.scrollWidth, cx: b.clientWidth };
    });
    expect(m.scroll).toBeGreaterThanOrEqual(m.client);
    expect(m.hx).toBeLessThanOrEqual(m.w);
    expect(m.sx).toBeLessThanOrEqual(m.cx);
  });
});
