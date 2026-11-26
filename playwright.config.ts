import { defineConfig, devices } from '@playwright/test';

// PW_PORT lets two test runs (e.g. parallel agents) use separate preview servers.
const PORT = Number(process.env.PW_PORT ?? 4174);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  // Each test runs the real audio engine (AudioWorklet) in its own browser: too many in parallel
  // starves the CPU and makes timing-based tests flaky. Cap the workers.
  workers: process.env.CI ? 2 : 3,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${PORT}/`,
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, browserName: 'chromium' }, testIgnore: /engine-render/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `pnpm exec vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
