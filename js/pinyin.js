// Splits the pinyin of a word into one syllable per character, for the Split button:
//   splitPinyin('nǚ péngyou', '女朋友')  ->  ['nǚ', 'péng', 'you']
//   splitPinyin('Zhōngguó', '中国')      ->  ['zhōng', 'guó']
//   splitPinyin('nǎr', '哪儿')           ->  ['nǎ', 'ér']
// Returns null when the pinyin cannot be split into exactly one syllable per character.
// A wrong split is worse than none, so when in doubt the answer is null.
// No browser APIs, so Node can test it.

// Which finals each initial can take, from the standard table of Hanyu Pinyin.
// "v" stands for ü (nǚ -> "nv"); after j, q, x and y the letter u already means ü.
// The empty initial '' is for syllables such as "ài" or "ér".
const FINALS = {
  '': 'a ai an ang ao e ei en eng er o ou',
  b: 'a ai an ang ao ei en eng i ian iao ie in ing o u',
  p: 'a ai an ang ao ei en eng i ian iao ie in ing o ou u',
  m: 'a ai an ang ao e ei en eng i ian iao ie in ing iu o ou u',
  f: 'a an ang ei en eng o ou u',
  d: 'a ai an ang ao e ei en eng i ia ian iao ie ing iu ong ou u uan ui un uo',
  t: 'a ai an ang ao e eng i ian iao ie ing ong ou u uan ui un uo',
  n: 'a ai an ang ao e ei en eng i ian iang iao ie in ing iu ong ou u uan un uo v ve ue',
  l: 'a ai an ang ao e ei eng i ia ian iang iao ie in ing iu o ong ou u uan un uo v ve ue',
  g: 'a ai an ang ao e ei en eng ong ou u ua uai uan uang ui un uo',
  k: 'a ai an ang ao e ei en eng ong ou u ua uai uan uang ui un uo',
  h: 'a ai an ang ao e ei en eng ong ou u ua uai uan uang ui un uo',
  j: 'i ia ian iang iao ie in ing iong iu u uan ue un',
  q: 'i ia ian iang iao ie in ing iong iu u uan ue un',
  x: 'i ia ian iang iao ie in ing iong iu u uan ue un',
  zh: 'a ai an ang ao e ei en eng i ong ou u ua uai uan uang ui un uo',
  ch: 'a ai an ang ao e en eng i ong ou u ua uai uan uang ui un uo',
  sh: 'a ai an ang ao e ei en eng i ou u ua uai uan uang ui un uo',
  r: 'an ang ao e en eng i ong ou u ua uan ui un uo',
  z: 'a ai an ang ao e ei en eng i ong ou u uan ui un uo',
  c: 'a ai an ang ao e en eng i ong ou u uan ui un uo',
  s: 'a ai an ang ao e en eng i ong ou u uan ui un uo',
  y: 'a an ang ao e i in ing o ong ou u uan ue un',
  w: 'a ai an ang ei en eng o u',
};

// Every valid syllable without tone marks: about 400.
export const SYLLABLES = new Set(
  Object.entries(FINALS).flatMap(([initial, finals]) => finals.split(' ').map(final => initial + final)),
);

const LONGEST = 6;          // the longest syllables have six letters
const MOST_LETTERS = 200;   // more letters than any word's pinyin: not pinyin, don't try

// A letter as it is matched against SYLLABLES: lower case, no tone mark, ü as "v".
function plainLetter(ch) {
  const parts = ch.normalize('NFD');           // "ǚ" -> "u" + two marks
  const base = parts[0].toLowerCase();
  if (base === 'u' && parts.includes('̈')) return 'v';
  return base;
}

// The pinyin as "chunks": runs of letters between spaces, apostrophes, hyphens and tone
// numbers. Each letter keeps its original text (for the result) and whether it carries a
// tone (a tone mark, or a tone number written after it).
function chunksOf(pinyin) {
  const chunks = [];
  let current = [];
  const close = () => {
    if (current.length) chunks.push(current);
    current = [];
  };
  // NFKC also turns full-width letters (ｚ) into normal ones.
  for (const ch of String(pinyin ?? '').normalize('NFKC')) {
    const previous = current[current.length - 1];
    if (ch === ':' && previous && previous.plain === 'u') {
      // "u:" is an old way to type ü: "nu:3".
      previous.plain = 'v';
      previous.text += ':';
      continue;
    }
    if (/[1-5]/.test(ch) && previous) {
      // A tone number ends its syllable: "ni3hao3".
      previous.text += ch;
      if (ch !== '5') previous.toned = true;
      close();
      continue;
    }
    const plain = plainLetter(ch);
    const toned = /[̀́̄̌]/.test(ch.normalize('NFD'));
    if (/^[a-z]$/.test(plain)) current.push({ plain, text: ch, toned });
    else close();
  }
  close();
  // After j, q, x and y a written ü is the same as u: "jǔ" may also come as "jǚ".
  for (const chunk of chunks) {
    chunk.forEach((letter, i) => {
      if (letter.plain === 'v' && i > 0 && 'jqxy'.includes(chunk[i - 1].plain)) letter.plain = 'u';
    });
  }
  return chunks;
}

