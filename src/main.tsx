import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { AppUpdateNotice } from './components/common/AppUpdateNotice.js';
import './index.css';
import './themes.css';
import './comics.css';
import './aero.css';
import { prepareOfflineApp } from './lib/offline/appShell.js';

import { initializeAppearance } from './lib/appearance.js';
import { startAeroIntro } from './lib/appearance/aeroIntro.js';
void initializeAppearance();

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
  const app = document.getElementById('root')!;
  startAeroIntro(app);
  createRoot(app).render(
    <StrictMode>
      <App />
      <AppUpdateNotice />
    </StrictMode>,
  );
  void prepareOfflineApp();
}

void start();
