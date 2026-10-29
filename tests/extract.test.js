// Tests for js/extract.js. Run with:  node --test tests/extract.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readText,
  isReply,
  readReply,
  compareReplies,
  countSyllables,
  toLessonText,
  safeFileName,
  boxText,
  splitArrow,
  PROMPT_EXAMPLES,
} from '../js/extract.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
const readFixture = name => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const words = result => result.entries.map(e => e.word);

describe('plain text', () => {
  test('mixed Chinese, pinyin, Vietnamese, English and numbers give only the Chinese words', () => {
    const text = [
      'Bài 3: 我是中国人 (wǒ shì Zhōngguó rén) – Tôi là người Trung Quốc. I am Chinese.',
      'Từ mới 1: 女朋友 nǚ péngyou, bạn gái; 2. 哪 nǎ (which) 2024 国 guó',
      '女朋友 again! 中国人 123 我是中国人, 你好，再见。',
    ].join('\n');
    const result = readText(text);
    assert.deepEqual(words(result), ['我是中国人', '女朋友', '哪', '国', '中国人', '你好', '再见']);
    assert.equal(result.removed, 2);
    assert.equal(result.lines, 9);
    assert.equal(result.name, 'Untitled');
    assert.equal(result.isReply, false);
    assert.equal(result.total, null);
    assert.equal(result.echoedExample, false);
    for (const entry of result.entries) {
      assert.deepEqual(
        { pinyin: entry.pinyin, meaning: entry.meaning, page: entry.page, unsure: entry.unsure },
        { pinyin: '', meaning: '', page: null, unsure: false },
      );
      assert.equal(entry.compare, null);
      assert.equal(entry.other, '');
    }
  });

  test('words are never split, and the same character may be in several words', () => {
    assert.deepEqual(words(readText('中国 中文 国 中国')), ['中国', '中文', '国']);
  });

  test('Extension A characters are kept; other scripts separate words', () => {
    assert.deepEqual(words(readText('\u3400好 abc 好')), ['\u3400好', '好']);
  });

  test('Kangxi radical code points become normal characters (NFKC)', () => {
    // U+2F25 ⼥ -> 女, U+2F08 ⼈ -> 人, U+2F1D ⼝ -> 口, U+2F49 ⽉ -> 月
    const result = readText('\u2F25朋友 \u2F08 \u2F1D \u2F49亮');
    assert.deepEqual(words(result), ['女朋友', '人', '口', '月亮']);
    assert.equal(result.entries[0].word.codePointAt(0), 0x5973);
  });

  test('empty text gives an empty list', () => {
    const result = readText('');
    assert.deepEqual(result, {
      name: 'Untitled',
      entries: [],
      removed: 0,
      isReply: false,
      lines: 0,
      total: null,
      echoedExample: false,
      continueFrom: null,
      nothing: '',
    });
  });
});

describe('lesson format', () => {
  test('with pinyin and meaning columns', () => {
    const result = readText(readFixture('lesson_columns.txt'), 'lesson_columns');
    assert.equal(result.name, 'Bài 5');
    assert.deepEqual(
      result.entries.map(e => [e.word, e.pinyin, e.meaning]),
      [
        ['女朋友', 'nǚ péngyou', 'girlfriend'],
        ['哪', 'nǎ', 'which'],
        ['国', 'guó', ''],
        ['她', '', 'she'],
        ['喂', '', ''],
      ],
    );
    assert.equal(result.removed, 1);
    assert.equal(result.isReply, false);
  });

  test('without columns', () => {
    const result = readText(readFixture('lesson_plain.txt'), 'lesson_plain');
    assert.equal(result.name, 'Bài 5');
    assert.deepEqual(words(result), ['女朋友', '哪', '国']);
  });

  test('the word column is all its Chinese characters joined', () => {
    const result = readText('妈 妈 | mā ma | mum\n- 姐姐 | jiě jie');
    assert.deepEqual(words(result), ['妈妈', '姐姐']);
    assert.equal(result.entries[1].pinyin, 'jiě jie');
  });

  test('a repeat fills in a pinyin or meaning the first line lacks', () => {
    const result = readText('国\n国 | guó | country');
    assert.deepEqual(result.entries.map(e => [e.word, e.pinyin, e.meaning]), [['国', 'guó', 'country']]);
    assert.equal(result.removed, 1);
  });
});

