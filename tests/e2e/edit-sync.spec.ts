// After a reload, write mode must edit the pattern that plays (the chain's first pattern).
import { expect, test } from '@playwright/test';
import { center, commands, startEngine, Touch } from './helpers';

test.describe('edit pattern follows the chain', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch only');

  test('reload keeps editing the playing pattern', async ({ page }) => {
    await startEngine(page);
    const t = await Touch.open(page);
    const pat = await center(page.getByRole('button', { name: 'PATTERN', exact: true }));
    const p4 = await center(page.getByTestId('pad-4'));
    await t.down(1, pat.x, pat.y);
    await t.down(2, p4.x, p4.y);
    await t.up(2);
    await t.up(1);
    await expect.poll(async () => (await commands(page)).some((c) => c.type === 'chain' && JSON.stringify(c.patterns) === '[3]')).toBe(true);
    await page.waitForTimeout(1200); // autosave
    await page.reload();
    await startEngine(page);
    const t2 = await Touch.open(page);
    const w = await center(page.getByRole('button', { name: 'WRITE', exact: true }));
    await t2.down(1, w.x, w.y);
    await page.waitForTimeout(40);
    await t2.up(1);
    const s1 = await center(page.getByTestId('pad-1'));
    await t2.down(1, s1.x, s1.y);
    await page.waitForTimeout(40);
    await t2.up(1);
    await expect.poll(async () => (await commands(page)).filter((c) => c.type === 'pattern').pop()?.index).toBe(3);
  });
});
