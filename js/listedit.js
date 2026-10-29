// Changes to the word list that the check screen offers: Split and Unsplit, moving and
// deleting a word with its parts, the repeats that are printed only once, filling in pinyin
// and meaning from an AI reply, and the pinyin prompt. No browser APIs, so Node can test it.
//
// The list is flat. A word's parts follow it, one level deeper (depth 1): its characters, or
// the chunks of a sentence (and the characters of a chunk, depth 2).
//
// A character made by Split remembers its word in `splitFrom` (e.g. "女朋友"): its pinyin was
// cut from that word's pinyin, so the check screen asks the owner to check it. Tones can
// change inside a word (友 is yǒu on its own, but "you" in 朋友).

import { splitPinyin } from './pinyin.js';
import { chineseChars, groupsOf } from './extract.js';

// The format example in prompts/pinyin-meaning.txt. If the AI's reply has only these
// characters, it repeated the example instead of answering.
export const PINYIN_PROMPT_EXAMPLE = ['山', '水果', '水', '果'];

const MOST_DEPTH = 2;   // sentence -> chunk -> character

const depthOf = entry => entry.depth || 0;

// The index just after the entry's parts (and their parts).
export function groupEnd(entries, index) {
  const depth = depthOf(entries[index]);
  let end = index + 1;
  while (end < entries.length && depthOf(entries[end]) > depth) end++;
  return end;
}

// The indexes of the entry's own parts (one level deeper).
export function partIndexes(entries, index) {
  const depth = depthOf(entries[index]);
  const out = [];
  for (let i = index + 1; i < groupEnd(entries, index); i++) {
    if (depthOf(entries[i]) === depth + 1) out.push(i);
  }
  return out;
}

// For every entry: true when it is a repeat, shown in grey and not printed. A word is
// printed only the first time it appears in the list (as a word, a chunk or a character),
// unless the owner pressed "Print again" on the repeat (again: true).
export function repeatFlags(entries) {
  const seen = new Set();
  return entries.map(entry => {
    const repeat = seen.has(entry.word) && !entry.again;
    seen.add(entry.word);
    return repeat;
  });
}

// The entries that are printed, in order.
export function printedEntries(entries) {
  const repeats = repeatFlags(entries);
  return entries.filter((_, i) => !repeats[i]);
}

// Split is possible for an entry with two or more Chinese characters and no parts yet.
export function canSplit(entries, index) {
  const entry = entries[index];
  return depthOf(entry) < MOST_DEPTH && chineseChars(entry.word).length > 1 &&
    partIndexes(entries, index).length === 0;
}

// Split: the entry at `index`, or every entry that can be split when index is null, keeps its
// place and gets one part per Chinese character right under it. Repeats are not split by
// Split all (they are not printed). Returns { entries, split }: the new list and how many
// entries were split.
export function splitEntries(entries, index = null) {
  const repeats = repeatFlags(entries);
  const out = [];
  let split = 0;
  entries.forEach((entry, i) => {
    out.push(entry);
    const chosen = index === null ? !repeats[i] : index === i;
    if (chosen && canSplit(entries, i)) {
      out.push(...partsFor(entry, entries));
      split++;
    }
  });
  return { entries: out, split };
}

// The parts Split makes: one per Chinese character, with its syllable of the word's pinyin
// (none when the pinyin cannot be split), and the syllable as said when the word has one.
function partsFor(entry, entries) {
  const chars = [...chineseChars(entry.word)];
  const syllables = splitPinyin(entry.pinyin, chars.join(''));
  const said = entry.said ? splitPinyin(entry.said, chars.join('')) : null;
  return chars.map((ch, i) => useKnown({
    word: ch,
    pinyin: syllables ? syllables[i] : '',
    said: said && syllables && said[i] !== syllables[i] ? said[i] : '',
    meaning: '',
    page: null,
    unsure: false,
    compare: null,
    other: '',
    splitFrom: entry.word,
    depth: depthOf(entry) + 1,
    again: false,
    rows: entry.rows,
  }, entries));
}

// The letters of a syllable, without tones: "yǒu" -> "you", "nǚ" / "nv3" -> "nu".
function letters(pinyin) {
  return String(pinyin).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[1-5:]/g, '')
    .toLowerCase().replace(/v/g, 'u');
}

// A character that the list already has with the same reading and its own pinyin (not cut
// from a word) gives the new part that pinyin and its meaning: 国 from 中国 takes "guó, country"
// from a separate 国 row. When only the tone differs, the word's syllable becomes the pinyin as
// said: 友 from 朋友 "péngyou" next to a 友 "yǒu" shows "yǒu → you". Another reading gives
// nothing (行 háng in 银行 is not 行 xíng, "to walk").
function useKnown(part, entries) {
  if (!part.pinyin) return part;
  const known = entries.find(entry => entry.word === part.word && entry.pinyin && !entry.splitFrom &&
    letters(entry.pinyin) === letters(part.pinyin));
  if (!known) return part;
  const inWord = part.said || part.pinyin;
  const same = inWord.toLowerCase() === known.pinyin.toLowerCase();
  return { ...part, pinyin: known.pinyin, said: same ? '' : inWord, meaning: known.meaning || '', splitFrom: '' };
}

// Unsplit: removes the parts under the entry at `index` (and their parts).
export function unsplit(entries, index) {
  return [...entries.slice(0, index + 1), ...entries.slice(groupEnd(entries, index))];
}

