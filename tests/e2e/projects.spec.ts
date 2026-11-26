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
const openProjects = async (page: Page) => {
  await page.getByTestId('menu').tap();
  await page.getByTestId('projects-row').tap();
  await expect(page.getByRole('dialog', { name: 'Projects' })).toBeVisible();
  await page.waitForTimeout(300);
};
const closeSheet = async (page: Page) => {
  await page.locator('.sheet-wrap.open .backdrop').dispatchEvent('pointerdown');
  await page.waitForTimeout(350);
};
const writeStep = async (page: Page, t: Touch, pad = 5) => {
  await tapCtl(t, page, btn(page, 'WRITE'));
  await tapCtl(t, page, page.getByTestId(`pad-${pad}`));
  await tapCtl(t, page, btn(page, 'WRITE'));
};
const rows = (page: Page) => page.getByTestId('proj-row');
const idb = (page: Page, store: string) =>
  page.evaluate(
    (s) =>
      new Promise<number>((resolve) => {
        const r = indexedDB.open('tko');
        r.onsuccess = () => {
          const q = r.result.transaction(s).objectStore(s).count();
          q.onsuccess = () => resolve(q.result);
        };
      }),
    store,
  );

test.describe('projects', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch only');

  test('new project is empty; switching back restores the steps', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await writeStep(page, t);
    await expect.poll(() => lane0Sum(page)).toBe(1);
    await openProjects(page);
    await page.getByTestId('proj-new').tap();
    await expect(page.getByTestId('lcd')).toBeVisible();
    await expect.poll(() => lane0Sum(page)).toBe(0);
    await openProjects(page);
    await expect(rows(page)).toHaveCount(2);
    await rows(page).filter({ hasNotText: 'open now' }).getByTestId('proj-open').tap();
    await expect(page.getByRole('dialog', { name: 'Projects' })).toBeHidden();
    await expect.poll(() => lane0Sum(page)).toBe(1);
  });

  test('duplicate copies the patterns under a new id', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await writeStep(page, t);
    await openProjects(page);
    const id0 = await rows(page).first().getAttribute('data-id');
    await rows(page).first().getByTestId('proj-menu').tap();
    await page.getByTestId('proj-dup').tap();
    await expect.poll(() => lane0Sum(page)).toBe(1);
    await openProjects(page);
    await expect(rows(page)).toHaveCount(2);
    const ids = await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain(id0);
    await expect(page.getByTestId('proj-name')).toContainText('copy');
  });

  test('rename persists after reload', async ({ page }) => {
    await startEngine(page);
    await openProjects(page);
    await page.getByTestId('proj-name').tap();
    await page.getByTestId('proj-name-input').fill('Soup Jam');
    await page.getByTestId('proj-name-input').press('Enter');
    await expect(page.getByTestId('proj-name')).toHaveText('Soup Jam');
    await page.waitForTimeout(900);
    await page.reload();
    await page.getByTestId('menu').tap();
    await expect(page.getByTestId('projects-row')).toContainText('Soup Jam');
  });

  test('delete removes the project and its unreferenced sample', async ({ page }) => {
    await startEngine(page);
    await btn(page, 'SAMPLE').tap();
    await expect(page.getByRole('dialog', { name: 'Sample' })).toBeVisible();
    await page.waitForTimeout(400);
    await page.getByTestId('import-file').setInputFiles({ name: 'kitchen.wav', mimeType: 'audio/wav', buffer: makeWav(1.2, 4) });
    await expect.poll(() => idb(page, 'samples'), { timeout: 15_000 }).toBe(1);
    await closeSheet(page);
    await openProjects(page);
    await page.getByTestId('proj-new').tap();
    await expect.poll(() => idb(page, 'projects')).toBeGreaterThanOrEqual(2);
    await openProjects(page);
    const other = rows(page).filter({ hasNotText: 'open now' });
    await other.getByTestId('proj-menu').tap();
    await page.getByTestId('proj-delete').tap();
    await expect(page.getByTestId('proj-delete')).toHaveText('Tap again');
    await page.getByTestId('proj-delete').tap();
    await expect(rows(page)).toHaveCount(1);
    await expect.poll(() => idb(page, 'samples')).toBe(0);
    await expect.poll(() => idb(page, 'projects')).toBe(1);
  });

  test('reset only resets the current project', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    await writeStep(page, t);
    await openProjects(page);
    await page.getByTestId('proj-new').tap();
    await expect.poll(() => lane0Sum(page)).toBe(0);
    await writeStep(page, t, 6);
    await expect.poll(() => lane0Sum(page)).toBe(1);
    await page.getByTestId('menu').tap();
    await page.getByTestId('reset').tap();
    await expect(page.getByTestId('reset')).toHaveText('Tap again to reset this project');
    await page.getByTestId('reset').tap();
    await expect.poll(() => lane0Sum(page)).toBe(0);
    await openProjects(page);
    await expect(rows(page)).toHaveCount(2);
    await rows(page).filter({ hasNotText: 'open now' }).getByTestId('proj-open').tap();
    await expect.poll(() => lane0Sum(page)).toBe(1);
  });

  test('sheet fits 360x640 and screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await startEngine(page);
    await openProjects(page);
    for (let i = 0; i < 3; i++) {
      await page.getByTestId('proj-new').tap();
      await page.waitForTimeout(300);
      await openProjects(page);
    }
    await rows(page).first().getByTestId('proj-menu').tap();
    const b = (await page.locator('.sheet-wrap.open .sheet').boundingBox())!;
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height).toBeLessThanOrEqual(640.5);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'docs/screenshots/projects-390x844.png' });
  });
});
