"""Make the two small fonts the app uses (dev only; the owner never runs this).

    python tools/make_fonts.py

Needs fontTools (see tools/requirements-dev.txt). It reads the full fonts in fonts/source/
and writes:

  fonts/ukai-cn.ttf        KaiTi: AR PL UKai CN, cut down to the characters of 通用规范汉字表
                           and the sentence punctuation that gets its own box
  fonts/noto-sans-sc.ttf   print: Noto Sans SC Regular, cut down the same way, plus the Latin
                           letters, pinyin tone letters and punctuation the labels need
  data/font-chars.txt      every Chinese character that BOTH fonts have (the check screen
                           uses it to show the red "not in the app's fonts" error)

Why cut the fonts down: the full fonts are 17 MB each. The cut-down ones are a few MB, so the
app downloads quickly and fits in the offline cache.
"""

import datetime
import pathlib

from fontTools import subset
from fontTools.ttLib import TTCollection, TTFont
from fontTools.varLib import instancer

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "fonts" / "source"
TODAY = datetime.date.today().isoformat()

# Characters of 通用规范汉字表 (all three levels, 8,105). The app only reads characters in
# U+4E00-9FFF and U+3400-4DBF, so the 196 characters outside those ranges are left out.
def app_range(ch):
    return 0x4E00 <= ord(ch) <= 0x9FFF or 0x3400 <= ord(ch) <= 0x4DBF

LIST = [line.strip() for line in (ROOT / "data" / "common8105.txt").read_text("utf-8").splitlines()]
HANZI = [ch for ch in LIST if ch and app_range(ch)]

# Extra characters for the print font: the header and label text (English, pinyin, punctuation).
EXTRA_RANGES = [
    (0x0020, 0x007E),  # ASCII
    (0x00A0, 0x024F),  # Latin-1 and Latin Extended-A/B: all pinyin tone letters (ā á ǎ à ǖ ǘ ǚ ǜ ...)
    (0x0300, 0x036F),  # combining marks (pinyin typed with separate tone marks)
    (0x2010, 0x2027),  # dashes, quotes, ellipsis
    (0x3000, 0x303F),  # Chinese punctuation
    (0xFF01, 0xFF5E),  # full-width punctuation and letters
    (0x2192, 0x2192),  # the arrow of "nǐ → ní" (pinyin as said)
]
EXTRA = [chr(cp) for start, end in EXTRA_RANGES for cp in range(start, end + 1)]
# The header text names the two fonts in Chinese.
HEADER_HANZI = list("楷体黑体")

# Sentence punctuation: a sentence is written with it, one box each, in both fonts.
# The same marks as PUNCTUATION in js/extract.js (a test checks that both fonts have them).
PUNCTUATION = list("。，、！？：；“”‘’《》…—")


def cut_down(font, characters, notice):
    """Keep only `characters` in `font`, and write `notice` into the font's description."""
    options = subset.Options()
    options.name_IDs = ["*"]          # keep all names (the licence asks us to keep the copyright)
    options.name_languages = ["*"]
    options.hinting = False           # hinting only matters for small text on old screens
    options.notdef_outline = True
    options.layout_features = ["*"]
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=[ord(ch) for ch in characters])
    subsetter.subset(font)
    # nameID 10 = "Description". The Arphic licence asks for a notice saying how and when the
    # font was changed; we use the same notice for both fonts.
    # Windows-platform name record only: the old Mac record cannot hold Chinese characters.
    font["name"].setName(notice, 10, 3, 1, 0x409)
    return font


def has_chars(font):
    return set(chr(cp) for cp in font.getBestCmap())


def main():
    # KaiTi: face 0 of the collection is "AR PL UKai CN".
    kai = TTCollection(str(SOURCE / "ukai.ttc")).fonts[0]
    kai_has = has_chars(kai)
    kai_notice = (
        f"Modified version of AR PL UKai CN for Hanzi Grid: reduced on {TODAY} with fontTools "
        "pyftsubset to the characters of 通用规范汉字表 (2013) that the font contains, and "
        "Chinese punctuation. Licensed under the Arphic Public License (see LICENSE-ukai.txt)."
    )
    cut_down(kai, [ch for ch in HANZI + PUNCTUATION if ch in kai_has], kai_notice)
    kai.save(str(ROOT / "fonts" / "ukai-cn.ttf"))

    # Print: Noto Sans SC is a variable font whose default weight is Thin (100); make the
    # Regular (400) weight first.
    noto = TTFont(str(SOURCE / "NotoSansSC[wght].ttf"))
    noto = instancer.instantiateVariableFont(noto, {"wght": 400}, updateFontNames=True)
    noto_has = has_chars(noto)
    noto_notice = (
        f"Modified version of Noto Sans SC for Hanzi Grid: Regular weight, reduced on {TODAY} "
        "with fontTools to the characters of 通用规范汉字表 (2013) plus Latin, pinyin and "
        "punctuation. Licensed under the SIL Open Font License 1.1 (see OFL-notosanssc.txt)."
    )
    wanted = [ch for ch in HANZI + HEADER_HANZI + EXTRA + PUNCTUATION if ch in noto_has]
    cut_down(noto, wanted, noto_notice)
    noto.save(str(ROOT / "fonts" / "noto-sans-sc.ttf"))

    both = [ch for ch in HANZI if ch in kai_has and ch in noto_has]
    (ROOT / "data" / "font-chars.txt").write_text("\n".join(both) + "\n", "utf-8")

    for name, has in (("UKai CN", kai_has), ("Noto Sans SC", noto_has)):
        missing = [ch for ch in HANZI if ch not in has]
        print(f"{name}: lacks {len(missing)} of {len(HANZI)} characters", "".join(missing[:40]))
    print(f"data/font-chars.txt: {len(both)} characters in both fonts")
    lacking = [ch for ch in PUNCTUATION if ch not in kai_has or ch not in noto_has]
    print("punctuation missing in a font:", "".join(lacking) or "none")
    for path in ("fonts/ukai-cn.ttf", "fonts/noto-sans-sc.ttf"):
        size = (ROOT / path).stat().st_size
        print(f"{path}: {size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