describe('list name', () => {
  test('the "#" line', () => {
    assert.equal(readText('# Bài 5\n女').name, 'Bài 5');
    assert.equal(readText('## Bài 5\n女').name, 'Bài 5'); // Markdown heading
    assert.equal(readText('＃ Bài 5\n女').name, 'Bài 5'); // full-width #
  });

  test('several lessons give "Bài 3–4" with an en dash', () => {
    assert.equal(readText('# Bài 3\n女\n# Bài 4\n有').name, 'Bài 3\u20134');
    assert.equal(readText('# Bài 3 我是中国人\n女\n# Bài 4 我有两个孩子\n有').name, 'Bài 3–4');
    assert.equal(readText('# Bài 3\n# Bài 4\n# Bài 5').name, 'Bài 3–5');
    assert.equal(readText('# HSK1 Bài 3\n# HSK1 Bài 4').name, 'HSK1 Bài 3–4');
    assert.equal(readText('# Bài 3\n女\n# Bài 3\n有').name, 'Bài 3'); // same name twice
  });

  test('different names give "first–last"', () => {
    assert.equal(readText('# Review\n女\n# Bài 4\n有').name, 'Review–Bài 4');
  });

  test('no "#" line: the file name, or "Untitled"', () => {
    assert.equal(readText('女朋友', 'My lesson').name, 'My lesson');
    assert.equal(readText('女朋友').name, 'Untitled');
    assert.equal(readText('女朋友', '   ').name, 'Untitled');
  });

  test('"# total:" is not a list name', () => {
    const result = readText('女\n# total: 1', 'file');
    assert.equal(result.name, 'file');
    assert.equal(result.total, 1);
  });

  test('words on "#" lines are not words of the list', () => {
    assert.deepEqual(words(readText('# Bài 3 我是中国人\n女朋友')), ['女朋友']);
  });
});

