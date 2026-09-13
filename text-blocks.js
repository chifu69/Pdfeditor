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

    if (Math.abs(meta.angle || 0) < .001 && Math.abs(previous.angle || 0) < .001 && !forcedBreak && sameBaseline && sameAngle && contiguous) current.push(meta);
    else {
      flush();
      current.push(meta);
    }
  }
  flush();
  return blocks;
}

/**
 * Normalize the browser geometry produced by PDF.js TextLayer into visual
 * line/block targets. TextLayer gives us the same span positions that the
 * browser uses, which is substantially more reliable on Safari/iPhone than
 * rebuilding the text matrix ourselves.
 */
export function groupTextLayerEntriesIntoBlocks(entries, options = {}) {
  const clean = (entries || [])
    .filter(entry => entry && String(entry.text ?? entry.item?.str ?? '').trim() && Number.isFinite(entry.x) && Number.isFinite(entry.y))
    .map(entry => ({
      ...entry,
      item: entry.item || { str: entry.text || '', hasEOL: !!entry.hasEOL },
      text: entry.text ?? entry.item?.str ?? '',
      width: Math.max(1, Number(entry.width) || 1),
      height: Math.max(1, Number(entry.height) || 1),
      fontHeight: Math.max(1, Number(entry.fontHeight) || Number(entry.height) || 1),
      angle: Number(entry.angle) || 0
    }))
    .sort((a, b) => centerY(a) - centerY(b) || a.x - b.x);

  if (!clean.length) return [];

  const lineFactor = options.lineFactor ?? 0.62;
  const lines = [];
  for (const entry of clean) {
    const cy = centerY(entry);
    let best = null;
    let bestDelta = Infinity;
    for (let i = Math.max(0, lines.length - 3); i < lines.length; i++) {
      const line = lines[i];
      const base = Math.max(4, Math.min(line.height, entry.height));
      const delta = Math.abs(line.centerY - cy);
      if (delta <= Math.max(2.5, base * lineFactor) && angleDistance(line.angle, entry.angle) <= (options.angleTolerance ?? 0.08) && delta < bestDelta) {
        best = line;
        bestDelta = delta;
      }
    }
    if (!best) {
      best = { items: [], centerY: cy, height: entry.height, angle: entry.angle };
      lines.push(best);
    }
    best.items.push(entry);
    const n = best.items.length;
    best.centerY = ((best.centerY * (n - 1)) + cy) / n;
    best.height = Math.max(best.height, entry.height);
  }

  const blocks = [];
  for (const line of lines.sort((a, b) => a.centerY - b.centerY)) {
    const lineItems = line.items.sort((a, b) => a.x - b.x);
    const lineBlocks = groupTextMetasIntoBlocks(lineItems, options);
    for (const block of lineBlocks) {
      block.idx = blocks.length;
      block.fromTextLayer = true;
      blocks.push(block);
    }
  }
  if (options.paragraphs === false) return blocks;
  const paragraphs = [];
  for (const line of blocks) {
    let match = null;
    let distance = Infinity;
    for (const paragraph of paragraphs) {
      const last = paragraph.lines[paragraph.lines.length - 1];
      const font = Math.min(last.fontHeight, line.fontHeight);
      const gap = line.y - (last.y + last.height);
      const aligned = Math.abs(last.x - line.x) <= Math.max(3, font * .65);
      const similar = Math.max(last.fontHeight,line.fontHeight) / Math.max(1,font) < 1.2;
      const sameAngle = angleDistance(last.angle,line.angle) < .03;
      // Conservative: don't combine rotated runs or side-by-side table cells.
      if (Math.abs(line.angle) < .03 && aligned && similar && sameAngle && gap >= -1 && gap <= font * .65 && gap < distance) {
        match = paragraph; distance = gap;
      }
    }
    if (!match) paragraphs.push({...line, items:[...line.items], lines:[line]});
    else {
      match.lines.push(line);
      match.items.push(...line.items);
      const right = Math.max(match.x + match.width,line.x + line.width);
      match.x = Math.min(match.x,line.x);
      match.width = right - match.x;
      match.height = line.y + line.height - match.y;
      match.text += '\n' + line.text;
    }
  }
  return paragraphs.map((block,idx)=>({...block,idx}));
}
