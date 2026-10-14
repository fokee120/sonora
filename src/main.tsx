import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

async function start() {
  // Retire workers installed by older dev builds without deleting the user's
  // IndexedDB music/downloads. Production retains normal offline PWA support.
  if (import.meta.env.DEV && 'serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const own = registrations.filter(registration => registration.scope === new URL('/', location.href).href);
      await Promise.all(own.map(registration => registration.unregister()));
      if (own.length && navigator.serviceWorker.controller) {
        location.reload();
        return;
      }
    } catch (error) { console.warn('Could not retire development service worker:', error); }
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
