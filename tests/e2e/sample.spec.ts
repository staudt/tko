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
  await page.getByTestId(`card-${n}`).tap();
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
  });

  test('drum slot: auto / equal slices, marker drag', async ({ page }) => {
    await startEngine(page);
    await selectSound(page, 10);
    const t = await Touch.open(page);
    await openSampleSheet(page, t);
    await expect(page.getByTestId('kind-drum')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('equal-slices').click();
    await expect.poll(async () => (await lastSound(page, 9))?.slices.length).toBe(17);
    const eq = (await lastSound(page, 9))!.slices;
    expect(eq[4]).toBeCloseTo(0.25, 3);
    await page.getByTestId('auto-slice').click();
    await expect.poll(async () => (await lastSound(page, 9))?.slices[4]).not.toBeCloseTo(0.25, 3);
    const auto = (await lastSound(page, 9))!.slices;
    expect(auto).toHaveLength(17);
    for (let i = 1; i < 17; i++) expect(auto[i]!).toBeGreaterThan(auto[i - 1]!);
    // drag marker 8 to the right
    await page.getByTestId('equal-slices').click();
    await expect.poll(async () => (await lastSound(page, 9))?.slices[8]).toBeCloseTo(0.5, 3);
    const m = await center(page.getByTestId('marker-8'));
    await page.mouse.move(m.x, m.y);
    await page.mouse.down();
    await page.mouse.move(m.x + 12, m.y, { steps: 4 });
    await page.mouse.move(m.x + 22, m.y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await lastSound(page, 9))?.slices[8] ?? 0).toBeGreaterThan(0.52);
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
    expect(m.scroll).toBeGreaterThan(m.client);
    expect(m.hx).toBeLessThanOrEqual(m.w);
    expect(m.sx).toBeLessThanOrEqual(m.cx);
  });
});
