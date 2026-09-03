export const NARROW_PX = 860;
/** Desktop layout must keep this many activity log lines visible. */
export const ACTIVITY_LINES = 3;

function rootFontPx() {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

function cssPx(cs, prop) {
  return Number.parseFloat(cs[prop]) || 0;
}

function lineHeightPx(el) {
  const cs = getComputedStyle(el);
  const fontSize = cssPx(cs, 'fontSize') || rootFontPx();
  const raw = String(cs.lineHeight || '');
  if (!raw || raw === 'normal') return fontSize * 1.2;
  if (raw.endsWith('%')) return fontSize * (Number.parseFloat(raw) / 100);
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : fontSize * 1.2;
}

function isDesktopChromeVisible(rail) {
  const brand = rail && rail.querySelector('.brand');
  if (!brand) return false;
  return getComputedStyle(brand).display !== 'none' && brand.offsetHeight > 0;
}

function desktopChromeHeight(rail) {
  if (!rail) return 0;
  const brand = rail.querySelector('.brand');
  const controls = rail.querySelector('.controls');
  if (!brand || !controls) return 0;
  if (!isDesktopChromeVisible(rail)) return 0;
  const gap = Number.parseFloat(getComputedStyle(rail).gap) || 0;
  return brand.offsetHeight + controls.offsetHeight + gap * 2;
}

function desktopPadY(app) {
  if (app && app.offsetHeight > 0) {
    const cs = getComputedStyle(app);
    if (cs.display === 'grid') {
      return cssPx(cs, 'paddingTop') + cssPx(cs, 'paddingBottom');
    }
  }
  return 3.5 * rootFontPx();
}

function marginBoxHeight(el) {
  if (!el) return 0;
  const cs = getComputedStyle(el);
  const margins = cssPx(cs, 'marginTop') + cssPx(cs, 'marginBottom');
  if (el.offsetHeight > 0) return el.offsetHeight + margins;
  const lh = lineHeightPx(el);
  return lh
    + cssPx(cs, 'paddingTop')
    + cssPx(cs, 'paddingBottom')
    + cssPx(cs, 'borderTopWidth')
    + cssPx(cs, 'borderBottomWidth')
    + margins;
}

function minLogWindowHeight(logWindow) {
  const root = rootFontPx();
  if (!logWindow) {
    const lh = 0.8125 * root * 1.45;
    const gap = 0.2 * root;
    const pad = 1.4 * root;
    return pad + 2 + ACTIVITY_LINES * lh + (ACTIVITY_LINES - 1) * gap;
  }
  const cs = getComputedStyle(logWindow);
  const lh = lineHeightPx(logWindow);
  const entry = logWindow.querySelector('.log-entry');
  const gap = entry
    ? cssPx(getComputedStyle(entry), 'marginBottom')
    : 0.2 * root;
  return cssPx(cs, 'paddingTop')
    + cssPx(cs, 'paddingBottom')
    + cssPx(cs, 'borderTopWidth')
    + cssPx(cs, 'borderBottomWidth')
    + ACTIVITY_LINES * lh
    + (ACTIVITY_LINES - 1) * gap;
}

function activityChromeHeight(rail) {
  const panel = rail && rail.querySelector('.log-panel');
  if (!panel) return { value: 0, reliable: false };
  const cs = getComputedStyle(panel);
  const pad = cssPx(cs, 'paddingTop')
    + cssPx(cs, 'paddingBottom')
    + cssPx(cs, 'borderTopWidth')
    + cssPx(cs, 'borderBottomWidth');
  const heading = panel.querySelector('h2');
  const stats = panel.querySelector('.stats');
  const statsEl = stats;
  const reliable = Boolean(statsEl && statsEl.offsetHeight > 0);
  return {
    value: pad + marginBoxHeight(heading) + marginBoxHeight(statsEl),
    reliable,
  };
}

function mergeCache(cache, next) {
  const prev = cache || {};
  return {
    chrome: next.chrome || prev.chrome || 0,
    padY: next.padY || prev.padY || 0,
    activityChrome: next.activityChrome || prev.activityChrome || 0,
  };
}

export function measureLayout(rail, app, cache = {}) {
  const vp = viewportSignals();
  const desktopVisible = isDesktopChromeVisible(rail);
  const measuredChrome = desktopChromeHeight(rail);
  const measuredPadY = desktopPadY(app);
  const logWindow = rail && rail.querySelector('.log-window');
  const minWindow = minLogWindowHeight(logWindow);
  const measuredActivity = activityChromeHeight(rail);

  const chrome = measuredChrome || cache.chrome || 0;
  const padY = desktopVisible ? measuredPadY : (cache.padY || measuredPadY);
  const activityChrome = measuredActivity.reliable
    ? measuredActivity.value
    : (cache.activityChrome || measuredActivity.value);

  const available = vp.innerHeight - padY;
  const leftover = available - chrome - activityChrome;
  const widthCompact = vp.innerWidth <= NARROW_PX;
  const heightCompact = chrome > 0 && leftover < minWindow;
  const nextCache = mergeCache(cache, {
    chrome: measuredChrome,
    padY: desktopVisible ? measuredPadY : 0,
    activityChrome: measuredActivity.reliable ? measuredActivity.value : 0,
  });

  return {
    vp,
    padY,
    measuredChrome,
    cachedChrome: cache.chrome || 0,
    chrome,
    activityChrome,
    measuredActivityChrome: measuredActivity.value,
    activityChromeReliable: measuredActivity.reliable,
    minWindow,
    activityLines: ACTIVITY_LINES,
    available,
    leftover,
    narrowPx: NARROW_PX,
    widthCompact,
    heightCompact,
    compactDecision: widthCompact || heightCompact,
    cache: nextCache,
    desktopVisible,
  };
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

export function inspectLayout({ rail, app, compact, cache } = {}) {
  const measured = measureLayout(rail, app, cache || {});
  const brand = rail && rail.querySelector('.brand');
  const controls = rail && rail.querySelector('.controls');
  const logPanel = rail && rail.querySelector('.log-panel');
  const logWindow = rail && rail.querySelector('.log-window');
  const stats = rail && rail.querySelector('.stats');

  return {
    ...measured,
    compactNow: Boolean(compact),
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
      logWindow: box(logWindow),
      stats: box(stats),
    },
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '(absent)',
    platform: typeof navigator !== 'undefined' ? navigator.platform : '(absent)',
  };
}

export function shouldUseCompactLayout(rail, app, cache) {
  const measured = measureLayout(rail, app, cache || {});
  return {
    compact: measured.compactDecision,
    cache: measured.cache,
    chrome: measured.chrome,
  };
}

export function formatLayoutReport(inspect) {
  const lines = [];
  lines.push('Vanity Domain — layout detection');
  lines.push(new Date().toISOString());
  lines.push('');
  lines.push('== Result ==');
  lines.push(`Compact now: ${inspect.compactNow}`);
  lines.push(`Decision: compact=${inspect.compactDecision} (width=${inspect.widthCompact}, height=${inspect.heightCompact})`);
  lines.push(`Width: innerWidth ${inspect.vp.innerWidth} ${inspect.widthCompact ? '≤' : '>'} ${inspect.narrowPx}`);
  lines.push(`Height: leftover for log window ${inspect.leftover}px ${inspect.heightCompact ? '<' : '≥'} ${inspect.minWindow}px (${inspect.activityLines} lines)`);
  lines.push('');
  lines.push('== Interpretation ==');
  lines.push(`1. Width check: innerWidth ${inspect.vp.innerWidth} vs ${inspect.narrowPx} → ${inspect.widthCompact ? 'COMPACT' : 'desktop'}`);
  lines.push(`2. Settings chrome (brand + controls + rail gaps): measured ${inspect.measuredChrome}px, used ${inspect.chrome}px`);
  lines.push(`3. Activity chrome (panel padding + heading + stats): measured ${inspect.measuredActivityChrome}px (${inspect.activityChromeReliable ? 'live' : 'cached/estimated'}), used ${inspect.activityChrome}px`);
  lines.push(`4. ${inspect.activityLines}-line activity window: ${inspect.minWindow}px`);
  lines.push(`5. App vertical padding: ${inspect.padY}px`);
  lines.push(`6. innerHeight ${inspect.vp.innerHeight} − pad ${inspect.padY} − chrome ${inspect.chrome} − activity chrome ${inspect.activityChrome} = leftover ${inspect.leftover}px`);
  lines.push(`7. Height check: leftover ${inspect.leftover} vs ${inspect.minWindow} → ${inspect.heightCompact ? 'COMPACT' : 'desktop'}`);
  lines.push(`8. devicePixelRatio ${inspect.vp.devicePixelRatio}; screen ${inspect.vp.screen.width}×${inspect.vp.screen.height} (avail ${inspect.vp.screen.availWidth}×${inspect.vp.screen.availHeight})`);
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
  lines.push(`boxes.logWindow: ${dump(inspect.boxes.logWindow)}`);
  lines.push(`boxes.stats: ${dump(inspect.boxes.stats)}`);
  lines.push('');
  return lines.join('\n');
}
