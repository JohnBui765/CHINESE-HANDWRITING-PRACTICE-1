// readers.js: reads the files the owner opens (.txt, .docx, .pdf) and gives back their text.
// Browser only: it uses File, DOMParser and pdf.js. The text rules themselves are in extract.js.

// JSZip is an old-style script: importing it puts JSZip on globalThis.
import '../vendor/jszip.min.js';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const IMAGE_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'avif',
];

// Reads a file chosen with the file picker.
// Returns { text, name } (name = file name without its extension),
// or { picture: true } for a photo or a PDF with no Chinese text inside.
export async function readFile(file) {
  const fileName = file.name || '';
  const dot = fileName.lastIndexOf('.');
  const extension = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
  const name = dot > 0 ? fileName.slice(0, dot) : fileName;

  if (IMAGE_EXTENSIONS.includes(extension) || (file.type || '').startsWith('image/')) {
    return { picture: true };
  }
  if (extension === 'txt') {
    return { text: decodeText(await file.arrayBuffer()), name };
  }
  if (extension === 'docx') {
    const bytes = await file.arrayBuffer();
    const text = await docxText(bytes);
    // A Word file that holds only pictures (a scanned worksheet pasted into Word).
    if (!hasChinese(text) && (await docxHasPictures(bytes))) return { picture: true };
    return { text, name };
  }
  if (extension === 'pdf') {
    const text = await pdfText(await file.arrayBuffer());
    if (!hasChinese(text)) return { picture: true };
    return { text, name };
  }
  if (extension === 'doc') {
    throw new Error(
      `"${fileName}" is an old Word file (.doc). Open it in Word, save it as .docx, ` +
        'then open the .docx here.',
    );
  }
  throw new Error(`Hanzi Grid can't open "${fileName}". It reads .txt, .docx and .pdf files.`);
}

// The text of a .docx file, one line per paragraph.
export async function docxText(arrayBuffer) {
  const zip = await openZip(arrayBuffer);
  const part = zip.file('word/document.xml');
  if (!part) throw new Error('This .docx file has no document inside. It may be damaged.');
  const xml = await part.async('string');

  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('This .docx file could not be read. It may be damaged.');
  }

  // Every w:p in document order: body paragraphs, table cells (nested too), text boxes and
  // content controls. A text box's paragraphs come right after the paragraph that holds it.
  const lines = [];
  for (const paragraph of doc.getElementsByTagNameNS(WORD_NS, 'p')) {
    lines.push(paragraphText(paragraph));
  }
  return lines.join('\n');
}

// The text of a PDF, one line per text line, pages in order.
export async function pdfText(arrayBuffer) {
  // pdf.js is large, so it is loaded only when the owner opens a PDF.
  const pdfjs = await import('../vendor/pdfjs/pdf.min.js');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    '../vendor/pdfjs/pdf.worker.min.js',
    import.meta.url,
  ).href;

  const task = pdfjs.getDocument({
    // pdf.js takes over the bytes it is given, so give it a copy.
    data: new Uint8Array(arrayBuffer).slice(),
    cMapUrl: new URL('../vendor/pdfjs/cmaps/', import.meta.url).href,
    cMapPacked: true,
  });

  let pdf;
  try {
    pdf = await task.promise;
  } catch (error) {
    await task.destroy();
    if (error && error.name === 'PasswordException') {
      throw new Error('This PDF is locked with a password, so it cannot be read.');
    }
    throw new Error('This PDF could not be opened. It may be damaged.');
  }

  try {
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      pages.push(textLines(content.items).join('\n'));
      page.cleanup();
    }
    return pages.join('\n');
  } finally {
    await task.destroy();
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function hasChinese(text) {
  return /[\u3400-\u4DBF\u4E00-\u9FFF]/.test(String(text).normalize('NFKC'));
}

// Text files: UTF-8 (with or without a BOM), UTF-16 (Windows "Unicode", starts with a BOM),
// or GB18030/GBK (common for Chinese text files made in China).
function decodeText(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    // fatal: true makes the decoder stop at bytes that are not valid UTF-8.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('gb18030').decode(bytes);
  }
}

