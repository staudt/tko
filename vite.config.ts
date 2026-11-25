/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { serviceWorker } from './scripts/sw-plugin';

export default defineConfig(({ mode }) => ({
  base: './',
  // `pnpm dev:lan` serves https on the LAN (self-signed) so the phone gets a secure context for AudioWorklet.
  plugins: [
    // Engine modules also run inside the AudioWorklet (no DOM): keep Preact's dev injection out of them.
    preact({ exclude: [/\/src\/engine\//, /\/src\/platform\/recorderWorklet\.ts$/] }),
    serviceWorker(),
    ...(mode === 'lan' ? [basicSsl()] : []),
  ],
  build: { rollupOptions: { input: { main: 'index.html', lookdev: 'lookdev.html' } } },
  test: {
    environment: 'node',
    // TOOLS=1 runs build tools in tools/ (factory sound rendering) instead of the test suite.
    include: process.env.TOOLS ? ['tools/**/*.tool.ts'] : ['src/**/*.test.ts', 'tests/unit/**/*.test.ts', 'tests/audio/**/*.test.ts'],
    testTimeout: process.env.TOOLS ? 300_000 : 5_000,
  },
}));
