"""Draw the app icons (dev only): a 田字格 box with 字 in KaiTi.

    python tools/make_icons.py

Needs Pillow (see tools/requirements-dev.txt).
"""

import pathlib

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
BACKGROUND = (246, 243, 238)
RED = (140, 42, 28)
FONT = ROOT / "fonts" / "ukai-cn.ttf"


def icon(size, safe=1.0):
    """safe < 1 keeps the drawing inside the middle part (for "maskable" icons)."""
    image = Image.new("RGB", (size, size), BACKGROUND)
    draw = ImageDraw.Draw(image)
    box = size * 0.78 * safe
    left = (size - box) / 2
    top = (size - box) / 2
    line = max(2, round(size / 64))
    draw.rectangle([left, top, left + box, top + box], outline=RED, width=line)
    # dashed centre cross
    dash = box / 16
    for i in range(16):
        if i % 2 == 0:
            x = left + i * dash
            draw.line([x, top + box / 2, x + dash, top + box / 2], fill=RED, width=max(1, line // 2))
            y = top + i * dash
            draw.line([left + box / 2, y, left + box / 2, y + dash], fill=RED, width=max(1, line // 2))
    font = ImageFont.truetype(str(FONT), round(box * 0.8))
    draw.text((size / 2, size / 2), "字", font=font, fill=(20, 20, 20), anchor="mm")
    return image


def main():
    out = ROOT / "icons"
    out.mkdir(exist_ok=True)
    icon(192).save(out / "icon-192.png")
    icon(512).save(out / "icon-512.png")
    icon(512, safe=0.75).save(out / "icon-maskable-512.png")
    icon(180).save(out / "apple-touch-icon.png")
    print("icons written to", out)


if __name__ == "__main__":
    main()
