import re, subprocess, sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, black
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

UKAI, B34 = sys.argv[1], sys.argv[2]
pdfmetrics.registerFont(TTFont('Kai', UKAI, subfontIndex=0))
pdfmetrics.registerFont(TTFont('Hei', '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', subfontIndex=0))

# Bài 1-3 words (in order) + Bài 3-4 words pulled from the earlier practice PDF's Part 1
b13 = '你好大家好学生们老师您你们谢谢不客气同学再见请问你叫什么名字我不是对不起没关系没事很高兴认识也人的这谁'
txt = subprocess.run(['pdftotext', '-layout', B34, '-'], capture_output=True, text=True).stdout
part1 = txt.split('PART 2')[0]
b34 = ''.join(re.findall(r'[一-鿿]', part1))
chars = list(dict.fromkeys(b13 + b34))
print(len(chars), ''.join(chars))

W, H = A4
BOX, COLS, ROWS = 10*mm, 18, 26
X0 = (W - COLS*BOX) / 2
Y_TOP = H - 20*mm
LINE, DASH, SEP = HexColor('#9a9a9a'), HexColor('#c4c4c4'), HexColor('#555555')
FS = 0.8*BOX

c = canvas.Canvas('HSK1_Bai1-4_kai_vs_print_grid.pdf', pagesize=A4)
c.setTitle('HSK1 Bài 1-4: KaiTi vs print grid')
pages = [chars[i:i+ROWS] for i in range(0, len(chars), ROWS)]
for p, chunk in enumerate(pages, 1):
    c.setFont('Hei', 8.5); c.setFillColor(HexColor('#666666'))
    c.drawString(X0, H - 13*mm, 'Box 1: KaiTi 楷体 (handwriting)   Box 2: print 黑体 (screen / phone)   Then copy the KaiTi form in the blank boxes.')
    c.drawRightString(X0 + COLS*BOX, H - 13*mm, f'{p}/{len(pages)}')
    for r in range(ROWS):
        y = Y_TOP - (r+1)*BOX
        # dashed centre cross in every cell
        c.setStrokeColor(DASH); c.setLineWidth(0.35); c.setDash(1.5, 1.5)
        c.line(X0, y + BOX/2, X0 + COLS*BOX, y + BOX/2)
        for k in range(COLS):
            x = X0 + k*BOX + BOX/2
            c.line(x, y, x, y + BOX)
        c.setDash()
        if r < len(chunk):
            ch = chunk[r]
            c.setFillColor(black)
            for k, f in ((0, 'Kai'), (1, 'Hei')):
                c.setFont(f, FS)
                c.drawCentredString(X0 + k*BOX + BOX/2, y + BOX/2 - 0.36*FS, ch)
    # solid cell grid
    c.setStrokeColor(LINE); c.setLineWidth(0.5)
    for r in range(ROWS + 1):
        c.line(X0, Y_TOP - r*BOX, X0 + COLS*BOX, Y_TOP - r*BOX)
    for k in range(COLS + 1):
        c.line(X0 + k*BOX, Y_TOP, X0 + k*BOX, Y_TOP - ROWS*BOX)
    # darker divider between model boxes and practice boxes
    c.setStrokeColor(SEP); c.setLineWidth(1.1)
    c.line(X0 + 2*BOX, Y_TOP, X0 + 2*BOX, Y_TOP - ROWS*BOX)
    c.showPage()
c.save()
print('pages', len(pages))
