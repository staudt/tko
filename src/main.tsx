import { render } from 'preact';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './ui/tokens.css';
import './ui/ui.css';
import { App } from './app/App';
import { applyFactoryMeta } from './store/factoryMeta';
import { startAudio } from './engine/host';

// Unlock audio on the first touch anywhere (idempotent; also resumes after interruptions).
window.addEventListener('pointerdown', () => void startAudio().catch(() => {}), { capture: true });

void applyFactoryMeta().catch(() => {});
render(<App />, document.getElementById('app')!);

// Offline support (production builds only).
if (import.meta.env.MODE === 'production' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
