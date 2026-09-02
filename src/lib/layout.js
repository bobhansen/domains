export const NARROW_PX = 860;
const MIN_ACTIVITY_PX = 180;

function desktopChromeHeight(rail) {
  if (!rail) return 0;
  const brand = rail.querySelector('.brand');
  const controls = rail.querySelector('.controls');
  if (!brand || !controls) return 0;
  if (getComputedStyle(brand).display === 'none') return 0;
  const gap = Number.parseFloat(getComputedStyle(rail).gap) || 0;
  return brand.offsetHeight + controls.offsetHeight + gap * 2;
}

function desktopPadY() {
  const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return 3.5 * root;
}

function dump(value) {
  if (value === undefined) return '(undefined)';
  if (value === null) return '(null)';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function box(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    tag: el.tagName,
    className: String(el.className || ''),
    offsetWidth: el.offsetWidth,
    offsetHeight: el.offsetHeight,
    clientWidth: el.clientWidth,
    clientHeight: el.clientHeight,
    scrollWidth: el.scrollWidth,
    scrollHeight: el.scrollHeight,
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    display: cs.display,
    visibility: cs.visibility,
    position: cs.position,
  };
}

function media(query) {
  try {
    return { query, matches: window.matchMedia(query).matches };
  } catch (err) {
    return { query, error: String(err && err.message ? err.message : err) };
  }
}

function viewportSignals() {
  let visual = '(absent)';
  try {
    if (window.visualViewport) {
      const v = window.visualViewport;
      visual = {
        width: v.width,
        height: v.height,
        scale: v.scale,
        offsetLeft: v.offsetLeft,
        offsetTop: v.offsetTop,
        pageLeft: v.pageLeft,
        pageTop: v.pageTop,
      };
    }
  } catch (err) {
    visual = `(error: ${err && err.message ? err.message : err})`;
  }

  const root = document.documentElement;
  const body = document.body;
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    devicePixelRatio: window.devicePixelRatio,
    screenX: window.screenX,
    screenY: window.screenY,
    screen: {
      width: window.screen && window.screen.width,
      height: window.screen && window.screen.height,
      availWidth: window.screen && window.screen.availWidth,
      availHeight: window.screen && window.screen.availHeight,
      colorDepth: window.screen && window.screen.colorDepth,
      pixelDepth: window.screen && window.screen.pixelDepth,
    },
    visualViewport: visual,
    documentElement: {
      clientWidth: root.clientWidth,
      clientHeight: root.clientHeight,
      scrollWidth: root.scrollWidth,
      scrollHeight: root.scrollHeight,
      fontSize: getComputedStyle(root).fontSize,
    },
    body: body ? {
      clientWidth: body.clientWidth,
      clientHeight: body.clientHeight,
    } : '(missing)',
    scrollbarGutter: window.innerWidth - root.clientWidth,
  };
}

export function inspectLayout({ rail, app, compact, cachedChrome } = {}) {
  const vp = viewportSignals();
  const padY = desktopPadY();
  const measuredChrome = desktopChromeHeight(rail);
  const chrome = measuredChrome || cachedChrome || 0;
  const available = vp.innerHeight - padY;
  const leftover = available - chrome;
  const widthCompact = vp.innerWidth <= NARROW_PX;
  const heightWouldCompact = !widthCompact && chrome > 0 && leftover < MIN_ACTIVITY_PX;
  const brand = rail && rail.querySelector('.brand');
  const controls = rail && rail.querySelector('.controls');
  const logPanel = rail && rail.querySelector('.log-panel');

  return {
    vp,
    padY,
    measuredChrome,
    cachedChrome: cachedChrome || 0,
    chrome,
    available,
    leftover,
    minActivity: MIN_ACTIVITY_PX,
    narrowPx: NARROW_PX,
    widthCompact,
    heightWouldCompact,
    compactNow: Boolean(compact),
    compactDecision: widthCompact,
    media: [
      media(`(max-width: ${NARROW_PX}px)`),
      media('(hover: hover)'),
      media('(pointer: coarse)'),
      media('(pointer: fine)'),
      media('(display-mode: fullscreen)'),
    ],
    boxes: {
      app: box(app),
      rail: box(rail),
      brand: box(brand),
      controls: box(controls),
      logPanel: box(logPanel),
    },
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '(absent)',
    platform: typeof navigator !== 'undefined' ? navigator.platform : '(absent)',
  };
}

