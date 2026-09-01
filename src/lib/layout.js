const NARROW_PX = 860;
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

export function shouldUseCompactLayout(rail, cachedChrome) {
  if (window.innerWidth <= NARROW_PX) return { compact: true, chrome: cachedChrome };
  const measured = desktopChromeHeight(rail);
  const chrome = measured || cachedChrome;
  if (!chrome) return { compact: false, chrome: 0 };
  const available = window.innerHeight - desktopPadY();
  return { compact: available - chrome < MIN_ACTIVITY_PX, chrome };
}
