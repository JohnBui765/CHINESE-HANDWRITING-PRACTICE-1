// extract.js: turns text into a list of Chinese words.
//
// It knows the text rules, the lesson format, the AI reply format, the pinyin check and the
// two-reply comparison. It uses no browser features, so Node can test it directly.
//
// The objects it returns:
//
// ListResult = {
//   name,           // list name
//   entries,        // Entry[], in order, repeated words removed
//   removed,        // how many repeated words were removed
//   isReply,        // true when the text was read as an AI reply
//   lines,          // how many words were read before removing repeats
//   total,          // the number on the "# total: N" line, or null
//   echoedExample,  // true when the reply only repeats the prompt's format example
// }
// Entry = { word, pinyin, meaning, page, unsure, compare, other }

// The words of the format example in prompts/worksheet.txt.
// If the owner changes the example in the prompt, change this list too
// (a test in tests/extract.test.js checks that the two match).
const EXAMPLE_WORDS = ['学生', '他', '老师'];

// Chinese characters we keep: CJK Unified Ideographs (U+4E00–U+9FFF) and
// Extension A (U+3400–U+4DBF). Everything else separates words.
const CHINESE_RUN = /[\u3400-\u4DBF\u4E00-\u9FFF]+/g;
const CHINESE_CHAR = /[\u3400-\u4DBF\u4E00-\u9FFF]/;

// A reply line starts with a page number and then "|", for example "3 | 女朋友 | ...".
// The AI may number its lines ("1. 3 | ...") or write "p3" or "page 3" instead of "3".
const REPLY_LINE_START = /^(\d+[.)]\s*)?(p\.?\s*|page\s*)?\d+\s*\|/i;

// "# total: 30" (the colon is optional, upper or lower case).
const TOTAL_LINE = /^#+\s*total\b\s*:?\s*(\d+)/i;

