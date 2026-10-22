// Turns a layout (from layout.js) into PDF bytes with pdf-lib.
// Runs inside the worker (js/sheet-worker.js) and in Node tests.

import * as fontkitModule from '../vendor/fontkit.esm.min.js';
import { PDFDocument, rgb } from '../vendor/pdf-lib.esm.min.js';
import { PAGE_WIDTH, PAGE_HEIGHT } from './layout.js';

const fontkit = fontkitModule.default ?? fontkitModule;

// "#9a9a9a" -> pdf-lib colour
function colour(hex) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function line(page, l, style) {
  page.drawLine({
    start: { x: l.x1, y: l.y1 },
    end: { x: l.x2, y: l.y2 },
    thickness: style.width,
    color: colour(style.color),
    dashArray: style.dash,       // undefined = solid line
    dashPhase: 0,
  });
}

// fontBytes = { kai, print } (ArrayBuffer or Uint8Array of the .ttf files).
// Returns the PDF as a Uint8Array. options.subsetFonts = false is only for tests.
export async function drawSheet(layout, fontBytes, title = 'Hanzi Grid', options = {}) {
  const subset = options.subsetFonts !== false;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(title);
  pdf.setCreator('Hanzi Grid');
  // subset: true = the PDF only carries the characters it uses.
  const fonts = {
    kai: await pdf.embedFont(fontBytes.kai, { subset }),
    print: await pdf.embedFont(fontBytes.print, { subset }),
  };
  const style = layout.style;
  const charSize = 0.8 * style.box;
  const black = rgb(0, 0, 0);

  for (const p of layout.pages) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

    // 1. dashed centre crosses
    for (const l of p.crosses) line(page, l, style.cross);

    // 2. characters, each centred in its own cell; baseline as in reference/make_grid.py
    for (const c of p.chars) {
      const font = fonts[c.font];
      const width = font.widthOfTextAtSize(c.ch, charSize);
      page.drawText(c.ch, {
        x: c.cx - width / 2,
        y: c.cy - 0.36 * charSize,
        size: charSize,
        font,
        color: black,
      });
    }

    // 3. the solid grid
    for (const l of p.grid) line(page, l, style.grid);

    // 4. block lines (small boxes) and cut lines (large boxes)
    for (const m of p.marks) line(page, m, m.kind === 'cut' ? style.cut : style.block);

    // 5. header, page numbers and labels; shrink a text that is wider than its space
    for (const t of p.texts) {
      const font = fonts[t.font];
      let size = t.size;
      const natural = font.widthOfTextAtSize(t.text, size);
      if (t.maxWidth && natural > t.maxWidth) size = size * t.maxWidth / natural;
      const width = font.widthOfTextAtSize(t.text, size);
      page.drawText(t.text, {
        x: t.align === 'right' ? t.x - width : t.x,
        y: t.y,
        size,
        font,
        color: colour(t.color),
      });
    }
  }
  return await pdf.save();
}
