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
import { project, replaceProject } from './store/project';
import { loadCurrentProject, startPersistence } from './store/persist';

// Unlock audio on the first touch anywhere (idempotent; also resumes after interruptions).
window.addEventListener('pointerdown', () => void startAudio().catch(() => {}), { capture: true });

// Restore the last session (autosaved to IndexedDB), then keep saving every change.
void (async () => {
  const saved = await loadCurrentProject();
  if (saved) replaceProject(saved);
  await applyFactoryMeta().catch(() => {});
  startPersistence(() => project.peek(), (cb) => project.subscribe(() => cb()));
})();
render(<App />, document.getElementById('app')!);

// Offline support (production builds only).
if (import.meta.env.MODE === 'production' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
