"""Render the README demo GIF from real undomap output (ANSI captured from the CLI, truecolor).
usage: python3 scripts/make_gif.py out.gif cmd1.ansi "cmd1 text" [cmd2.ansi "cmd2 text"] ...
Each command starts on a cleared screen, like a real `clear && cmd` session."""
import re, sys
from PIL import Image, ImageDraw, ImageFont

FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 15)
BOLD = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 15)
INK, BASE = (20, 35, 46), (207, 220, 227)          # site --ink / --base
DIM = (122, 142, 153)
C256 = {"166": (224, 112, 26), "178": (201, 164, 58), "36": (42, 157, 149), "137": (176, 122, 80)}
CW, LH, PAD, COLS, ROWS, BAR = 9, 21, 20, 118, 33, 30
W, H = PAD * 2 + CW * COLS, PAD * 2 + LH * ROWS + BAR

def parse(line):
    segs, color, bold, dim = [], BASE, False, False
    for part in re.split(r"(\x1b\[[0-9;]*m)", line):
        m = re.fullmatch(r"\x1b\[([0-9;]*)m", part)
        if m:
            code = m.group(1)
            if code in ("0", ""): color, bold, dim = BASE, False, False
            elif code == "1": bold = True
            elif code == "2": dim = True
            elif code.startswith("38;2;"): color = tuple(int(x) for x in code.split(";")[2:5])
            elif code.startswith("38;5;"): color = C256.get(code[5:], BASE)
        elif part:
            segs.append((part, DIM if dim and color == BASE else color, bold))
    return segs

def frame(lines):
    im = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, BAR], fill=BASE)
    # a benchmark triangle instead of traffic lights: this is a survey instrument, not a Mac window
    d.polygon([(16, 22), (25, 7), (34, 22)], outline=INK, width=2)
    d.ellipse([22, 14, 28, 20], fill=(139, 94, 60))
    d.text((44, 7), "undomap · survey of ~/dev/textures-app", font=FONT, fill=INK)
    d.text((W - 18 - 9 * 16, 7), "ZONE VE · AE · X", font=FONT, fill=(162, 71, 10))
    for r, segs in enumerate(lines[-ROWS:]):
        x = PAD
        for text, color, bold in segs:
            d.text((x, BAR + PAD + r * LH), text, font=BOLD if bold else FONT, fill=color)
            x += CW * len(text)
    return im

args = sys.argv[1:]
out, pairs = args[0], list(zip(args[1::2], args[2::2]))
frames, durs = [], []
for ansi, cmd in pairs:
    screen = []
    body = open(ansi, encoding="utf8").read().rstrip("\n").split("\n")
    prompt = [("~/dev/textures-app ", DIM, False), ("$ ", (224, 112, 26), True)]
    for k in range(0, len(cmd) + 1, 2):
        frames.append(frame(screen + [prompt + [(cmd[:k], BASE, False)]])); durs.append(55)
    screen = [prompt + [(cmd, BASE, False)]]
    frames.append(frame(screen)); durs.append(500)
    for i, ln in enumerate(body):
        screen = screen + [parse(ln)]
        frames.append(frame(screen)); durs.append(55 if i > 3 else 140)
    durs[-1] = 5200
    if len(sys.argv) and __import__("os").environ.get("SHOTS"): frames[-1].save(f"/tmp/gif-hold-{len(frames)}.png")
frames[0].save(out, save_all=True, append_images=frames[1:], duration=durs, loop=0, optimize=True)
print(out, len(frames), "frames", W, "x", H)