describe('AI reply', () => {
  const reply = [
    '# Bài 3',
    '1 | 女朋友 | nǚ péng you | girlfriend',
    '1 | 哪 | nǎ | which',
    '2 | 国 | guó | country ?',
    '# total: 3',
  ].join('\n');

  test('isReply: a line that looks like "number | ..."', () => {
    assert.equal(isReply(reply), true);
    assert.equal(isReply('1 ｜ 女朋友'), true); // full-width pipe
    assert.equal(isReply('| 1 | 女朋友 | nǚ |'), true); // Markdown table
    assert.equal(isReply('1. 3 | 女朋友'), true); // numbering in front
    assert.equal(isReply('女朋友 | nǚ péngyou'), false); // lesson format
    assert.equal(isReply('女朋友\n哪'), false);
    assert.equal(isReply('10 | 20'), false); // no Chinese word
  });

  test('a plain reply', () => {
    const result = readText(reply, 'pasted');
    assert.equal(result.isReply, true);
    assert.equal(result.name, 'Bài 3');
    assert.equal(result.total, 3);
    assert.equal(result.lines, 3);
    assert.equal(result.echoedExample, false);
    assert.deepEqual(result.entries[0], {
      word: '女朋友',
      pinyin: 'nǚ péng you',
      said: '',
      meaning: 'girlfriend',
      page: 1,
      unsure: false,
      compare: null,
      other: '',
      depth: 0,
    });
    assert.deepEqual(
      result.entries.map(e => [e.word, e.page, e.unsure, e.meaning]),
      [
        ['女朋友', 1, false, 'girlfriend'],
        ['哪', 1, false, 'which'],
        ['国', 2, true, 'country'],
      ],
    );
  });

  test('a fenced reply with text before and after it', () => {
    const text = [
      'Here is the vocabulary from Bài 3 (我是中国人):',
      '## Notes',
      '```text',
      reply,
      '```',
      'I was not sure about 国. Hope this helps! 加油',
    ].join('\n');
    const result = readText(text);
    assert.deepEqual(words(result), ['女朋友', '哪', '国']);
    assert.equal(result.name, 'Bài 3');
    assert.equal(result.total, 3);
  });

  test('text around the block without a fence', () => {
    const text = `Sure! Here it is.\n${reply}\nLet me know if you need anything else, 朋友.`;
    const result = readText(text);
    assert.deepEqual(words(result), ['女朋友', '哪', '国']);
  });

  test('full-width pipes and extra spaces', () => {
    const result = readText('  1  ｜  女朋友 ｜  nǚ   péng  you ｜ girl  friend  \n１ ｜ 哪 ｜ nǎ ｜ which');
    assert.deepEqual(
      result.entries.map(e => [e.word, e.pinyin, e.meaning, e.page]),
      [
        ['女朋友', 'nǚ péng you', 'girl friend', 1],
        ['哪', 'nǎ', 'which', 1],
      ],
    );
  });

  test('no pinyin column, no meaning column, an empty pinyin column', () => {
    const result = readText('1 | 女朋友\n1 | 哪 | nǎ\n2 | 国 |  | country\n2 | 她 | - | she');
    assert.deepEqual(
      result.entries.map(e => [e.word, e.pinyin, e.meaning]),
      [
        ['女朋友', '', ''],
        ['哪', 'nǎ', ''],
        ['国', '', 'country'],
        ['她', '', 'she'],
      ],
    );
  });

  test('numbering such as "1." and page labels', () => {
    const result = readText('1. 1 | 女朋友 | nǚ\n2) 3 | 哪 | nǎ\np4 | 国 | guó\nPage 5 | 她 | tā');
    assert.deepEqual(
      result.entries.map(e => [e.word, e.page]),
      [
        ['女朋友', 1],
        ['哪', 3],
        ['国', 4],
        ['她', 5],
      ],
    );
  });

  test('the word column is one word, even with spaces in it', () => {
    const result = readText('8 | 妈 妈 | mā ma | mum');
    assert.deepEqual(words(result), ['妈妈']);
  });

  test('pinyin slashes as printed on the worksheet are removed', () => {
    assert.equal(readText('1 | 女朋友 | /nǚ péng you/ | girlfriend').entries[0].pinyin, 'nǚ péng you');
  });

  test('a Markdown table reply', () => {
    const text = [
      '| page | word | pinyin | meaning |',
      '|------|------|--------|---------|',
      '| 1 | 女朋友 | nǚ péng you | girlfriend |',
      '| 2 | 老师 | lǎo shī | teacher ? |',
    ].join('\n');
    const result = readText(text);
    assert.deepEqual(
      result.entries.map(e => [e.word, e.pinyin, e.meaning, e.unsure]),
      [
        ['女朋友', 'nǚ péng you', 'girlfriend', false],
        ['老师', 'lǎo shī', 'teacher', true],
      ],
    );
  });

  test('"?" flags', () => {
    const text = [
      '1 | 太 | tài | too ?',
      '1 | 对 | duì | right ？', // full-width question mark
      '1 | 想 ?', // no pinyin or meaning columns
      '1 | 家 | jiā | home | ?', // "?" in its own column
      '1 | 口 | kǒu | mouth??',
      '2 | 呢 | ne | how about...?', // part of the meaning, not a flag
      '2 | 和 | hé | and',
    ].join('\n');
    const result = readText(text);
    assert.deepEqual(
      result.entries.map(e => [e.word, e.unsure, e.meaning]),
      [
        ['太', true, 'too'],
        ['对', true, 'right'],
        ['想', true, ''],
        ['家', true, 'home'],
        ['口', false, 'mouth??'],
        ['呢', false, 'how about...?'],
        ['和', false, 'and'],
      ],
    );
  });

  test('a wrong total is reported as read', () => {
    const result = readText('1 | 女朋友\n1 | 哪\n# total: 5');
    assert.equal(result.total, 5);
    assert.equal(result.lines, 2);
  });

  test('no total line gives null; the last total line counts', () => {
    assert.equal(readText('1 | 女朋友').total, null);
    assert.equal(readText('1 | 女朋友\n# total: 1\n2 | 哪\n# Total 2').total, 2);
  });

  test('repeated words: counted, removed, and a "?" on any repeat is kept', () => {
    const result = readText('1 | 国 | guó | country\n4 | 国 | guó | country ?\n5 | 国 | guó');
    assert.deepEqual(words(result), ['国']);
    assert.equal(result.removed, 2);
    assert.equal(result.lines, 3);
    assert.equal(result.entries[0].unsure, true);
    assert.equal(result.entries[0].page, 1);
  });

  test('lines with no Chinese are skipped', () => {
    const result = readText('1 | 女朋友\n2 | ? | wèi | hello\n# total: 2');
    assert.deepEqual(words(result), ['女朋友']);
    assert.equal(result.lines, 1);
    assert.equal(result.total, 2);
  });

  test('two lessons in one reply', () => {
    const result = readText('# Bài 3\n1 | 女朋友\n# Bài 4\n6 | 有');
    assert.equal(result.name, 'Bài 3–4');
  });

  test('a reply with no "#" line uses the fallback name', () => {
    assert.equal(readReply('1 | 女朋友', 'worksheet').name, 'worksheet');
    assert.equal(readReply('1 | 女朋友').name, 'Untitled');
  });
});

