# Hanzi Grid 田字格

Make Chinese handwriting practice sheets as PDF. Each word appears twice at the start of its
block: first in **KaiTi 楷体** (the handwriting shape you copy), then in the **print 黑体** shape you
see on screens and phones. Then come empty 田字格 boxes to write in.

It is a web app that installs like a normal app and then **works with no internet**.
Address: **https://johnbui765.github.io/CHINESE-HANDWRITING-PRACTICE-1/**

---

## 1. Install it (once)

You need the internet only for this step.

**Windows (Chrome or Edge)**
1. Open https://johnbui765.github.io/CHINESE-HANDWRITING-PRACTICE-1/
2. Click the **Install** icon at the right end of the address bar (a small screen with an arrow),
   or the menu ⋮ → **Install Hanzi Grid** (Edge: ⋯ → Apps → Install this site as an app).
3. Hanzi Grid now has its own window and a Start-menu entry.

**iPhone (Safari)**
1. Open https://johnbui765.github.io/CHINESE-HANDWRITING-PRACTICE-1/ in **Safari**.
2. Tap **Share** (square with an arrow) → **Add to Home Screen** → **Add**.
3. Open it once from the Home Screen while you are online, so it can save itself for offline use.

> On iPhone, the Home Screen app and Safari keep **separate** storage. Always use the Home
> Screen icon.

---

## 2. Make a sheet

### Tab 1 · Get words

Choose one way to bring in words:

- **Paste** any text and press **Read text**. Only Chinese words are kept; pinyin, Vietnamese,
  English and numbers are thrown away. A lesson list can carry pinyin and meaning like this:
  ```
  # Bài 5
  女朋友 | nǚ péngyou | girlfriend
  哪 | nǎ | which
  国
  ```
- **Open file…**: a `.txt`, a Word `.docx`, or a PDF that contains real text.
- **A worksheet that is only a picture** (a scanned PDF or a photo): the app cannot read
  pictures. Instead:
  1. Press **Copy AI prompt**.
  2. Open ChatGPT, Gemini or Claude, paste the prompt and attach the worksheet.
  3. Copy the AI's whole reply, paste it into Hanzi Grid and press **Read text**.
  4. Even better: ask a second AI too, and paste its reply into **Compare with a second AI's
     reply**. Words where the two disagree are marked.

**Check every word.** You don't need to know Chinese for this: compare the **shapes**.

- **Orange** = check this word: the AI was not sure, the two AIs disagree, the pinyin does not fit
  the number of characters, or a character is unusual (not among the 3,500 common characters).
- **Red** = must be fixed before printing: a character the app's fonts don't have (often a
  traditional character such as 國), or a word longer than one row.
- **Edit**, **↑ ↓**, **Merge ↓** (join with the next word) and **Delete** fix the list. Add a missing
  word in the box under the list.
- **Rows**: how many empty rows each word gets: **1**, **3**, **6**, **Page** (a whole page) or any
  number.
- **Save list** saves the list as a `.txt` file (on iPhone: Save to Files). Open it again later
  with **Open file…**. The app also remembers the current list by itself, but files are safer.

### Tab 2 · Make sheet

1. Choose the box size:
   - **Small boxes**: 10 mm, 18 per row, 26 rows per page, no pinyin.
   - **Large boxes**: 15 mm, 12 per row, a line above each word with its pinyin and meaning.
2. Press **Make PDF**, wait for "Done", then press **Save PDF**.
   - Windows: the PDF goes to your **Downloads** folder.
   - iPhone: the Share sheet opens: **Save to Files**, **Print**, or AirDrop.

The sheets are made for black-and-white printing on A4.

---

## 3. Updates

When a new version is published, it is used the **next time you open the app after closing all
its windows** (on iPhone: swipe the app away, then open it again).

---

## 4. Check list for the iPhone (do this once after installing)