// Delete: removes the entry at `index` with its parts.
export function deleteEntry(entries, index) {
  return [...entries.slice(0, index), ...entries.slice(groupEnd(entries, index))];
}

// Moves the word or sentence at `index` (depth 0), with its parts, above the word before it
// (direction -1) or below the word after it (+1).
export function moveEntry(entries, index, direction) {
  const end = groupEnd(entries, index);
  if (direction < 0) {
    let start = index - 1;
    while (start > 0 && depthOf(entries[start]) > 0) start--;
    if (start < 0) return entries;
    return [...entries.slice(0, start), ...entries.slice(index, end), ...entries.slice(start, index), ...entries.slice(end)];
  }
  if (end >= entries.length) return entries;
  const nextEnd = groupEnd(entries, end);
  return [...entries.slice(0, index), ...entries.slice(end, nextEnd), ...entries.slice(index, end), ...entries.slice(nextEnd)];
}

// The pasted lines that can fill in the list: words with pinyin or a meaning (lines like
// "女 | nǚ | woman"), leaving out the prompt's example words that the list does not have (a
// list may well have 水果). Words from the AI's own remarks ("as in 朋友") have neither pinyin
// nor meaning, so they don't count.
function usefulLines(incoming, inList) {
  return incoming.filter(entry => !(entry.depth > 0) && (entry.pinyin || entry.meaning) &&
    !(PINYIN_PROMPT_EXAMPLE.includes(entry.word) && !inList.has(entry.word)));
}

// True when every useful pasted word (see usefulLines) is already in the current list (as a
// word or as a part): then the paste fills in pinyin and meaning instead of replacing the list.
export function allInList(entries, incoming) {
  const words = new Set(entries.map(entry => entry.word));
  const useful = usefulLines(incoming, words);
  return useful.length > 0 && useful.every(entry => words.has(entry.word));
}

// Fills in pinyin and meaning from a pasted list (e.g. the AI's reply to the pinyin prompt).
// It only fills what is missing: an empty pinyin or meaning, or pinyin cut from a word (then
// that warning goes away). Pinyin and meanings the owner already has are kept.
// The "> " lines under a pasted word fill in the parts of that word, place by place, so each
// character gets the reading it has in that word.
// Returns { entries, updated }: updated = how many entries got something new.
export function fillIn(entries, incoming) {
  const byWord = new Map();
  // (A pasted word fills only entries with the same word, so the prompt's example lines fill
  // nothing unless the list has those words; then their pinyin and meaning are right anyway.)
  for (const group of groupsOf(incoming)) {
    if (!byWord.has(group.head.word)) byWord.set(group.head.word, group);
  }
  const out = entries.map(entry => ({ ...entry }));
  const changed = new Set();
  // First the parts, from the "> " lines of their own word: the most exact source.
  out.forEach((entry, index) => {
    const group = byWord.get(entry.word);
    if (!group || !group.parts.length) return;
    partIndexes(out, index).forEach((partIndex, k) => {
      const source = group.parts[k];
      if (source && source.word === out[partIndex].word && fillFrom(out[partIndex], source)) changed.add(partIndex);
    });
  });
  // Then every entry from a pasted line with the same word.
  out.forEach((entry, index) => {
    const group = byWord.get(entry.word);
    if (group && fillFrom(entry, group.head)) changed.add(index);
  });
  return { entries: out, updated: changed.size };
}

// Fills `entry` from `source` where something is missing. True when something changed.
function fillFrom(entry, source) {
  let changed = false;
  if (source.pinyin && (!entry.pinyin || entry.splitFrom)) {
    entry.pinyin = source.pinyin;
    entry.said = source.said || '';
    entry.splitFrom = '';
    changed = true;
  }
  if (source.meaning && !entry.meaning) {
    entry.meaning = source.meaning;
    changed = true;
  }
  if (changed && source.unsure) entry.unsure = true;
  return changed;
}

const needsHelp = entry => !entry.pinyin || !entry.meaning || Boolean(entry.splitFrom);

// The words to ask the AI about: those without pinyin or meaning, and parts made by Split
// (their pinyin came from a word). A word whose parts need help is listed with all its parts
// as "> " lines, so the AI can give each character the reading it has in that word.
// Returns the prompt with the list after it, or '' when nothing needs help.
export function pinyinPrompt(promptText, entries) {
  const lines = [];
  const listed = new Set();    // words already at the start of a line
  const covered = new Set();   // entries already asked about as a "> " line
  entries.forEach((entry, index) => {
    const parts = partIndexes(entries, index);
    const partsNeedHelp = parts.some(i => needsHelp(entries[i]));
    if (!partsNeedHelp && (covered.has(index) || !needsHelp(entry))) return;
    if (listed.has(entry.word)) return;
    listed.add(entry.word);
    lines.push(entry.word);
    if (partsNeedHelp) {
      for (const i of parts) {
        lines.push(`> ${entries[i].word}`);
        covered.add(i);
      }
    }
  });
  if (!lines.length) return '';
  return promptText.trimEnd() + '\n' + lines.join('\n') + '\n';
}

// True when a pasted reply only repeats the pinyin prompt's format example: there is a list
// to fill in, and the reply has only the example's lines (with their pinyin).
export function isPinyinPromptExample(incoming, entries) {
  const inList = new Set(entries.map(entry => entry.word));
  return entries.length > 0 && incoming.length > 0 && incoming.every(entry =>
    PINYIN_PROMPT_EXAMPLE.includes(entry.word) && entry.pinyin && !inList.has(entry.word));
}