describe('echoed format example', () => {
  const prompts = ['worksheet.txt', 'sentences.txt'].map(name => path.join(ROOT, 'prompts', name));

  test('each whole prompt pasted back is detected, and reads as exactly its example', () => {
    prompts.forEach((promptPath, i) => {
      const result = readText(fs.readFileSync(promptPath, 'utf8'));
      assert.equal(result.isReply, true);
      assert.equal(result.echoedExample, true);
      // No line of the rules is read as a word, and PROMPT_EXAMPLES matches the prompt.
      assert.deepEqual(result.entries.filter(e => e.depth === 0).map(e => e.word), PROMPT_EXAMPLES[i]);
    });
  });

  test('the example block alone is detected', () => {
    for (const promptPath of prompts) {
      const prompt = fs.readFileSync(promptPath, 'utf8');
      const block = prompt.slice(prompt.indexOf('FORMAT EXAMPLE'));
      const text = '```\n' + block.split('\n').slice(1).join('\n') + '```';
      assert.equal(readText(text).echoedExample, true, promptPath);
    }
  });

  test('the pinyin prompt pasted back is detected too', () => {
    const prompt = fs.readFileSync(path.join(ROOT, 'prompts', 'pinyin-meaning.txt'), 'utf8');
    assert.equal(readText(prompt).echoedExample, true);
    // ...but a fenced reply pasted together with the prompt is read normally.
    const both = prompt + '\n```\n女 | nǚ | woman\n```\n';
    assert.equal(readText(both).echoedExample, false);
    assert.deepEqual(words(readText(both)), ['女']);
  });

  test('a real reply is not flagged', () => {
    assert.equal(readText('1 | 女朋友\n1 | 他').echoedExample, false);
    assert.equal(readText('他 你好 老师').echoedExample, false); // plain text is never a reply
  });

  test('the example words are in neither sample', () => {
    const key = readFixture('sample_key.txt');
    for (const word of PROMPT_EXAMPLES.flat()) {
      for (const ch of word.replace(/[^\u4E00-\u9FFF]/g, '')) {
        assert.equal(key.includes(ch), false, ch);
        for (const sampleWord of ['女朋友', '哪', '国', '她', '喂', '姐姐', '工作', '还', '忙', '吗']) {
          assert.equal(sampleWord.includes(ch), false, ch);
        }
      }
    }
  });
});

