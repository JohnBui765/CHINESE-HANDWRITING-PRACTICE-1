// Changes to the word list that the check screen offers: Split, Split all, and filling in
// pinyin and meaning from an AI reply. No browser APIs, so Node can test it.
//
// A split character remembers its word in `splitFrom` (e.g. "女朋友"). Its pinyin comes from
// that word, so the check screen asks the owner to check it on its own: tones can change
// inside a word (友 is yǒu on its own, but "you" in 朋友).

import { splitPinyin } from './pinyin.js';

// The format example in prompts/pinyin-meaning.txt. If the AI's reply has only these
// characters, it repeated the example instead of answering.
export const PINYIN_PROMPT_EXAMPLE = ['山', '水'];

// One entry per character of a word. A word's meaning is not its characters' meaning, so
// the meaning is left empty; the rest (rows, page, the AI's warnings) stays with each character.
export function splitWord(entry) {
  const chars = [...entry.word];
  if (chars.length < 2) return [entry];
  const syllables = splitPinyin(entry.pinyin, entry.word);
  return chars.map((ch, i) => ({
    ...entry,
    word: ch,
    pinyin: syllables ? syllables[i] : '',
    meaning: '',
    splitFrom: entry.word,
  }));
}

// Splits the word at `index`, or every word with two or more characters when index is null.
// Returns { entries, split, removed }: the new list, how many words were split, and how many
// repeated characters were removed afterwards. Only repeats of the new characters are removed;
// the rest of the list is left as it is.
export function splitEntries(entries, index = null) {
  const out = [];
  const newCharacters = new Set();
  let split = 0;
  entries.forEach((entry, i) => {
    if ((index === null || index === i) && [...entry.word].length > 1) {
      const parts = splitWord(entry);
      parts.forEach(part => newCharacters.add(part.word));
      out.push(...parts);
      split++;
    } else {
      out.push(entry);
    }
  });
  const result = removeRepeats(out, newCharacters);
  return { entries: result.entries, split, removed: result.removed };
}

const WARNING_COMPARES = ['differs', 'onlyA', 'onlyB'];

// Keeps the first entry of each word, in its place (only for the words in `only`, when given).
// Nothing a repeat knows is lost:
// - pinyin: taken from the repeat when the first has none, or when the first's came from a
//   word and the repeat's is the character's own; where it came from (splitFrom) comes with it;
// - meaning: taken when the first has none;
// - the AI's warnings ("not sure", "the AIs disagree") are kept.
export function removeRepeats(entries, only = null) {
  const byWord = new Map();
  const out = [];
  for (const entry of entries) {
    const first = byWord.get(entry.word);
    if (!first || (only && !only.has(entry.word))) {
      const copy = { ...entry };
      if (!first) byWord.set(entry.word, copy);
      out.push(copy);
      continue;
    }
    if (entry.pinyin && (!first.pinyin || (first.splitFrom && !entry.splitFrom))) {
      first.pinyin = entry.pinyin;
      first.splitFrom = entry.splitFrom || '';
    }
    if (!first.meaning && entry.meaning) first.meaning = entry.meaning;
    if (entry.unsure) first.unsure = true;
    if (WARNING_COMPARES.includes(entry.compare) && !WARNING_COMPARES.includes(first.compare)) {
      first.compare = entry.compare;
      first.other = entry.other;
    }
  }
  return { entries: out, removed: entries.length - out.length };
}

// The pasted words that can fill in the list: those with pinyin or a meaning (lines like
// "女 | nǚ | woman"), leaving out the prompt's example characters. Words from the AI's own
// remarks ("as in 朋友") have neither, so they don't count.
function usefulLines(incoming) {
  return incoming.filter(entry => (entry.pinyin || entry.meaning) && !PINYIN_PROMPT_EXAMPLE.includes(entry.word));
}

// True when every useful pasted word (see usefulLines) is already in the current list: then the
// paste fills in pinyin and meaning instead of replacing the list.
export function allInList(entries, incoming) {
  const words = new Set(entries.map(entry => entry.word));
  const useful = usefulLines(incoming);
  return useful.length > 0 && useful.every(entry => words.has(entry.word));
}

// Fills in pinyin and meaning from a pasted list (e.g. the AI's reply to the pinyin prompt).
// It only fills what is missing: an empty pinyin or meaning, or pinyin taken from a word
// (then that warning goes away). Pinyin and meanings the owner already has are kept.
// Returns { entries, updated }: updated = how many words got something new.
export function fillIn(entries, incoming) {
  const byWord = new Map();
  for (const entry of usefulLines(incoming)) if (!byWord.has(entry.word)) byWord.set(entry.word, entry);
  let updated = 0;
  const out = entries.map(entry => {
    const source = byWord.get(entry.word);
    if (!source) return entry;
    const result = { ...entry };
    if (source.pinyin && (!entry.pinyin || entry.splitFrom)) {
      result.pinyin = source.pinyin;
      result.splitFrom = '';
    }
    if (source.meaning && !entry.meaning) result.meaning = source.meaning;
    if (result.pinyin === entry.pinyin && result.meaning === entry.meaning && result.splitFrom === entry.splitFrom) {
      return entry;
    }
    updated++;
    return result;
  });
  return { entries: out, updated };
}

// The words to ask the AI about: those without pinyin or meaning, and split characters
// (their pinyin came from a word). Returns the prompt with one word per line after it,
// or '' when every word already has its own pinyin and meaning.
export function pinyinPrompt(promptText, entries) {
  const words = entries
    .filter(entry => !entry.pinyin || !entry.meaning || entry.splitFrom)
    .map(entry => entry.word);
  if (words.length === 0) return '';
  return promptText.trimEnd() + '\n' + words.join('\n') + '\n';
}

// True when a pasted reply only repeats the pinyin prompt's format example: there is a list
// to fill in, and the reply has only the example's lines (with their pinyin).
export function isPinyinPromptExample(incoming, entries) {
  const inList = new Set(entries.map(entry => entry.word));
  return entries.length > 0 && incoming.length > 0 && incoming.every(entry =>
    PINYIN_PROMPT_EXAMPLE.includes(entry.word) && entry.pinyin && !inList.has(entry.word));
}
