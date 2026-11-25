import type { CDPSession, Locator, Page } from '@playwright/test';

export type Cmd = { type: string; [k: string]: unknown };
export const commands = (page: Page): Promise<Cmd[]> => page.evaluate(() => [...(window as unknown as { __tko: { commands: Cmd[] } }).__tko.commands] as Cmd[]);

export async function center(loc: Locator): Promise<{ x: number; y: number }> {
  const b = (await loc.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Multi-finger CDP touch session: fingers are addressed by id; releasing ends the given ids. */
export class Touch {
  private pts = new Map<number, { x: number; y: number }>();
  constructor(private s: CDPSession) {}
  static async open(page: Page): Promise<Touch> {
    return new Touch(await page.context().newCDPSession(page));
  }
  private list() {
    return [...this.pts].map(([id, p]) => ({ id, x: p.x, y: p.y }));
  }
  async down(id: number, x: number, y: number): Promise<void> {
    this.pts.set(id, { x, y });
    await this.s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: this.list() });
  }
  async move(id: number, x: number, y: number): Promise<void> {
    this.pts.set(id, { x, y });
    await this.s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.list() });
  }
  async up(id: number): Promise<void> {
    const p = this.pts.get(id)!;
    this.pts.delete(id);
    // Chromium: touchEnd lists the points being released.
    await this.s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ id, x: p.x, y: p.y }] });
  }
  async cancel(): Promise<void> {
    this.pts.clear();
    await this.s.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  }
}

/** First tap starts the engine; wait until it has posted its initial commands. */
export async function startEngine(page: Page): Promise<void> {
  await page.goto('/');
  const t = await Touch.open(page);
  const c = await center(page.getByTestId('lcd'));
  await t.down(0, c.x, c.y);
  await t.up(0);
  await page.waitForFunction(() => (window as unknown as { __tko?: { commands: Cmd[] } }).__tko?.commands.some((x) => x.type === 'tempo'), null, { timeout: 20_000 });
}