// A line that opens or closes a Markdown code block: ``` or ~~~ (maybe with a language name).
const FENCE_LINE = /^(```|~~~)/;

// ---------------------------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------------------------

// Reads any text: an AI reply, a lesson list or plain text.
export function readText(text, fallbackName) {
  if (isReply(text)) {
    return readReply(text, fallbackName);
  }
  const lines = splitLines(normalize(text));
  const names = [];
  const found = []; // every word read, repeats included
  let total = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('#')) {
      total = readHashLine(line, names, total);
      continue;
    }
    if (line.includes('|')) {
      // Lesson format: "word | pinyin | meaning".
      const entry = readColumns(line);
      if (entry) found.push(entry);
      continue;
    }
    // Plain text: every run of Chinese characters is one word.
    for (const word of chineseWords(line)) {
      found.push(makeEntry(word));
    }
  }
  return makeResult(found, names, fallbackName, false, total);
}

// True when at least one line looks like "number | ...".
export function isReply(text) {
  const lines = splitLines(normalize(text));
  return lines.some(line => isReplyLine(line));
}

// Reads an AI reply. It is forgiving: code fences, text around the block, full-width pipes,
// extra spaces, missing pinyin or meaning columns and numbering such as "1." are all fine.
export function readReply(text, fallbackName) {
  const lines = replyBlock(splitLines(normalize(text)));
  const names = [];
  const found = [];
  let total = null;

  for (const raw of lines) {
    if (raw.trim().startsWith('#')) {
      total = readHashLine(raw.trim(), names, total);
      continue;
    }
    // Only lines with "|" are word lines. Other lines (the AI's own remarks) are ignored.
    if (!raw.includes('|')) continue;
    let line = stripLineDecoration(raw);

    // A line that ends with " ?" means the AI was not sure.
    const unsure = endsWithQuestionMark(line);
    if (unsure) line = removeQuestionMark(line);

    const entry = readColumns(line, true);
    if (!entry) continue; // no Chinese in the line, e.g. a table header
    entry.unsure = unsure;
    found.push(entry);
  }

  const result = makeResult(found, names, fallbackName, true, total);
  result.echoedExample =
    result.entries.length > 0 && result.entries.every(e => EXAMPLE_WORDS.includes(e.word));
  return result;
}

// Lines up two replies with a longest-common-subsequence table.
// Returns entries in A's order, with words that only B has inserted where they line up.
// compare = "same" (both have it), "differs" (the AIs read different words at this place;
// "other" is B's word), "onlyA" or "onlyB".
export function compareReplies(entriesA, entriesB) {
  const a = entriesA || [];
  const b = entriesB || [];

  // table[i][j] = length of the longest common subsequence of a[i..] and b[j..].
  const table = [];
  for (let i = 0; i <= a.length; i++) {
    table.push(new Array(b.length + 1).fill(0));
  }
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      if (a[i].word === b[j].word) {
        table[i][j] = table[i + 1][j + 1] + 1;
      } else {
        table[i][j] = Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
  }

  // Walk through both lists. Words between two matches form a "gap".
  const result = [];
  let gapA = [];
  let gapB = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].word === b[j].word) {
      flushGap(result, gapA, gapB);
      gapA = [];
      gapB = [];
      result.push({ ...a[i], compare: 'same', other: '' });
      i++;
      j++;
    } else if (j >= b.length || (i < a.length && table[i + 1][j] >= table[i][j + 1])) {
      gapA.push(a[i]);
      i++;
    } else {
      gapB.push(b[j]);
      j++;
    }
  }
  flushGap(result, gapA, gapB);
  return result;
}

// Counts pinyin syllables: one syllable for every group of vowels next to each other.
// Vowels are a e i o u ü v, with or without tone marks. Anything else (consonants, spaces,
// apostrophes, hyphens, tone numbers) separates groups.
//   "nǚ péngyou" = 3, "jiějie" = 2, "Xī'ān" = 2, "ni3 hao3" = 2, "nv3" = 1 ("v" is ü)
// Empty pinyin gives 0; the caller only checks words whose pinyin is known.
export function countSyllables(pinyin) {
  // NFD splits a letter from its marks ("ǚ" -> "u" + two marks); then remove the marks.
  const plain = String(pinyin ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase();
  const groups = plain.match(/[aeiouv]+/g);
  return groups ? groups.length : 0;
}

// The text of a saved list, in the lesson format:
//   # name
//   女朋友 | nǚ péngyou | girlfriend
//   国
export function toLessonText(name, entries) {
  const title = oneLine(name) || 'Untitled';
  const out = ['# ' + title];
  for (const entry of entries || []) {
    const pinyin = cleanColumn(entry.pinyin);
    const meaning = cleanColumn(entry.meaning);
    if (meaning) {
      out.push(`${entry.word} | ${pinyin} | ${meaning}`);
    } else if (pinyin) {
      out.push(`${entry.word} | ${pinyin}`);
    } else {
      out.push(entry.word);
    }
  }
  return out.join('\n') + '\n';
}

// Replaces the characters Windows does not allow in file names with "_".
export function safeFileName(name) {
  let safe = String(name ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .trim();
  // Windows also does not allow a name that ends with a dot or a space.
  safe = safe.replace(/[. ]+$/, '');
  // Keep names short enough for every folder.
  if (safe.length > 100) safe = safe.slice(0, 100).trim();
  if (safe === '') return 'Untitled';
  // Names such as CON, NUL or COM1 are reserved for devices on Windows.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(safe)) safe = '_' + safe;
  return safe;
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

// NFKC turns look-alike code points into the normal ones: the Kangxi radical ⼥ (U+2F25)
// becomes 女 (U+5973), full-width ｜ becomes |, full-width digits become 0-9.
function normalize(text) {
  return String(text ?? '').normalize('NFKC');
}

function splitLines(text) {
  return text.split(/\r\n|\r|\n/);
}

// Every run of Chinese characters in the text, in order.
function chineseWords(text) {
  return text.match(CHINESE_RUN) || [];
}

function makeEntry(word) {
  return { word, pinyin: '', meaning: '', page: null, unsure: false, compare: null, other: '' };
}

// Takes away a Markdown table's outer pipes and a list bullet, so "| 1 | 女 |" becomes "1 | 女".
function stripLineDecoration(line) {
  let s = line.trim();
  s = s.replace(/^[-*•]\s+/, '');
  s = s.replace(/^\|/, '').replace(/\|$/, '');
  return s.trim();
}

// A reply line: a page number, "|", and a Chinese word after it.
function isReplyLine(line) {
  const s = stripLineDecoration(line);
  return REPLY_LINE_START.test(s) && CHINESE_CHAR.test(s);
}

// Handles a line that starts with "#": either the total or a list name.
// Returns the total (changed or not).
function readHashLine(line, names, total) {
  const match = line.match(TOTAL_LINE);
  if (match) {
    // When there are several total lines, the last one counts.
    return Number(match[1]);
  }
  const name = line.replace(/^#+/, '').trim();
  if (name && !names.includes(name)) names.push(name);
  return total;
}

// Reads a line with "|" columns. The word column is the first column that has Chinese
// characters; all its Chinese characters are joined ("妈 妈" -> "妈妈"). The next column is
// the pinyin, the one after it the meaning (more columns are added to the meaning).
// For a reply line, a number in the columns before the word is the page.
// Returns null when no column has Chinese.
function readColumns(line, withPage = false) {
  const columns = stripLineDecoration(line).split('|').map(c => c.trim());
  const wordIndex = columns.findIndex(c => CHINESE_CHAR.test(c));
  if (wordIndex === -1) return null;

  const entry = makeEntry(chineseWords(columns[wordIndex]).join(''));
  entry.pinyin = cleanPinyin(columns[wordIndex + 1]);
  entry.meaning = cleanMeaning(columns.slice(wordIndex + 2));

  if (withPage) {
    // "3" -> 3, "1. 3" -> 3 (the last number before the word column).
    const numbers = columns.slice(0, wordIndex).join(' ').match(/\d+/g);
    entry.page = numbers ? Number(numbers[numbers.length - 1]) : null;
  }
  return entry;
}

// Pinyin as the AI copied it, without the slashes of "/nǚ péng you/" and without extra spaces.
// A column that is only a dash means "no pinyin".
function cleanPinyin(text) {
  let s = collapseSpaces(text);
  s = s.replace(/^\/+/, '').replace(/\/+$/, '').trim();
  return isOnlyDashes(s) ? '' : s;
}

function cleanMeaning(columns) {
  const parts = columns.map(collapseSpaces).filter(s => s !== '' && !isOnlyDashes(s));
  return parts.join('; ');
}

function collapseSpaces(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function isOnlyDashes(text) {
  return /^[-–—]+$/.test(text);
}

// True when the line ends with a question mark that follows a space, a "|" or a Chinese
// character: "teacher ?", "老师 ?", "| ?", "老师?". Not "how about...?" (part of a meaning).
function endsWithQuestionMark(line) {
  return /(\s|\||[\u3400-\u4DBF\u4E00-\u9FFF])\?+\s*$/.test(line);
}

function removeQuestionMark(line) {
  return line.replace(/\?+\s*$/, '').trim();
}

// When the AI used a code block, only the lines inside code blocks are read, so headings and
// remarks around the block do not get in. Without a code block, every line is read.
function replyBlock(lines) {
  const inside = [];
  let inFence = false;
  for (const line of lines) {
    if (FENCE_LINE.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) inside.push(line);
  }
  if (inside.some(line => isReplyLine(line))) return inside;
  return lines;
}

// Builds the ListResult: removes repeated words and works out the list name.
function makeResult(found, names, fallbackName, readAsReply, total) {
  const entries = [];
  const byWord = new Map();
  for (const entry of found) {
    const first = byWord.get(entry.word);
    if (!first) {
      byWord.set(entry.word, entry);
      entries.push(entry);
      continue;
    }
    // A repeat: keep the first one, but fill in what it lacks, and keep the "unsure" flag.
    if (!first.pinyin) first.pinyin = entry.pinyin;
    if (!first.meaning) first.meaning = entry.meaning;
    if (first.page === null) first.page = entry.page;
    if (entry.unsure) first.unsure = true;
  }
  return {
    name: listName(names, fallbackName),
    entries,
    removed: found.length - entries.length,
    isReply: readAsReply,
    lines: found.length,
    total,
    echoedExample: false,
  };
}

// The list name: the "#" line; several ("Bài 3", "Bài 4") -> "Bài 3–4";
// none -> the file name, or "Untitled" for pasted text.
function listName(names, fallbackName) {
  if (names.length === 0) {
    return oneLine(String(fallbackName ?? '').normalize('NFC')) || 'Untitled';
  }
  if (names.length === 1) return names[0];

  // Names that share the text before their last number: "Bài 3 我是中国人", "Bài 4 ..."
  // become "Bài 3–4" (smallest number – largest number).
  const parts = names.map(n => n.match(/^(.*?)(\d+)\D*$/));
  const sharePrefix =
    parts.every(p => p !== null) &&
    parts.every(p => p[1].trim().toLowerCase() === parts[0][1].trim().toLowerCase());
  if (sharePrefix) {
    const numbers = parts.map(p => Number(p[2]));
    const low = Math.min(...numbers);
    const high = Math.max(...numbers);
    if (low === high) return names[0];
    return `${parts[0][1]}${low}–${high}`;
  }
  // Otherwise: the first and the last name, joined with an en dash.
  return `${names[0]}–${names[names.length - 1]}`;
}

function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

// A pinyin or meaning for the lesson format: one line, and no "|" (that would start a column).
function cleanColumn(text) {
  return oneLine(text).replace(/\|/g, '/');
}

// Adds the words of one gap to the result. The first words of A and B in the gap are paired
// as "differs"; the rest are "onlyA" or "onlyB".
function flushGap(result, gapA, gapB) {
  const pairs = Math.min(gapA.length, gapB.length);
  for (let k = 0; k < pairs; k++) {
    result.push({ ...gapA[k], compare: 'differs', other: gapB[k].word });
  }
  for (let k = pairs; k < gapA.length; k++) {
    result.push({ ...gapA[k], compare: 'onlyA', other: '' });
  }
  for (let k = pairs; k < gapB.length; k++) {
    result.push({ ...gapB[k], compare: 'onlyB', other: '' });
  }
}
