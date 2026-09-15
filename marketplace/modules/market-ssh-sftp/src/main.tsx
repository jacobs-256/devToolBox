import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';
import { initSdkEvents } from './sdk';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function applyTheme(v: unknown) {
  if (v === 'dark' || v === 'light') document.documentElement.dataset.theme = v;
}

applyTheme(new URLSearchParams(window.location.search).get('theme'));
window.addEventListener('message', (e) => {
  if (!isRecord(e.data)) return;
  if (e.data.type === 'devtoolbox:theme') applyTheme(e.data.theme);
});

initSdkEvents();
createRoot(document.getElementById('root')!).render(<App />);
