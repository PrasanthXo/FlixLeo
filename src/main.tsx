import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const splash = document.getElementById('flixleo-startup');
    splash?.classList.add('is-ready');
    window.setTimeout(() => splash?.remove(), 350);
  });
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
