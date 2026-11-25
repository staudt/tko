import { defineConfig, devices } from '@playwright/test';

// PW_PORT lets two test runs (e.g. parallel agents) use separate preview servers.
const PORT = Number(process.env.PW_PORT ?? 4174);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
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
