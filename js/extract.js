// extract.js: turns text into a list of Chinese words and sentences.
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
//   lines,          // how many words were read before removing repeats ("> " lines not counted)
//   total,          // the number on the "# total: N" line, or null
//   echoedExample,  // true when the text only repeats a prompt's format example (or is a prompt)
//   continueFrom,   // N when the reply ends with "# continue from page N" (not finished), else null
//   nothing,        // the reason on a "# nothing to copy: ..." line, else ''
// }
// Entry = { word, pinyin, said, meaning, page, unsure, compare, other, depth }
//   word:  Chinese characters; a sentence also keeps its punctuation ("你好！"), one box each.
//   depth: 0 = a word or sentence; 1 = a part of the entry above it, from a "> " line (a
//          character of a word, or a chunk of a sentence); 2 = a part of a part (">> ").
//   said:  the pinyin as said inside the entry above, when its tone changes there
//          ("> 你 | nǐ → ní": pinyin "nǐ", said "ní"); otherwise "".

// The format examples of prompts/worksheet.txt (words) and prompts/sentences.txt.
// If the owner changes an example in a prompt, change it here too
// (tests in tests/extract.test.js check that they match).
export const PROMPT_EXAMPLES = [
  ['他', '你好', '奶奶', '看', '不客气', '一起', '李小雨', '老师'],
  ['你好！', '我叫李小雨。', '我买一本书。', '不客气。'],
];

// Every prompt has this line above its format example. A pasted text that has it is the prompt
// itself (or the AI copied the prompt), not an answer.
const EXAMPLE_MARK = /FORMAT EXAMPLE \(made-up, not the answer\)/i;

// Sentence punctuation stays in a text and gets its own box, as on Chinese composition paper.
export const PUNCTUATION = '。，、！？：；“”‘’《》…—';
const BOX_CHARS = new RegExp(`[\\u3400-\\u4DBF\\u4E00-\\u9FFF${PUNCTUATION}]`, 'g');
const HAS_PUNCTUATION = new RegExp(`[${PUNCTUATION}]`);
// A text never starts with punctuation, except an opening quote or title mark (“你好”是…, 《…》).
const LEADING_PUNCTUATION = new RegExp(`^[${[...PUNCTUATION].filter(ch => !'“‘《'.includes(ch)).join('')}]+`);
// A text may end with 。！？… and closing quotes, but not with a comma, a colon or an opening mark.
const TRAILING_SEPARATORS = /[，、：；“‘《—]+$/;
// NFKC turns full-width ！？，：； into ASCII. Next to Chinese text they become Chinese again.
const TO_CHINESE = { ',': '，', '!': '！', '?': '？', ':': '：', ';': '；', '.': '。' };

// Chinese characters we keep: CJK Unified Ideographs (U+4E00–U+9FFF) and
// Extension A (U+3400–U+4DBF). Everything else separates words.
const CHINESE_RUN = /[\u3400-\u4DBF\u4E00-\u9FFF]+/g;
const CHINESE_CHAR = /[\u3400-\u4DBF\u4E00-\u9FFF]/;

// A reply line starts with a page number and then "|", for example "3 | 女朋友 | ...".
// The AI may number its lines ("1. 3 | ...") or write "p3" or "page 3" instead of "3".
const REPLY_LINE_START = /^(\d+[.)]\s*)?(p\.?\s*|page\s*)?\d+\s*\|/i;

// "# total: 30" (the colon is optional, upper or lower case).
const TOTAL_LINE = /^#+\s*total\b\s*:?\s*(\d+)/i;
// "# continue from page 4": the AI stopped; the next part of its answer comes later.
const CONTINUE_LINE = /^#+\s*continue\b\D*(\d+)/i;
// "# nothing to copy: the pages have no Chinese"
const NOTHING_LINE = /^#+\s*nothing to copy\b\s*:?\s*(.*)$/i;
// "> 女 | nǚ | woman": a part of the entry above. ">> " (or "> >") is a part of a part.
const PART_LINE = /^((?:>\s*)+)(.*)$/;
// "nǐ → ní" (also -> and =>): the dictionary pinyin, then the pinyin as said.
const ARROW = /\s*(?:→|->|=>|⟶|⇒)\s*/;

