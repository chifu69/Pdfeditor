function centerY(meta) {
  return meta.y + meta.height / 2;
}

function angleDistance(a = 0, b = 0) {
  const full = Math.PI * 2;
  let d = Math.abs(a - b) % full;
  if (d > Math.PI) d = full - d;
  return d;
}

function needsSpace(previous, current) {
  const prevText = previous.item?.str ?? previous.text ?? '';
  const nextText = current.item?.str ?? current.text ?? '';
  if (!prevText || !nextText || /\s$/.test(prevText) || /^\s/.test(nextText)) return false;
  const gap = current.x - (previous.x + previous.width);
  const font = Math.max(1, Math.min(previous.fontHeight || previous.height, current.fontHeight || current.height));
  return gap > Math.max(1.5, font * 0.16);
}

function makeBlock(items, index) {
  const left = Math.min(...items.map(m => m.x));
  const top = Math.min(...items.map(m => m.y));
  const right = Math.max(...items.map(m => m.x + m.width));
  const bottom = Math.max(...items.map(m => m.y + m.height));
  const heights = items.map(m => m.fontHeight || m.height).filter(Number.isFinite).sort((a, b) => a - b);
  const fontHeight = heights.length ? heights[Math.floor(heights.length / 2)] : Math.max(6, bottom - top);
  let text = '';
  items.forEach((meta, i) => {
    const value = meta.item?.str ?? meta.text ?? '';
    if (i && needsSpace(items[i - 1], meta)) text += ' ';
    text += value;
  });
  return {
    idx: index,
    items,
    item: items[0]?.item,
    text,
    x: left,
    y: top,
    width: Math.max(4, right - left),
    height: Math.max(6, bottom - top),
    fontHeight,
    angle: items[0]?.angle || 0,
    isTextBlock: true
  };
}

/**
 * Merge the small spans returned by PDF.js into touch-friendly editable line blocks.
 * It deliberately splits large horizontal gaps so table columns and separate fields
 * do not become one giant editable box.
 */
export function groupTextMetasIntoBlocks(metas, options = {}) {
  const verticalFactor = options.verticalFactor ?? 0.58;
  const gapFactor = options.gapFactor ?? 2.15;
  const minGapLimit = options.minGapLimit ?? 22;
  const angleTolerance = options.angleTolerance ?? 0.08;
  const blocks = [];
  let current = [];

  const flush = () => {
    if (!current.length) return;
    blocks.push(makeBlock(current, blocks.length));
    current = [];
  };

  for (const meta of metas) {
    if (!meta || !(meta.item?.str ?? meta.text ?? '').trim()) continue;
    if (!current.length) {
      current.push(meta);
      continue;
    }

    const previous = current[current.length - 1];
    const baseHeight = Math.max(6, Math.min(previous.fontHeight || previous.height, meta.fontHeight || meta.height));
    const sameBaseline = Math.abs(centerY(previous) - centerY(meta)) <= Math.max(3, baseHeight * verticalFactor);
    const sameAngle = angleDistance(previous.angle || 0, meta.angle || 0) <= angleTolerance;
    const gap = meta.x - (previous.x + previous.width);
    const maxGap = Math.max(minGapLimit, Math.max(previous.fontHeight || previous.height, meta.fontHeight || meta.height) * gapFactor);
    const notFarLeft = meta.x >= previous.x - baseHeight * 0.6;
    const contiguous = gap <= maxGap && notFarLeft;
    const forcedBreak = previous.item?.hasEOL === true;

    if (!forcedBreak && sameBaseline && sameAngle && contiguous) current.push(meta);
    else {
      flush();
      current.push(meta);
    }
  }
  flush();
  return blocks;
}