// All the ways to cut one chunk into valid syllables, trying the longest syllable first.
// Rules that keep the cuts honest:
// - A syllable has at most one tone.
// - In written pinyin a syllable that starts with a, o or e never follows another one
//   without an apostrophe (Xī'ān). In strict mode such a syllable may only start the chunk.
//   Not strict: it may also start in the middle, but only if both it and the syllable before
//   it carry a tone ("Xīān", "nǚér"), so "hǎo" never becomes "hǎ" + "o" and "Zhōngguó"
//   never becomes "zhōng" + "gu" + "ó".
// - finalEr: a word ending in 儿 may end with an untoned "er" after a toned syllable ("nǚer").
function cutsOf(chunk, strict, finalEr) {
  const plain = chunk.map(letter => letter.plain).join('');
  const found = [];
  const deadEnds = new Set();   // places where no cut can finish: never try them twice
  const walk = (start, parts, previousToned) => {
    if (found.length >= 20) return true;
    if (start === plain.length) {
      found.push([...parts]);
      return true;
    }
    const key = `${start}:${previousToned}`;
    if (deadEnds.has(key)) return false;
    let finished = false;
    for (let end = Math.min(plain.length, start + LONGEST); end > start; end--) {
      const piece = plain.slice(start, end);
      if (!SYLLABLES.has(piece)) continue;
      const tones = chunk.slice(start, end).filter(letter => letter.toned).length;
      if (tones > 1) continue;
      if (start > 0 && 'aoe'.includes(piece[0])) {
        const lastEr = finalEr && piece === 'er' && end === plain.length && tones === 0 && previousToned;
        if (!lastEr && (strict || tones === 0 || !previousToned)) continue;
      }
      parts.push([start, end]);
      if (walk(end, parts, tones > 0)) finished = true;
      parts.pop();
    }
    if (!finished) deadEnds.add(key);
    return finished;
  };
  walk(0, [], false);
  return found;
}

// Picks one way of cutting each chunk so that the syllables add up to exactly `count`.
function choose(options, index, count) {
  if (index === options.length) return count === 0 ? [] : null;
  for (const option of options[index]) {
    if (option.length > count) continue;
    const rest = choose(options, index + 1, count - option.length);
    if (rest) return [option, ...rest];
  }
  return null;
}

function trySplit(chunks, count, strict, finalEr = false) {
  const options = chunks.map((chunk, i) => cutsOf(chunk, strict, finalEr && i === chunks.length - 1));
  if (options.some(option => option.length === 0)) return null;
  const chosen = choose(options, 0, count);
  if (!chosen) return null;
  const syllables = [];
  chosen.forEach((cuts, i) => {
    for (const [start, end] of cuts) {
      syllables.push(chunks[i].slice(start, end).map(letter => letter.text).join('').toLowerCase());
    }
  });
  return syllables;
}

export function splitPinyin(pinyin, word) {
  word = String(word ?? '');
  const count = [...word].length;
  const chunks = chunksOf(pinyin);
  const letters = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (count === 0 || chunks.length === 0 || letters > MOST_LETTERS) return null;
  for (const strict of [true, false]) {
    const syllables = trySplit(chunks, count, strict);
    if (syllables) return syllables;
  }
  if (count < 2 || !word.endsWith('儿')) return null;

  // Words ending in 儿. First: an untoned "er" at the end ("nǚer").
  const withEr = trySplit(chunks, count, false, true);
  if (withEr) return withEr;
  // Then: written with one syllable less (哪儿 "nǎr", 一点儿 "yìdiǎnr"). Take the final "r"
  // away, split the rest, and give 儿 its own reading "ér".
  const last = chunks[chunks.length - 1];
  const r = last[last.length - 1];
  if (r.plain !== 'r') return null;
  let shorter = chunks.slice(0, -1);
  if (last.length > 1) {
    const rest = last.slice(0, -1).map(letter => ({ ...letter }));
    const digit = r.text.match(/[1-5]$/);   // "nar3": the tone number belongs to "na"
    if (digit) {
      rest[rest.length - 1].text += digit[0];
      if (digit[0] !== '5') rest[rest.length - 1].toned = true;
    }
    shorter = [...shorter, rest];
  }
  if (shorter.length === 0) return null;
  for (const strict of [true, false]) {
    const syllables = trySplit(shorter, count - 1, strict);
    if (syllables) return [...syllables, 'ér'];
  }
  return null;
}
