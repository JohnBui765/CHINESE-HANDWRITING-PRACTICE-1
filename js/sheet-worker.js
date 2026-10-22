// The worker that builds the PDF, so the page never freezes.
// The page sends:   { items, boxSize, title }
// The worker sends: { type: 'progress', text }, then { type: 'done', pdf, pages }
//                   or { type: 'error', message }
// This is the browser version of the worker / queue / poll pattern in reference/img2word.py.

import { layoutSheet } from './layout.js';
import { drawSheet } from './draw.js';

let fontBytes = null;   // loaded once, then reused for every PDF

async function loadFont(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error(`Could not load the font ${path} (${response.status}).`);
  return await response.arrayBuffer();
}

async function loadFonts() {
  if (!fontBytes) {
    const [kai, print] = await Promise.all([
      loadFont('../fonts/ukai-cn.ttf'),
      loadFont('../fonts/noto-sans-sc.ttf'),
    ]);
    fontBytes = { kai, print };
  }
  return fontBytes;
}

self.onmessage = async event => {
  const { items, boxSize, title } = event.data;
  try {
    self.postMessage({ type: 'progress', text: 'Loading the fonts…' });
    const fonts = await loadFonts();
    const layout = layoutSheet(items, boxSize);
    self.postMessage({ type: 'progress', text: `Drawing ${layout.pages.length} page(s)…` });
    const pdf = await drawSheet(layout, fonts, title);
    // The second argument hands the bytes over instead of copying them.
    self.postMessage({ type: 'done', pdf, pages: layout.pages.length }, [pdf.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', message: error && error.message ? error.message : String(error) });
  }
};
