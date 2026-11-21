import { playerEngine } from '../audio/PlayerEngine.js';

function showBubbles(app: HTMLElement, playIntro?: () => void) {
  const scene = document.createElement('button');
  scene.type = 'button';
  scene.className = 'aero-startup';
  scene.setAttribute('aria-label', 'Open Sonora');

  // Give each depth band a single moving layer instead of animating every bubble.
  const bands = Array.from({ length: 4 }, (_, depth) => {
    const band = document.createElement('span');
    band.className = 'aero-startup-band';
    band.setAttribute('aria-hidden', 'true');
    band.style.setProperty('--depth', String(depth));
    scene.append(band);
    return band;
  });

  // Use a width-based spacing and top-anchored coordinates. A height change
  // can reveal more rows without dragging already visible bubbles downward.
  const width = document.documentElement.clientWidth || window.innerWidth;
  const columns = Math.max(3, Math.ceil(width / 155));
  const cellSize = width / columns;
  const rows = Math.ceil(window.innerHeight / cellSize) + 1;
  const bubble = (band: HTMLElement, x: number, y: number, diameter: number, dot = false) => {
    const circle = document.createElement('i');
    circle.className = dot ? 'aero-startup-bubble aero-startup-dot' : 'aero-startup-bubble';
    circle.style.left = x + '%';
    circle.style.top = y + 'px';
    circle.style.width = diameter + 'px';
    band.append(circle);
  };

  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const seed = (column * 19 + row * 31) % 13;
      const x = (column + (row % 2) * .49 - .24) * 100 / columns;
      const y = (row + (seed - 6) * .038) * cellSize;
      const band = bands[seed % bands.length];
      bubble(band, x, y, cellSize * (.86 + seed * .059));
      if (column < columns && row < rows) {
        const nextBand = bands[(seed + 1) % bands.length];
        bubble(nextBand, x + 47 / columns, y + .4 * cellSize, 4 + seed, true);
        bubble(nextBand, x + 69 / columns, y + .58 * cellSize, 3 + seed * .38, true);
      }
    }
  }

  const documentRoot = document.documentElement;
  documentRoot.classList.add('aero-starting');
  const wasInert = app.inert;
  app.inert = true;
  document.body.append(scene);

  scene.addEventListener('click', () => {
    playIntro?.();
    app.inert = wasInert;
    const removeOpening = () => {
      scene.remove();
      documentRoot.classList.remove('aero-starting');
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      removeOpening();
      return;
    }

    scene.tabIndex = -1;
    if (document.activeElement === scene) scene.blur();
    scene.setAttribute('aria-hidden', 'true');
    scene.classList.add('is-releasing');
    const cleanup = () => {
      clearTimeout(deadline);
      removeOpening();
    };
    const deadline = window.setTimeout(cleanup, 1700);
    scene.addEventListener('animationend', event => {
      if (event.target === scene && event.animationName === 'aero-startup-clear') cleanup();
    });
  }, { once: true });
}

function prepareIntroSound(): (() => void) | undefined {
  const occupied = () => {
    const { isPlaying, isLoading } = playerEngine.getState();
    return isPlaying || isLoading;
  };

  // Keep the intro outside the song element and its lock-screen Media Session.
  const Audio = window.AudioContext;
  if (!Audio) return;
  let context: AudioContext;
  try { context = new Audio(); } catch { return; }

  const request = new AbortController();
  const listenerOptions = { signal: request.signal };
  const theme = new MutationObserver(() => {
    if (document.documentElement.dataset.style !== 'aero') stop();
  });
  let buffer: AudioBuffer | undefined;
  let source: AudioBufferSourceNode | undefined;
  let activated = false;
  let stopped = false;
  let deadline: number | undefined;
  const stopWatchingPlayer = playerEngine.subscribe(state => {
    if (state.isPlaying || state.isLoading) queueMicrotask(stop);
  });

  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(deadline);
    request.abort();
    theme.disconnect();
    stopWatchingPlayer();
    if (source) {
      source.onended = null;
      source.disconnect();
    }
    void context.close().catch(() => {});
  }

  function startWhenReady() {
    if (!activated || stopped || !buffer || source || context.state !== 'running') return;
    if (document.hidden || occupied()) { stop(); return; }
    source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = stop;
    source.start();
  }

  context.addEventListener('statechange', () => {
    if (source && context.state !== 'running') stop();
    else startWhenReady();
  }, listenerOptions);
  window.addEventListener('pagehide', event => {
    if (activated || !event.persisted) stop();
  }, listenerOptions);
  document.addEventListener('visibilitychange', () => {
    if (activated && document.hidden) stop();
  }, listenerOptions);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-style'] });

  void fetch('/themes/aero/intro.m4a', { signal: request.signal })
    .then(response => {
      if (!response.ok) throw new Error('Aero intro unavailable');
      return response.arrayBuffer();
    })
    .then(bytes => stopped ? undefined : context.decodeAudioData(bytes))
    .then(decoded => { buffer = decoded; startWhenReady(); })
    .catch(stop);

  return () => {
    if (stopped || document.hidden || occupied()) { stop(); return; }
    activated = true;
    deadline = window.setTimeout(() => { if (!source) stop(); }, 8000);
    // Safari requires resume() inside the original trusted activation.
    void context.resume().then(startWhenReady, stop);
    startWhenReady();
  };
}

export function startAeroIntro(app: HTMLElement) {
  if (document.documentElement.dataset.style !== 'aero') return;
  showBubbles(app, prepareIntroSound());
}