describe('parts ("> " lines), sentences and the special "#" lines', () => {
  const show = result => result.entries.map(e =>
    `${'>'.repeat(e.depth)}${e.word}|${e.pinyin}${e.said ? '→' + e.said : ''}|${e.meaning}${e.unsure ? ' ?' : ''}`);

  test('a word with its characters: dictionary pinyin → pinyin as said, "?" flags', () => {
    const result = readText([
      '```', '# Bài 9',
      '1 | 你好 | nǐ hǎo | hello', '> 你 | nǐ → ní | you', '> 好 | hǎo | good',
      '1 | 不客气 | bù kèqi | you\'re welcome', '> 不 | bù -> bú | not', '> 客 | kè | guest ?', '> 气 | qì => qi',
      '2 | 他 | tā | he', '# total: 3', '```',
    ].join('\n'));
    assert.deepEqual(show(result), [
      '你好|nǐ hǎo|hello', '>你|nǐ→ní|you', '>好|hǎo|good',
      '不客气|bù kèqi|you\'re welcome', '>不|bù→bú|not', '>客|kè|guest ?', '>气|qì→qi|',
      '他|tā|he',
    ]);
    // "# total" counts the word lines only, and parts have no page.
    assert.equal(result.lines, 3);
    assert.equal(result.total, 3);
    assert.equal(result.entries[1].page, null);
  });

  test('a sentence keeps its punctuation, one box each; its chunks are parts', () => {
    const result = readText('2 | 你好！我叫李小雨。 | Nǐ hǎo! Wǒ jiào Lǐ Xiáoyǔ. | Hello! I am Li Xiaoyu.\n' +
      '> 你好 | nǐ hǎo → ní hǎo | hello\n> 我 | wǒ | I\n> 叫 | jiào | to be called\n> 李小雨 | Lǐ Xiǎoyǔ | Li Xiaoyu (name)');
    assert.deepEqual(result.entries.map(e => e.word), ['你好！我叫李小雨。', '你好', '我', '叫', '李小雨']);
    assert.equal(result.entries[0].pinyin, 'Nǐ hǎo! Wǒ jiào Lǐ Xiáoyǔ.');
    assert.equal(result.entries[1].said, 'ní hǎo');
  });

  test('"> " lines whose ">" got lost are recognised by their spelling', () => {
    const result = readText('1 | 朋友 | péngyou | friend\n朋 | péng | friend\n友 | yǒu → you | friend\n国 | guó | country');
    assert.deepEqual(show(result), ['朋友|péngyou|friend', '>朋|péng|friend', '>友|yǒu→you|friend', '国|guó|country']);
  });

  test('a repeated word is removed with its characters', () => {
    const result = readText('1 | 姐姐 | jiějie\n> 姐 | jiě\n> 姐 | jiě → jie\n2 | 姐姐 | jiějie\n> 姐 | jiě\n> 姐 | jiě → jie');
    assert.equal(result.entries.length, 3);
    assert.equal(result.removed, 1);
    assert.equal(result.lines, 2);
  });

  test('"# continue from page N" and "# nothing to copy" are not list names', () => {
    const part = readText('# Bài 3\n1 | 他 | tā\n# continue from page 2');
    assert.equal(part.continueFrom, 2);
    assert.equal(part.name, 'Bài 3');
    // Both parts pasted together, the last one ending with "# total": finished.
    const whole = readText('# Bài 3\n1 | 他 | tā\n# continue from page 2\n```\n# Bài 3\n2 | 老师 | lǎoshī\n# total: 2\n```');
    assert.equal(whole.continueFrom, null);
    assert.deepEqual(words(whole), ['他', '老师']);
    assert.equal(whole.total, whole.lines);
    const nothing = readText('```\n# nothing to copy: the pages are photos of a cat\n```');
    assert.equal(nothing.nothing, 'the pages are photos of a cat');
    assert.equal(nothing.name, 'Untitled');
  });

  test('saved lists keep parts, arrows and sentences', () => {
    const entries = readText('1 | 我买一本书。 | Wó mǎi yì běn shū. | I buy a book.\n> 我 | wǒ → wó | I\n> 一本书 | yì běn shū\n>> 一 | yī → yì\n2 | 你好！').entries;
    const text = toLessonText('Bài 2', entries);
    assert.equal(text, '# Bài 2\n我买一本书。 | Wó mǎi yì běn shū. | I buy a book.\n> 我 | wǒ → wó | I\n' +
      '> 一本书 | yì běn shū\n>> 一 | yī → yì\n你好！ |\n');
    assert.deepEqual(show(readText(text)), show({ entries }));
  });

  test('boxText and splitArrow', () => {
    assert.equal(boxText('你好! 我叫 李 小雨. 你呢?'), '你好！我叫李小雨。你呢？');
    assert.equal(boxText('，女朋友 (girlfriend)：'), '女朋友');
    assert.equal(boxText('他说……'), '他说……');
    assert.equal(boxText('hello'), '');
    assert.deepEqual(splitArrow('nǐ → ní'), { pinyin: 'nǐ', said: 'ní' });
    assert.deepEqual(splitArrow('nǐ'), { pinyin: 'nǐ', said: '' });
  });

  test('compareReplies keeps each word\'s parts with it', () => {
    const a = readText('1 | 你好 | nǐ hǎo\n> 你 | nǐ → ní\n> 好 | hǎo\n1 | 他 | tā').entries;
    const b = readText('1 | 你好 | nǐ hǎo\n> 你 | nǐ → ní\n> 好 | hǎo\n1 | 她 | tā\n2 | 老师 | lǎoshī\n> 老 | lǎo\n> 师 | shī').entries;
    const result = compareReplies(a, b);
    assert.deepEqual(result.map(e => `${'>'.repeat(e.depth)}${e.word}:${e.compare}`),
      ['你好:same', '>你:null', '>好:null', '他:differs', '老师:onlyB', '>老:null', '>师:null']);
  });
});

