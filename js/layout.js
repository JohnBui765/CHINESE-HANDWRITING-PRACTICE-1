// The layout pass: decides where every line, character and label goes on every page.
// No browser APIs and no PDF library, so Node tests can check the numbers directly.
// Everything here is in PDF points, measured from the BOTTOM-left corner of the page
// (the same as reportlab and pdf-lib).

export const MM = 72 / 25.4;
export const PAGE_WIDTH = 210 * MM;   // A4
export const PAGE_HEIGHT = 297 * MM;

// The two sheet styles. All sizes in mm and points exactly as in CLAUDE.md.
export const SIZES = {
  small: {
    box: 10 * MM,
    columns: 18,
    maxRows: 24,                    // "Page" = 24 empty rows (+ 2 model rows = 26 rows)
    grid: { color: '#9a9a9a', width: 0.5 },
    cross: { color: '#c4c4c4', width: 0.35, dash: [1.5, 1.5] },
    block: { color: '#555555', width: 1.1 },
  },
  large: {
    box: 15 * MM,
    columns: 12,
    maxRows: 15,                    // "Page" = 15 empty rows (+ 2 model rows = 17 rows)
    grid: { color: '#666666', width: 0.8 },
    cross: { color: '#b0b0b0', width: 0.5, dash: [2, 2] },
    cut: { color: '#000999', width: 0.5, dash: [4, 3] },
  },
};

// Small boxes: a full 18 x 26 grid on every page, as in reference/make_grid.py.
const SMALL_ROWS_PER_PAGE = 26;
const SMALL_GRID_TOP = 20;          // mm from the page top
const SMALL_HEADER_Y = 13;          // mm from the page top
export const HEADER_TEXT =
  'Row 1: KaiTi 楷体 (handwriting)   Row 2: print 黑体 (screen / phone)   Copy the KaiTi form in the empty boxes.';

// Large boxes: measured from samples/Chinese character practice.pdf (mm from the page top).
const LARGE_FIRST_LABEL = 19;       // label baseline of the first block on a page
const LABEL_TO_GRID = 3;            // label baseline -> grid top
const GRID_TO_CUT = 6.5;            // previous grid bottom -> cut line
const CUT_TO_LABEL = 7;             // cut line -> next label baseline
const LARGE_LOWEST_BOTTOM = 278.5;  // a grid may end at most this far down
const LABEL_SIZE = 12;              // points

// Turn "mm from the page top" into points from the page bottom.
function fromTop(mm) {
  return PAGE_HEIGHT - mm * MM;
}

// How many empty rows a word gets on this box size. rows is a number or "Page".
export function emptyRows(rows, boxSize) {
  const max = SIZES[boxSize].maxRows;
  if (rows === 'Page') return max;
  const n = Math.floor(Number(rows));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}

// The text of a large-box label: "word   pinyin   - meaning", leaving out unknown parts.
export function labelText(item) {
  let text = item.word;
  if (item.pinyin) text += '   ' + item.pinyin;
  if (item.meaning) text += '   - ' + item.meaning;
  return text;
}

function newPage() {
  // Lists in drawing order: crosses first, then characters, then the grid, then marks and texts.
  return { crosses: [], chars: [], grid: [], marks: [], texts: [] };
}

// Characters of one word, one per cell. [...word] keeps characters outside the BMP whole.
function addModelRows(page, word, x0, rowTop, box) {
  [...word].forEach((ch, col) => {
    const cx = x0 + (col + 0.5) * box;
    page.chars.push({ ch, font: 'kai', cx, cy: rowTop - box / 2 });
    page.chars.push({ ch, font: 'print', cx, cy: rowTop - box - box / 2 });
  });
}

// ---------------------------------------------------------------------------------------
// Small boxes (10 mm)
// ---------------------------------------------------------------------------------------