export function shouldUseCompactLayout(rail, cachedChrome) {
  const measured = desktopChromeHeight(rail);
  return {
    compact: window.innerWidth <= NARROW_PX,
    chrome: measured || cachedChrome,
  };
}

export function formatLayoutReport(inspect) {
  const lines = [];
  lines.push('Vanity Domain — layout detection');
  lines.push(new Date().toISOString());
  lines.push('');
  lines.push('== Result ==');
  lines.push(`Compact now: ${inspect.compactNow}`);
  lines.push(`Decision (width-only): compact=${inspect.compactDecision} because innerWidth ${inspect.vp.innerWidth} ${inspect.widthCompact ? '≤' : '>'} ${inspect.narrowPx}`);
  lines.push(`Legacy height leftover: ${inspect.leftover}px (need ≥ ${inspect.minActivity}); would have forced compact: ${inspect.heightWouldCompact}`);
  if (inspect.heightWouldCompact && !inspect.widthCompact) {
    lines.push('Note: older builds used leftover < 180px to enter compact on wide windows. Windows DPI + Firefox UI often shrink CSS height enough to trip that.');
  }
  lines.push('');
  lines.push('== Interpretation ==');
  lines.push(`1. Width check: innerWidth ${inspect.vp.innerWidth} vs ${inspect.narrowPx} → ${inspect.widthCompact ? 'COMPACT' : 'desktop'}`);
  lines.push(`2. Root font-size ${inspect.vp.documentElement.fontSize}; vertical app padding ≈ ${inspect.padY}px (3.5rem)`);
  lines.push(`3. innerHeight ${inspect.vp.innerHeight} − pad ${inspect.padY} = available ${inspect.available}px for the rail`);
  lines.push(`4. Rail chrome: measured ${inspect.measuredChrome}px, cached ${inspect.cachedChrome}px, used ${inspect.chrome}px`);
  lines.push(`   (brand + controls + two gaps; 0 if .brand is display:none)`);
  lines.push(`5. Leftover for Activity: ${inspect.available} − ${inspect.chrome} = ${inspect.leftover}px`);
  lines.push(`6. devicePixelRatio ${inspect.vp.devicePixelRatio}; screen ${inspect.vp.screen.width}×${inspect.vp.screen.height} (avail ${inspect.vp.screen.availWidth}×${inspect.vp.screen.availHeight})`);
  lines.push(`7. CSS vs screen: if screen is much larger than innerWidth/innerHeight, OS scaling or browser zoom is shrinking CSS pixels.`);
  lines.push('');
  lines.push('== Raw signals ==');
  lines.push(`window.innerWidth/Height: ${inspect.vp.innerWidth} × ${inspect.vp.innerHeight}`);
  lines.push(`window.outerWidth/Height: ${inspect.vp.outerWidth} × ${inspect.vp.outerHeight}`);
  lines.push(`devicePixelRatio: ${inspect.vp.devicePixelRatio}`);
  lines.push(`screen: ${dump(inspect.vp.screen)}`);
  lines.push(`screenX/Y: ${inspect.vp.screenX}, ${inspect.vp.screenY}`);
  lines.push(`visualViewport: ${dump(inspect.vp.visualViewport)}`);
  lines.push(`documentElement: ${dump(inspect.vp.documentElement)}`);
  lines.push(`body: ${dump(inspect.vp.body)}`);
  lines.push(`innerWidth − clientWidth (scrollbar): ${inspect.vp.scrollbarGutter}`);
  inspect.media.forEach((m) => lines.push(`matchMedia ${m.query}: ${m.error ? m.error : m.matches}`));
  lines.push(`userAgent: ${dump(inspect.userAgent)}`);
  lines.push(`platform: ${dump(inspect.platform)}`);
  lines.push(`boxes.app: ${dump(inspect.boxes.app)}`);
  lines.push(`boxes.rail: ${dump(inspect.boxes.rail)}`);
  lines.push(`boxes.brand: ${dump(inspect.boxes.brand)}`);
  lines.push(`boxes.controls: ${dump(inspect.boxes.controls)}`);
  lines.push(`boxes.logPanel: ${dump(inspect.boxes.logPanel)}`);
  lines.push('');
  return lines.join('\n');
}