describe('countSyllables', () => {
  const cases = [
    ['nǚ péngyou', 3],
    ['jiějie', 2],
    ["Xī'ān", 2],
    ['Xī’ān', 2], // typographic apostrophe
    ['Zhōng-guó', 2],
    ['ni3 hao3', 2],
    ['ni3hao3', 2],
    ['nv3', 1],
    ['nü3 peng2you5', 3],
    ['lü4', 1],
    ['XUÉ SHENG', 2],
    ['xiǎng', 1],
    ['gōng zuò', 2],
    ['', 0],
  ];
  for (const [pinyin, count] of cases) {
    test(`"${pinyin}" = ${count}`, () => assert.equal(countSyllables(pinyin), count));
  }
  test('null and undefined give 0', () => {
    assert.equal(countSyllables(null), 0);
    assert.equal(countSyllables(undefined), 0);
  });
});

describe('compareReplies', () => {
  const list = text => readText(text).entries;

  test('two equal replies: all "same"', () => {
    const result = compareReplies(list('1 | 女朋友\n1 | 哪'), list('1 | 女朋友\n1 | 哪'));
    assert.deepEqual(result.map(e => [e.word, e.compare, e.other]), [
      ['女朋友', 'same', ''],
      ['哪', 'same', ''],
    ]);
  });

  test('different words, and words only one reply has', () => {
    const a = list('1 | 女朋友\n1 | 哪\n1 | 国\n2 | 太\n3 | 和');
    const b = list('1 | 女朋友\n1 | 那\n1 | 国\n2 | 喂\n2 | 太\n3 | 和\n3 | 口');
    const result = compareReplies(a, b);
    assert.deepEqual(result.map(e => [e.word, e.compare, e.other]), [
      ['女朋友', 'same', ''],
      ['哪', 'differs', '那'],
      ['国', 'same', ''],
      ['喂', 'onlyB', ''],
      ['太', 'same', ''],
      ['和', 'same', ''],
      ['口', 'onlyB', ''],
    ]);
  });

  test('a word only the first reply has', () => {
    const result = compareReplies(list('1 | 女朋友\n1 | 哪\n1 | 国'), list('1 | 女朋友\n1 | 国'));
    assert.deepEqual(result.map(e => [e.word, e.compare]), [
      ['女朋友', 'same'],
      ['哪', 'onlyA'],
      ['国', 'same'],
    ]);
  });

  test('a gap with more words in A than in B', () => {
    const result = compareReplies(list('1 | 女\n1 | 甲\n1 | 乙\n1 | 国'), list('1 | 女\n1 | 丙\n1 | 国'));
    assert.deepEqual(result.map(e => [e.word, e.compare, e.other]), [
      ['女', 'same', ''],
      ['甲', 'differs', '丙'],
      ['乙', 'onlyA', ''],
      ['国', 'same', ''],
    ]);
  });

  test('B-only entries keep their own pinyin, meaning and page; inputs are not changed', () => {
    const a = list('1 | 女朋友 | nǚ péngyou');
    const b = list('1 | 女朋友 | nǚ péngyou\n2 | 哪 | nǎ | which ?');
    const result = compareReplies(a, b);
    assert.deepEqual(result[1], {
      word: '哪',
      pinyin: 'nǎ',
      said: '',
      meaning: 'which',
      page: 2,
      unsure: true,
      compare: 'onlyB',
      other: '',
      depth: 0,
    });
    assert.equal(a[0].compare, null);
  });

  test('empty lists', () => {
    assert.deepEqual(compareReplies([], []), []);
    assert.deepEqual(compareReplies(list('1 | 女'), []).map(e => e.compare), ['onlyA']);
    assert.deepEqual(compareReplies([], list('1 | 女')).map(e => e.compare), ['onlyB']);
  });
});