// A line that opens or closes a Markdown code block: ``` or ~~~ (maybe with a language name).
const FENCE_LINE = /^(```|~~~)[\w-]*\s*$/;

// ---------------------------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------------------------

// Reads any text: an AI reply, a lesson list or plain text.
export function readText(text, fallbackName) {
  if (isReply(text)) {
    return readReply(text, fallbackName);
  }
  const lines = codeBlock(splitLines(normalize(text)), isLessonLine);
  const state = newState();

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('#')) {
      readHashLine(line, state);
      continue;
    }
    if (readPartLine(line, state)) continue;
    if (line.includes('|')) {
      // Lesson format: "word | pinyin | meaning". A line that spells the next part of the word
      // above is one of its "> " lines whose ">" got lost (see readReply).
      const { text: columns, unsure } = takeQuestionMark(line);
      const entry = readColumns(columns);
      if (!entry) continue;
      entry.unsure = entry.unsure || unsure;
      if (spellsNextPart(state, entry.word)) addPart(state, 1, entry);
      else addEntry(state, entry);
      continue;
    }
    // Plain text: every run of Chinese characters is one word.
    for (const word of chineseWords(line)) {
      addEntry(state, makeEntry(word));
    }
  }
  const result = makeResult(state, fallbackName, false);
  result.echoedExample = lines.some(line => EXAMPLE_MARK.test(line));
  return result;
}

// True when at least one line looks like "number | ...".
export function isReply(text) {
  const lines = splitLines(normalize(text));
  return lines.some(line => isReplyLine(line));
}

// Reads an AI reply. It is forgiving: code fences, text around the block, full-width pipes,
// extra spaces, missing pinyin or meaning columns and numbering such as "1." are all fine.
export function readReply(text, fallbackName) {
  // Word lines outside the code block too: parts of a long answer pasted together, some
  // copied with their fences and some without. Then every line is read.
  const lines = codeBlock(splitLines(normalize(text)), isReplyLine, isReplyLine);
  const state = newState();

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('#')) {
      readHashLine(line, state);
      continue;
    }
    if (readPartLine(line, state)) continue;
    // Only lines with "|" are word lines. Other lines (the AI's own remarks) are ignored.
    if (!line.includes('|')) continue;
    const { text: columns, unsure } = takeQuestionMark(stripLineDecoration(line));
    const entry = readColumns(columns, true);
    if (!entry) continue; // no Chinese in the line, e.g. a table header
    entry.unsure = entry.unsure || unsure;
    // A line without a page number that spells the next part of the word above is one of its
    // "> " lines whose ">" got lost (a chat app shows "> " lines as quotes, and copying the
    // quote leaves the ">" behind).
    if (entry.page === null && spellsNextPart(state, entry.word)) {
      addPart(state, 1, entry);
    } else {
      addEntry(state, entry);
    }
  }

  const result = makeResult(state, fallbackName, true);
  const heads = result.entries.filter(entry => entry.depth === 0).map(entry => entry.word);
  // The whole example and nothing else: a real reply may well have 你好 or 老师 in it.
  result.echoedExample = lines.some(line => EXAMPLE_MARK.test(line)) || PROMPT_EXAMPLES.some(example =>
    example.every(word => heads.includes(word)) && heads.every(word => example.includes(word)));
  return result;
}

// Lines up two replies with a longest-common-subsequence table, word by word (the "> " parts
// go with their word). Returns entries in A's order, with words that only B has inserted where
// they line up. compare = "same" (both have it), "differs" (the AIs read different words at
// this place; "other" is B's word), "onlyA" or "onlyB".
export function compareReplies(entriesA, entriesB) {
  const a = groupsOf(entriesA || []);
  const b = groupsOf(entriesB || []);

  // table[i][j] = length of the longest common subsequence of a[i..] and b[j..].
  const table = [];
  for (let i = 0; i <= a.length; i++) {
    table.push(new Array(b.length + 1).fill(0));
  }
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      if (a[i].head.word === b[j].head.word) {
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
    if (i < a.length && j < b.length && a[i].head.word === b[j].head.word) {
      flushGap(result, gapA, gapB);
      gapA = [];
      gapB = [];
      pushGroup(result, a[i], 'same', '');
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

// The entries as groups: each word or sentence (depth 0) with the parts that follow it.
export function groupsOf(entries) {
  const groups = [];
  for (const entry of entries) {
    if (!(entry.depth > 0) || groups.length === 0) groups.push({ head: entry, parts: [] });
    else groups[groups.length - 1].parts.push(entry);
  }
  return groups;
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
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const groups = plain.match(/[aeiouv]+/g);
  return groups ? groups.length : 0;
}

// The text of a word or sentence column: Chinese characters and sentence punctuation (one box
// each). Spaces, letters, numbers and other signs are dropped ("妈 妈" -> "妈妈",
// "你好! 我叫李小雨." -> "你好！我叫李小雨。"). A text never starts with punctuation, or ends
// with a comma or an opening mark.
export function boxText(text) {
  let s = normalize(text);
  if (!CHINESE_CHAR.test(s)) return '';
  s = s.replace(/\.{3}/g, '…').replace(/[,!?:;.]/g, ch => TO_CHINESE[ch]);
  return (s.match(BOX_CHARS) || []).join('').replace(LEADING_PUNCTUATION, '').replace(TRAILING_SEPARATORS, '');
}

// Only the Chinese characters of a word or sentence: "你好！" -> "你好".
export function chineseChars(text) {
  return chineseWords(String(text ?? '')).join('');
}

// True for a sentence: a text with punctuation in it.
export function isSentence(word) {
  return HAS_PUNCTUATION.test(String(word ?? ''));
}

// "nǐ → ní" -> { pinyin: "nǐ", said: "ní" }; "nǐ" -> { pinyin: "nǐ", said: "" }.
export function splitArrow(text) {
  const [pinyin, said = ''] = String(text ?? '').split(ARROW);
  return { pinyin: pinyin.trim(), said: said.trim() };
}

// The text of a saved list, in the lesson format. Parts are "> " lines under their word:
//   # name
//   女朋友 | nǚ péngyou | girlfriend
//   > 友 | yǒu → you | friend
//   国
export function toLessonText(name, entries) {
  const title = oneLine(name) || 'Untitled';
  const out = ['# ' + title];
  for (const entry of entries || []) {
    const start = entry.depth > 0 ? '>'.repeat(entry.depth) + ' ' : '';
    const pinyin = cleanColumn(entry.said ? `${entry.pinyin} → ${entry.said}` : entry.pinyin);
    const meaning = cleanColumn(entry.meaning);
    const columns = [entry.word];
    // A sentence keeps its "|", so that reading the list back keeps its punctuation.
    if (pinyin || meaning || isSentence(entry.word)) columns.push(pinyin);
    if (meaning) columns.push(meaning);
    out.push(start + columns.join(' | ').trimEnd());
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
  return { word, pinyin: '', said: '', meaning: '', page: null, unsure: false, compare: null, other: '', depth: 0 };
}

// What reading collects: the names, the total, the entries in order (repeats included), and
// what is left to spell of the last word ("rest", for the "> " lines without ">").
function newState() {
  return { names: [], total: null, continueFrom: null, nothing: '', found: [], rest: '', whole: '' };
}

function addEntry(state, entry) {
  state.found.push(entry);
  state.whole = chineseChars(entry.word);
  // A one-character word has no parts. A word's part is shorter than the word (a repeated line
  // is not a part of itself); a sentence's chunk may be the whole sentence (你好！: 你好).
  state.rest = [...state.whole].length > 1 || isSentence(entry.word) ? state.whole : '';
  state.sentence = isSentence(entry.word);
}

// Adds a part at `depth` under the entry before it. A part needs a parent one level up, so a
// "> " line at the very start becomes a word, and ">>" right under a word becomes ">".
function addPart(state, depth, entry) {
  const previous = state.found[state.found.length - 1];
  if (!previous) {
    addEntry(state, entry);
    return;
  }
  entry.depth = Math.min(depth, previous.depth + 1);
  entry.page = null;
  if (entry.depth === 1 && state.rest.startsWith(chineseChars(entry.word))) {
    state.rest = state.rest.slice(chineseChars(entry.word).length);
  }
  state.found.push(entry);
}

// A "> " line. Returns false when the line is not one.
function readPartLine(line, state) {
  const match = line.match(PART_LINE);
  if (!match) return false;
  const { text, unsure } = takeQuestionMark(match[2].trim());
  const entry = readColumns(text);
  if (entry) {
    entry.unsure = entry.unsure || unsure;
    addPart(state, match[1].replace(/\s/g, '').length, entry);
  }
  return true;
}

// True when `word` is what comes next in the spelling of the last word or sentence.
function spellsNextPart(state, word) {
  const chars = chineseChars(word);
  return chars !== '' && state.rest.startsWith(chars) && (state.sentence || chars !== state.whole);
}

// A line of the lesson format: "word | ..." or a "> " line.
function isLessonLine(line) {
  return (line.includes('|') && CHINESE_CHAR.test(line)) || PART_LINE.test(line.trim());
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

// Handles a line that starts with "#": the total, "continue from page N", "nothing to copy",
// or else a list name.
function readHashLine(line, state) {
  let match = line.match(TOTAL_LINE);
  if (match) {
    // When there are several total lines, the last one counts; a total ends the answer.
    state.total = Number(match[1]);
    state.continueFrom = null;
    return;
  }
  match = line.match(CONTINUE_LINE);
  if (match) {
    state.continueFrom = Number(match[1]);
    return;
  }
  match = line.match(NOTHING_LINE);
  if (match) {
    state.nothing = match[1].trim() || 'no reason given';
    return;
  }
  const name = line.replace(/^#+/, '').trim();
  if (name && !state.names.includes(name)) state.names.push(name);
}

// Reads a line with "|" columns. The word column is the first column that has Chinese
// characters; its text is joined ("妈 妈" -> "妈妈", see boxText). The next column is the
// pinyin ("nǐ → ní" gives the pinyin as said too), the one after it the meaning (more columns
// are added to the meaning). For a reply line, a number in the columns before the word is the
// page. Returns null when no column has Chinese.
function readColumns(line, withPage = false) {
  const columns = stripLineDecoration(line).split('|').map(c => c.trim());
  const wordIndex = columns.findIndex(c => CHINESE_CHAR.test(c));
  if (wordIndex === -1) return null;

  // "老师?" or "学生 ?": the AI put its "not sure" mark on the word. A sentence keeps its own
  // question mark: its pinyin ends with one too ("你好吗？ | Nǐ hǎo ma?").
  let text = columns[wordIndex];
  const pinyinColumn = (columns[wordIndex + 1] || '').trim();
  const unsure = /\?\s*$/.test(text) && (/\s\?+\s*$/.test(text) || (pinyinColumn !== '' && !pinyinColumn.endsWith('?')));
  if (unsure) text = text.replace(/\s*\?+\s*$/, '');

  const entry = makeEntry(boxText(text));
  entry.unsure = unsure;
  const { pinyin, said } = splitArrow(cleanPinyin(columns[wordIndex + 1]));
  entry.pinyin = pinyin;
  entry.said = said;
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

// A line that ends with " ?" means the AI was not sure. The question mark must follow a space,
// a "|" or a Chinese character: "teacher ?", "老师 ?", "| ?", "老师?". Not "how about...?"
// (part of a meaning). Returns the line without it, and whether it was there.
function takeQuestionMark(line) {
  const unsure = /(\s|\||[㐀-䶿一-鿿])\?+\s*$/.test(line);
  return { text: unsure ? line.replace(/\?+\s*$/, '').trim() : line, unsure };
}

// When the text has a code block, only the lines inside code blocks are read (if they hold
// what we look for, and no line outside is one that must be kept), so headings, remarks and a
// pasted prompt around the block do not get in. Otherwise every line is read.
function codeBlock(lines, wanted, mustKeep = () => false) {
  const inside = [];
  const outside = [];
  let inFence = false;
  for (const line of lines) {
    if (FENCE_LINE.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    (inFence ? inside : outside).push(line);
  }
  if (inside.some(line => wanted(line)) && !outside.some(line => mustKeep(line))) return inside;
  return lines;
}

// Builds the ListResult: removes repeated words (with their parts) and works out the list name.
function makeResult(state, fallbackName, readAsReply) {
  const groups = groupsOf(state.found);
  const kept = [];
  const byWord = new Map();
  for (const group of groups) {
    const first = byWord.get(group.head.word);
    if (!first) {
      byWord.set(group.head.word, group);
      kept.push(group);
      continue;
    }
    // A repeat: keep the first one, but fill in what it lacks, and keep the "unsure" flag.
    const head = first.head;
    const entry = group.head;
    if (!head.pinyin) {
      head.pinyin = entry.pinyin;
      head.said = entry.said;
    }
    if (!head.meaning) head.meaning = entry.meaning;
    if (head.page === null) head.page = entry.page;
    if (entry.unsure) head.unsure = true;
    if (!first.parts.length) first.parts = group.parts;
  }
  return {
    name: listName(state.names, fallbackName),
    entries: kept.flatMap(group => [group.head, ...group.parts]),
    removed: groups.length - kept.length,
    isReply: readAsReply,
    lines: groups.length,
    total: state.total,
    echoedExample: false,
    continueFrom: state.continueFrom,
    nothing: state.nothing,
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

// Adds a word and copies of its parts to the result.
function pushGroup(result, group, compare, other) {
  result.push({ ...group.head, compare, other });
  for (const part of group.parts) result.push({ ...part });
}

// Adds the words of one gap to the result. The first words of A and B in the gap are paired
// as "differs"; the rest are "onlyA" or "onlyB".
function flushGap(result, gapA, gapB) {
  const pairs = Math.min(gapA.length, gapB.length);
  for (let k = 0; k < pairs; k++) {
    pushGroup(result, gapA[k], 'differs', gapB[k].head.word);
  }
  for (let k = pairs; k < gapA.length; k++) {
    pushGroup(result, gapA[k], 'onlyA', '');
  }
  for (let k = pairs; k < gapB.length; k++) {
    pushGroup(result, gapB[k], 'onlyB', '');
  }
}