function layoutSmall(items) {
  const size = SIZES.small;
  const box = size.box;
  const x0 = (PAGE_WIDTH - size.columns * box) / 2;   // 15 mm side margins
  const gridTop = fromTop(SMALL_GRID_TOP);
  const gridRight = x0 + size.columns * box;

  // First decide which page and row each block starts on.
  const placed = [];   // { item, page, row, rows }
  let page = 0;
  let row = 0;         // next free row on the current page
  for (const item of items) {
    const rows = 2 + emptyRows(item.rows, 'small');
    if (row + rows > SMALL_ROWS_PER_PAGE) {
      page += 1;
      row = 0;
    }
    placed.push({ item, page, row, rows });
    row += rows;
  }
  const pageCount = placed.length ? page + 1 : 0;

  // Then draw every page: the full grid, the blocks, and the header with "page/total".
  const pages = [];
  for (let p = 0; p < pageCount; p++) {
    const out = newPage();
    for (let r = 0; r < SMALL_ROWS_PER_PAGE; r++) {
      const bottom = gridTop - (r + 1) * box;
      // Dashed centre cross: one line across the row, one short line down each cell
      // (the same as reference/make_grid.py).
      out.crosses.push({ x1: x0, y1: bottom + box / 2, x2: gridRight, y2: bottom + box / 2 });
      for (let c = 0; c < size.columns; c++) {
        const x = x0 + c * box + box / 2;
        out.crosses.push({ x1: x, y1: bottom, x2: x, y2: bottom + box });
      }
    }
    for (let r = 0; r <= SMALL_ROWS_PER_PAGE; r++) {
      const y = gridTop - r * box;
      out.grid.push({ x1: x0, y1: y, x2: gridRight, y2: y });
    }
    for (let c = 0; c <= size.columns; c++) {
      const x = x0 + c * box;
      out.grid.push({ x1: x, y1: gridTop, x2: x, y2: gridTop - SMALL_ROWS_PER_PAGE * box });
    }
    out.texts.push({
      text: HEADER_TEXT, font: 'print', size: 8.5, color: '#666666', align: 'left',
      x: x0, y: fromTop(SMALL_HEADER_Y),
      // Leave 12 mm on the right for the page number; draw.js shrinks the text if needed.
      maxWidth: size.columns * box - 12 * MM,
    });
    out.texts.push({
      text: `${p + 1}/${pageCount}`, font: 'print', size: 8.5, color: '#666666', align: 'right',
      x: gridRight, y: fromTop(SMALL_HEADER_Y), maxWidth: 12 * MM,
    });
    pages.push(out);
  }

  for (const { item, page: p, row: r } of placed) {
    const out = pages[p];
    const top = gridTop - r * box;
    addModelRows(out, item.word, x0, top, box);
    out.marks.push({ x1: x0, y1: top, x2: gridRight, y2: top, kind: 'block' });
  }
  return { boxSize: 'small', style: size, pages, blocks: placed.map(b => ({ page: b.page, row: b.row, rows: b.rows })) };
}

// ---------------------------------------------------------------------------------------
// Large boxes (15 mm)
// ---------------------------------------------------------------------------------------

function layoutLarge(items) {
  const size = SIZES.large;
  const box = size.box;
  const boxMm = 15;
  const x0 = (PAGE_WIDTH - size.columns * box) / 2;   // 15 mm side margins
  const gridRight = x0 + size.columns * box;

  const pages = [];
  const blocks = [];
  let out = null;
  let lastBottom = null;   // mm from the top of the last grid on the current page

  for (const item of items) {
    const rows = 2 + emptyRows(item.rows, 'large');
    let gridTopMm = lastBottom === null ? LARGE_FIRST_LABEL + LABEL_TO_GRID
      : lastBottom + GRID_TO_CUT + CUT_TO_LABEL + LABEL_TO_GRID;
    // Small tolerance so that 278.5 itself is allowed despite rounding.
    if (out === null || gridTopMm + rows * boxMm > LARGE_LOWEST_BOTTOM + 1e-6) {
      out = newPage();
      pages.push(out);
      lastBottom = null;
      gridTopMm = LARGE_FIRST_LABEL + LABEL_TO_GRID;
    } else if (lastBottom !== null) {
      const cutMm = lastBottom + GRID_TO_CUT;
      out.marks.push({ x1: x0, y1: fromTop(cutMm), x2: gridRight, y2: fromTop(cutMm), kind: 'cut' });
    }

    const top = fromTop(gridTopMm);
    out.texts.push({
      text: labelText(item), font: 'print', size: LABEL_SIZE, color: '#000000', align: 'left',
      x: x0, y: fromTop(gridTopMm - LABEL_TO_GRID), maxWidth: size.columns * box,
    });
    // Dashed centre cross in every cell (one short line each way, as in the sample).
    for (let r = 0; r < rows; r++) {
      const bottom = top - (r + 1) * box;
      for (let c = 0; c < size.columns; c++) {
        const left = x0 + c * box;
        out.crosses.push({ x1: left, y1: bottom + box / 2, x2: left + box, y2: bottom + box / 2 });
        out.crosses.push({ x1: left + box / 2, y1: bottom, x2: left + box / 2, y2: bottom + box });
      }
    }
    for (let r = 0; r <= rows; r++) {
      const y = top - r * box;
      out.grid.push({ x1: x0, y1: y, x2: gridRight, y2: y });
    }
    for (let c = 0; c <= size.columns; c++) {
      const x = x0 + c * box;
      out.grid.push({ x1: x, y1: top, x2: x, y2: top - rows * box });
    }
    addModelRows(out, item.word, x0, top, box);
    blocks.push({ page: pages.length - 1, gridTopMm, rows });
    lastBottom = gridTopMm + rows * boxMm;
  }
  return { boxSize: 'large', style: size, pages, blocks };
}

// items = [{ word, pinyin, meaning, rows }], boxSize = "small" | "large".
// Returns { boxSize, style, pages, blocks }. Each page lists, in drawing order:
// crosses (dashed), chars (cell centres), grid (solid), marks (block/cut lines), texts.
export function layoutSheet(items, boxSize = 'small') {
  if (!SIZES[boxSize]) throw new Error(`Unknown box size: ${boxSize}`);
  const columns = SIZES[boxSize].columns;
  for (const item of items) {
    const length = [...item.word].length;
    if (length === 0) throw new Error('A word is empty.');
    if (length > columns) {
      throw new Error(`"${item.word}" has ${length} characters; this sheet has only ${columns} columns.`);
    }
  }
  return boxSize === 'small' ? layoutSmall(items) : layoutLarge(items);
}