describe('toLessonText', () => {
  const entries = [
    { word: '女朋友', pinyin: 'nǚ péngyou', meaning: 'girlfriend', page: 1, unsure: true, compare: null, other: '' },
    { word: '哪', pinyin: 'nǎ', meaning: '', page: null, unsure: false, compare: null, other: '' },
    { word: '国', pinyin: '', meaning: 'country', page: null, unsure: false, compare: null, other: '' },
    { word: '她', pinyin: '', meaning: '', page: null, unsure: false, compare: null, other: '' },
  ];

  test('writes the lesson format', () => {
    assert.equal(
      toLessonText('Bài 5', entries),
      '# Bài 5\n女朋友 | nǚ péngyou | girlfriend\n哪 | nǎ\n国 |  | country\n她\n',
    );
  });

  test('round trip through readText', () => {
    const result = readText(toLessonText('Bài 3–4', entries), 'ignored');
    assert.equal(result.name, 'Bài 3–4');
    assert.deepEqual(
      result.entries.map(e => [e.word, e.pinyin, e.meaning]),
      entries.map(e => [e.word, e.pinyin, e.meaning]),
    );
    assert.equal(result.removed, 0);
  });

  test('a "|" or a line break inside a column cannot break the format', () => {
    const tricky = [{ ...entries[0], meaning: 'girlfriend | lover\nsweetheart' }];
    const text = toLessonText('A\nB', tricky);
    assert.equal(text, '# A B\n女朋友 | nǚ péngyou | girlfriend / lover sweetheart\n');
    assert.equal(readText(text).entries[0].meaning, 'girlfriend / lover sweetheart');
  });

  test('an empty name becomes "Untitled"', () => {
    assert.equal(toLessonText('', []), '# Untitled\n');
  });
});