- [ ] Home Screen icon opens the app.
- [ ] Turn on **Airplane Mode**, open the app: it still works.
- [ ] **Copy AI prompt**, paste it into Notes: the prompt is there.
- [ ] Paste an AI reply, press **Read text**: the words appear.
- [ ] **Open file…** → pick a `.docx` and a PDF that has real text from the Files app: the words
      appear.
- [ ] Make a sheet with **small** and with **large** boxes; **Save PDF** → **Save to Files**, and
      **Save PDF** → **Print**.

---

## 5. Publish it on GitHub Pages (for the owner of the repository)

1. The app lives in the **public** repository `JohnBui765/CHINESE-HANDWRITING-PRACTICE-1`.
2. Put the project files in it (everything from the zip). Never add the `samples/` folder.
   - Easiest: **GitHub Desktop** → **Clone** `CHINESE-HANDWRITING-PRACTICE-1` → copy everything
     from the zip's `CHINESE-HANDWRITING-PRACTICE-1` folder into the cloned folder →
     **Commit to main** → **Push origin**.
   - Or in the browser: **Add file → Upload files**. The website accepts at most 100 files per
     upload, so upload `vendor/pdfjs/cmaps/` (169 small files) in two parts, and the rest in a
     separate upload.
3. **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main /
   (root) → Save.**
4. After a minute or two the app is at https://johnbui765.github.io/CHINESE-HANDWRITING-PRACTICE-1/

The app's identity on your devices is `/CHINESE-HANDWRITING-PRACTICE-1/` (its manifest `id`), and its
offline copies and saved settings are named after the repository too. If the repository is ever
renamed, devices treat it as a different app. Always open the address with the capital letters
exactly as above.

---

## 6. Where things come from (sources and licences)

- **KaiTi font:** AR PL UKai CN, © Arphic Technology, Arphic Public License. A cut-down copy is
  used; see `fonts/README.txt` and `fonts/LICENSE-ukai.txt`.
- **Print font:** Noto Sans SC (Regular), © Adobe, SIL Open Font License 1.1. A cut-down copy is
  used; see `fonts/README.txt` and `fonts/OFL-notosanssc.txt`. (Microsoft YaHei, the Windows
  font, may not be shipped inside a web app; Noto Sans SC is the same 黑体 style.)
- **Common characters:** 通用规范汉字表 (Table of General Standard Chinese Characters, State Council
  of China, 2013). Level 1 = `data/common3500.txt` (3,500), all levels = `data/common8105.txt`
  (8,105). Taken from
  [shengdoushi/common-standard-chinese-characters-table](https://github.com/shengdoushi/common-standard-chinese-characters-table)
  (`level-1.txt`, `level-2.txt`, `level-3.txt`) and checked against a second, independent copy:
  the npm package [togscc](https://www.npmjs.com/package/togscc) 1.3.1
  ([jaywcjlove/table-of-general-standard-chinese-characters](https://github.com/jaywcjlove/table-of-general-standard-chinese-characters)).
  Both give the same 8,105 characters in the same order; the counts are exactly
  3,500 / 3,000 / 1,605.
- **Libraries** (in `vendor/`, versions in `vendor/VERSIONS.txt`): @cantoo/pdf-lib and
  @cantoo/fontkit (MIT), JSZip (MIT), pdf.js (Apache-2.0).

---

## 7. For developers

Everything below is only for changing the app. The app itself needs no installation.

```
npm install                       # Playwright for the browser tests (dev only)
pip install -r tools/requirements-dev.txt
npm test                          # unit tests + browser tests (Chromium)
node tests/browser/server.js      # serve the app at http://localhost:8000/CHINESE-HANDWRITING-PRACTICE-1/
```

- `HANZI_PYTHON=/path/to/python npm test` chooses the Python used to check PDFs (PyMuPDF).
- Before publishing a new version: `python tools/make_precache.py` (updates the offline file list
  and version in `sw.js`).
- Re-make the fonts: `python tools/make_fonts.py`. Re-draw the icons: `python tools/make_icons.py`.
- Check a PDF: `python tools/check_pdf.py sheet.pdf`.
- `CLAUDE.md` is the full specification.
