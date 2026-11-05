/** GIF frames are rendered on a supported image sheet, including unused cells. */
export function getGptImageGifLayouts(frameCount = 9): { columns: number; rows: number }[] {
  if (!Number.isInteger(frameCount) || frameCount < 2 || frameCount > 16) {
    throw new Error('GIF frame count must be 2–16');
  }
  // Provider validation and measured usage, 2026-11-04: even two frames use
  // an eight-cell sheet. Nine uses 3x3; ten through twelve use 4x3/3x4; the rest use 4x4.
  return frameCount <= 8
    ? [
        { columns: 4, rows: 2 },
        { columns: 2, rows: 4 }
      ]
    : frameCount === 9
      ? [{ columns: 3, rows: 3 }]
      : frameCount <= 12
        ? [
            { columns: 4, rows: 3 },
            { columns: 3, rows: 4 }
          ]
        : [{ columns: 4, rows: 4 }];
}

export function getGptImageGifFrameBounds(frameCount = 9) {
  const layouts = getGptImageGifLayouts(frameCount);
  const cells = layouts[0].columns * layouts[0].rows;
  return {
    minDimension: 16,
    dimensionStep: 16,
    maxAspectRatio: 3,
    maxWidth: Math.max(...layouts.map((layout) => 3840 / layout.columns)),
    maxHeight: Math.max(...layouts.map((layout) => 3840 / layout.rows)),
    minPixels: Math.ceil(655360 / cells),
    maxPixels: Math.floor(8294400 / cells)
  };
}

/** The most expensive valid orientation is the reservation envelope. */
export function getGptImageGifSheet(width: number, height: number, frameCount = 9) {
  const layouts = getGptImageGifLayouts(frameCount);
  if (
    ![width, height].every((value) => Number.isInteger(value) && value > 0 && value % 16 === 0) ||
    Math.max(width, height) / Math.min(width, height) > 3
  ) {
    throw new Error('GIF frame dimensions must be positive multiples of 16 within 3:1');
  }
  const sheets = layouts
    .map((layout) => ({
      ...layout,
      width: width * layout.columns,
      height: height * layout.rows
    }))
    .filter(
      (sheet) =>
        Math.max(sheet.width, sheet.height) <= 3840 &&
        Math.max(sheet.width, sheet.height) / Math.min(sheet.width, sheet.height) <= 3 &&
        sheet.width * sheet.height >= 655360 &&
        sheet.width * sheet.height <= 8294400
    );
  if (!sheets.length) {
    throw new Error(
      'GIF frames cannot fit a supported sheet: use smaller or larger frames within the 655360–8294400 pixel budget and 3840 sheet edge limit'
    );
  }
  // Every orientation has the same area. The closest to square has the
  // greatest output-token budget at every supported quality.
  sheets.sort(
    (a, b) =>
      Math.max(a.width, a.height) / Math.min(a.width, a.height) -
      Math.max(b.width, b.height) / Math.min(b.width, b.height)
  );
  return sheets[0];
}

/** Preserve explicit pixels; infer omitted dimensions within the sheet limits. */
export function resolveGptImageGifSize(
  width?: number,
  height?: number,
  frameCount = 9,
  ratio = 1
): { width: number; height: number } {
  const layouts = getGptImageGifLayouts(frameCount);
  if (!Number.isFinite(ratio) || ratio < 1 / 3 || ratio > 3)
    throw new Error('GIF aspect ratio must be within 3:1');
  if (width !== undefined || height !== undefined) {
    const w = width ?? Math.max(16, Math.round((height! * ratio) / 16) * 16);
    const h = height ?? Math.max(16, Math.round(w / ratio / 16) * 16);
    getGptImageGifSheet(w, h, frameCount);
    return { width: w, height: h };
  }
  const candidates: { width: number; height: number }[] = [];
  for (const layout of layouts) {
    const sheetRatio = (ratio * layout.columns) / layout.rows;
    if (sheetRatio < 1 / 3 || sheetRatio > 3) continue;
    const area = Math.min(
      896 ** 2,
      8294400 / (layout.columns * layout.rows),
      (3840 / layout.columns) ** 2 / ratio,
      (3840 / layout.rows) ** 2 * ratio
    );
    let w = Math.floor(Math.sqrt(area * ratio) / 16) * 16;
    let h = Math.floor(Math.sqrt(area / ratio) / 16) * 16;
    w = Math.min(w, h * 3);
    h = Math.min(h, w * 3);
    getGptImageGifSheet(w, h, frameCount);
    candidates.push({ width: w, height: h });
  }
  candidates.sort((a, b) => b.width * b.height - a.width * a.height);
  if (!candidates.length) throw new Error('GIF aspect ratio cannot fit a supported sheet');
  return candidates[0];
}