describe('safeFileName', () => {
  test('replaces characters Windows forbids', () => {
    assert.equal(safeFileName('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
    assert.equal(safeFileName('tab\there'), 'tab_here');
  });
  test('keeps Vietnamese, Chinese and the en dash', () => {
    assert.equal(safeFileName('Bài 3–4 我是中国人'), 'Bài 3–4 我是中国人');
  });
  test('no trailing dots or spaces, never empty, no device names', () => {
    assert.equal(safeFileName('lesson. . '), 'lesson');
    assert.equal(safeFileName(''), 'Untitled');
    assert.equal(safeFileName('...'), 'Untitled');
    assert.equal(safeFileName('CON'), '_CON');
    assert.equal(safeFileName('com1.txt'), '_com1.txt');
  });
  test('long names are shortened', () => {
    assert.equal(safeFileName('字'.repeat(300)).length, 100);
  });
});

describe('Liao Laoshi worksheet: the AI route (DoD 3)', () => {
  const keyPath = path.join(FIXTURES, 'sample_key.txt');
  const replyPath = path.join(FIXTURES, 'claude_reply.txt');
  const missing = !fs.existsSync(keyPath) || !fs.existsSync(replyPath);

  test('the words + characters answer for the sample reads into the right tree', { skip: missing && 'answer key missing' }, async () => {
    const { repeatFlags } = await import('../js/listedit.js');
    const key = readText(readFixture('sample_key.txt'));
    const reply = readText(readFixture('claude_reply_v2.txt'));
    const heads = reply.entries.filter(e => e.depth === 0);
    const parts = reply.entries.filter(e => e.depth === 1);
    assert.deepEqual(heads.map(e => e.word), words(key));
    assert.equal(reply.total, reply.lines);
    assert.equal(parts.length, 29);
    assert.equal(reply.echoedExample, false);
    // The neutral tones printed in the pinyin become arrows on the character lines.
    const arrows = parts.filter(e => e.said).map(e => `${e.word}:${e.pinyin}→${e.said}`);
    assert.deepEqual(arrows, ['友:yǒu→you', '姐:jiě→jie', '少:shǎo→shao', '哥:gē→ge', '爸:bà→ba', '妈:mā→ma', '妹:mèi→mei']);
    // Every character's lines spell its word, and the repeats (国 under 中国 after the word 国,
    // the second 姐 ...) are printed only once: 49 printed of 59.
    for (const head of heads) {
      const start = reply.entries.indexOf(head);
      const spelled = reply.entries.slice(start + 1).findIndex(e => e.depth === 0);
      const own = reply.entries.slice(start + 1, spelled === -1 ? undefined : start + 1 + spelled);
      if (own.length) assert.equal(own.map(e => e.word).join(''), head.word);
    }
    assert.equal(repeatFlags(reply.entries).filter(Boolean).length, 10);
  });

  test('the answer key reads as 30 words in two lessons', { skip: missing && 'answer key missing' }, () => {
    const key = readText(readFixture('sample_key.txt'));
    assert.equal(key.name, 'Bài 3–4');
    assert.equal(key.entries.length, 30);
    assert.equal(key.removed, 0);
    // Every pinyin in the key has one syllable per character.
    for (const entry of key.entries) {
      assert.equal(countSyllables(entry.pinyin), [...entry.word].length, entry.word);
    }
  });

  test("Claude's reply matches the answer key", { skip: missing && 'reply or key missing' }, () => {
    const key = readText(readFixture('sample_key.txt'));
    const reply = readText(readFixture('claude_reply.txt'));
    assert.equal(reply.isReply, true);
    assert.equal(reply.echoedExample, false);
    assert.equal(reply.name, 'Bài 3–4');
    assert.deepEqual(words(reply), words(key));
    assert.equal(reply.total, reply.lines);
    assert.equal(reply.removed, 0);
    const noSpaces = s => s.replace(/\s+/g, '').toLowerCase();
    assert.deepEqual(reply.entries.map(e => noSpaces(e.pinyin)), key.entries.map(e => noSpaces(e.pinyin)));
    // The pages: Bài 3 on pages 1-5, Bài 4 on pages 6-8, four boxes a page (two on page 5).
    assert.deepEqual(
      reply.entries.map(e => e.page),
      [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 6, 6, 6, 6, 7, 7, 7, 7, 8, 8, 8, 8],
    );
    const comparison = compareReplies(reply.entries, key.entries);
    assert.ok(comparison.every(e => e.compare === 'same'));
  });
});

// Found by the independent review of the parts change (each one was wrong before the fix).
describe('review of the parts change', () => {
  test('a " ?" at the end of a lesson line is the "not sure" flag, not part of the meaning', () => {
    const entry = readText('老师 | lǎoshī | teacher ?').entries[0];
    assert.deepEqual([entry.meaning, entry.unsure], ['teacher', true]);
  });

  test('a "?" put on the word is the "not sure" flag; a sentence keeps its own question mark', () => {
    const show = text => readText(text).entries.map(e => `${e.word}${e.unsure ? ' ?' : ''}`);
    assert.deepEqual(show('1 | 老师? | lǎoshī | teacher'), ['老师 ?']);
    assert.deepEqual(show('1 | 学生 ? | xuésheng | student'), ['学生 ?']);
    assert.deepEqual(show('2 | 你好吗？ | Nǐ hǎo ma? | How are you?'), ['你好吗？']);
    assert.deepEqual(show('1 | 你好 | nǐ hǎo\n> 你 ? | nǐ → ní'), ['你好', '你 ?']);
  });

  test('a reply is an echo only when it is the whole example', () => {
    assert.equal(readText('1 | 你好 | nǐ hǎo | hello').echoedExample, false);
    assert.equal(readText('1 | 你好！ | Nǐ hǎo! | Hello!\n2 | 你好！ | Nǐ hǎo! | Hello!').echoedExample, false);
    assert.equal(readText('2 | 老师 | lǎoshī | teacher').echoedExample, false);
  });

  test('lines of tildes in plain text are not code fences', () => {
    assert.deepEqual(words(readText('你好 谢谢\n~~~~~~~~\n再见 老师')), ['你好', '谢谢', '再见', '老师']);
  });

  test('a sentence keeps its opening quote and title mark', () => {
    assert.equal(boxText('“你好”是什么意思？'), '“你好”是什么意思？');
    assert.equal(boxText('《你好》很好。'), '《你好》很好。');
  });

  test('lesson lines without ">" are parts when they spell the word above, but a repeat is not', () => {
    const result = readText('一个 | yí ge | one\n一 | yī → yí | one\n个 | gè → ge\n一百 | yìbǎi | one hundred\n一 | yī → yì | one\n百 | bǎi');
    assert.deepEqual(result.entries.map(e => `${'>'.repeat(e.depth)}${e.word}`), ['一个', '>一', '>个', '一百', '>一', '>百']);
    assert.deepEqual(words(readText('国 | guó\n国 | guó\n中国 | Zhōngguó\n中国 | Zhōngguó')), ['国', '中国']);
  });
});