async function openZip(arrayBuffer) {
  try {
    return await globalThis.JSZip.loadAsync(arrayBuffer);
  } catch {
    throw new Error('This .docx file could not be opened. It may be damaged.');
  }
}

async function docxHasPictures(arrayBuffer) {
  const zip = await openZip(arrayBuffer);
  return zip.file(/^word\/media\//).length > 0;
}

// A paragraph's own text: its w:t text, w:tab as a tab, w:br and w:cr as a line break.
// Not counted: paragraphs nested inside it (text boxes; they are read on their own),
// deleted text (w:del, w:moveFrom), field codes (w:instrText), and the paragraph and run
// settings (w:pPr, w:rPr: their w:tab elements are tab stops, not tabs).
function paragraphText(paragraph) {
  let text = '';
  const walk = element => {
    for (const child of element.children) {
      if (child.namespaceURI === WORD_NS) {
        const tag = child.localName;
        if (tag === 'p' || tag === 'del' || tag === 'moveFrom') continue;
        if (tag === 'pPr' || tag === 'rPr') continue;
        if (tag === 't') {
          text += child.textContent;
          continue;
        }
        if (tag === 'tab') {
          text += '\t';
          continue;
        }
        if (tag === 'br' || tag === 'cr') {
          text += '\n';
          continue;
        }
      }
      walk(child);
    }
  };
  walk(paragraph);
  return text;
}

// pdf.js gives text pieces in drawing order, not reading order. This puts them in lines:
// pieces whose baselines are closer than half the font size are on the same line; lines go
// from the top of the page down; pieces in a line go from left to right. Pieces in a line are
// joined directly, with a space where the gap between them is wider than 0.3 × the font size.
function textLines(items) {
  // Pieces that are only spaces are left out: pdf.js adds them for gaps, and the gap rule
  // below already puts a space wherever one is needed.
  const pieces = items
    .filter(item => typeof item.str === 'string' && item.str.trim() !== '')
    .map(item => {
      // The font size: the height of the text's "up" direction.
      const size = Math.hypot(item.transform[2], item.transform[3]) || item.height || 1;
      return {
        text: removeLetterSpacing(item.str, item.width, size),
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        size,
      };
    });

  // Top of the page first (in a PDF, a larger y is higher up).
  pieces.sort((a, b) => b.y - a.y);

  const lines = [];
  for (const piece of pieces) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - piece.y) < piece.size / 2) {
      line.pieces.push(piece);
    } else {
      lines.push({ y: piece.y, pieces: [piece] });
    }
  }

  return lines.map(line => {
    line.pieces.sort((a, b) => a.x - b.x);
    let text = '';
    let previousEnd = null;
    for (const piece of line.pieces) {
      if (previousEnd !== null && piece.x - previousEnd > 0.3 * piece.size) text += ' ';
      text += piece.text;
      previousEnd = piece.x + piece.width;
    }
    return text;
  });
}

// pdf.js itself puts a space inside a piece wherever two characters are a little apart (more
// than 0.1 × the font size). A word drawn with letter spacing, so that each character sits in
// its own box, then comes out as "女 朋 友". Our rule is a space only for a gap wider than
// 0.3 × the font size. A Chinese character is exactly one font size wide, so for a piece made
// only of Chinese characters and spaces we can work out how wide the spaces are.
function removeLetterSpacing(text, width, size) {
  const plain = text.normalize('NFKC');
  if (!plain.includes(' ') || !/^[\u3400-\u4DBF\u4E00-\u9FFF ]+$/.test(plain)) return text;
  const characters = plain.replace(/ /g, '').length;
  const spaces = plain.length - characters;
  const spaceWidth = (width - characters * size) / spaces;
  return spaceWidth > 0.3 * size ? plain : plain.replace(/ /g, '');
}
