const FALLBACK_MIN_WIDTH = 11.5 * 16;
const FALLBACK_ROW_HEIGHT = 5.5 * 16;

function cssLengthToPx(length, fallback) {
  const raw = String(length || '').trim();
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  if (raw.endsWith('rem')) {
    const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    return n * (Number.isFinite(root) ? root : 16);
  }
  return n;
}

export function fitCount(width, height, minCol, rowH, gapX, gapY, max) {
  if (width < 8 || height < 8) return 0;
  if (minCol <= 0 || rowH <= 0) return 1;
  const cols = Math.max(1, Math.floor((width + gapX) / (minCol + gapX)));
  const rows = Math.max(1, Math.floor((height + gapY) / (rowH + gapY)));
  return Math.max(1, Math.min(max, cols * rows));
}

export function countGridCapacity(grid, max = 250) {
  if (!grid) return 0;
  const cs = getComputedStyle(grid);
  const gapX = Number.parseFloat(cs.columnGap) || 0;
  const gapY = Number.parseFloat(cs.rowGap) || 0;
  const minCol = cssLengthToPx(cs.getPropertyValue('--chit-min-width'), FALLBACK_MIN_WIDTH);
  const rowH = cssLengthToPx(cs.getPropertyValue('--chit-row-height'), FALLBACK_ROW_HEIGHT);

  const slot = grid.closest('.stage-slot');
  const stage = grid.closest('.stage');
  let width = grid.clientWidth;
  let height = grid.clientHeight;

  if (slot && stage) {
    const stageCs = getComputedStyle(stage);
    const padX = (Number.parseFloat(stageCs.paddingLeft) || 0)
      + (Number.parseFloat(stageCs.paddingRight) || 0);
    const padY = (Number.parseFloat(stageCs.paddingTop) || 0)
      + (Number.parseFloat(stageCs.paddingBottom) || 0);
    const stageGap = Number.parseFloat(stageCs.rowGap) || Number.parseFloat(stageCs.gap) || 0;
    const head = stage.querySelector('.stage-head');
    const headH = head ? head.getBoundingClientRect().height : 0;
    width = Math.max(0, slot.clientWidth - padX);
    height = Math.max(0, slot.clientHeight - padY - headH - stageGap);
  }

  return fitCount(width, height, minCol, rowH, gapX, gapY, max);
}

export function visibleResults(results, capacity) {
  const cap = Math.max(0, capacity);
  if (cap < 1) return [];
  if (!results.length) return results;
  return results.slice(0, cap);
}
