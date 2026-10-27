import { useLayoutEffect } from 'react';

export function useAppViewport() {
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    let stableHeight = window.innerHeight;
    const update = () => {
      // Safari can report a stale layout viewport after a standalone launch or
      // keyboard dismissal. Keep the shell and its dock in the visible viewport.
      const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
      const typing = document.activeElement?.matches('input, textarea, [contenteditable="true"]');
      // In black-translucent iOS standalone apps even 100dvh can exclude the
      // status-bar height. There is no browser toolbar in standalone mode:
      // use the large viewport for both the document and the app, not dvh/100%.
      const keyboard = typing && viewport && viewport.height < window.innerHeight - 120;
      const fullScreenHeight = CSS.supports('height', '100lvh') ? '100lvh' : '100vh';
      if (!keyboard) stableHeight = viewport && viewport.scale === 1 ? viewport.height : window.innerHeight;
      const height = standalone ? fullScreenHeight : `${keyboard ? stableHeight : (viewport && viewport.scale === 1 ? viewport.height : window.innerHeight)}px`;
      document.documentElement.style.setProperty('--app-height', height);
      document.documentElement.classList.toggle('keyboard-open', !!keyboard);
    };
    update();
    viewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    window.addEventListener('pageshow', update);
    document.addEventListener('visibilitychange', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('pageshow', update);
      document.removeEventListener('visibilitychange', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      document.documentElement.classList.remove('keyboard-open');
    };
  }, []);
}
