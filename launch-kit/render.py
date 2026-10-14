"""Renders the Stockpool logo, X header and link preview image. Run: python3 launch-kit/render.py"""
from playwright.sync_api import sync_playwright
import os, pathlib, base64, shutil

here = pathlib.Path(__file__).parent.resolve()
FONT = base64.b64encode((here / "FamiljenGrotesk.woff2").read_bytes()).decode()
PAPER, SURFACE, INK, TEAL, BAND, BRASS, TRACK = "#e8eeea", "#f5f8f6", "#0f2b29", "#1c6b64", "#9ccbc1", "#b5832b", "#d8e3de"


def mark(bg=PAPER):
    return f'''<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><clipPath id="c"><rect x="3" y="3" width="26" height="26" rx="9"/></clipPath><rect width="32" height="32" rx="9" fill="{bg}"/><path d="M2 17.5c3.4-1.7 6.8-1.7 10.2 0s6.8 1.7 10.2 0 6.8-1.7 10.2 0V32H2z" fill="{TEAL}" clip-path="url(#c)"/><rect x="3" y="3" width="26" height="26" rx="9" fill="none" stroke="{INK}" stroke-width="2.2"/><path d="M8 11.5h16" stroke="{BRASS}" stroke-width="2.2" stroke-linecap="round"/></svg>'''


base = f'''<style>@font-face{{font-family:G;src:url(data:font/woff2;base64,{FONT}) format("woff2");font-weight:400 700}}
html,body{{margin:0;background:{PAPER}}} *{{box-sizing:border-box}}
.g{{font-family:G}}</style>'''

BOOST = "#c0661f"
# Each row: ticker and Shield's share of the pool (percent). Shapes only, no live numbers.
ROWS = [("NVDA", 72), ("TSLA", 64), ("AAPL", 75), ("META", 68), ("GOOGL", 74), ("MSFT", 70), ("SPY", 75)]


def strips(rows, w, h, gap, label):
    out = []
    for t, shield in rows:
        out.append(f'''<div style="display:flex;align-items:center;gap:18px">
<div class="g" style="width:{label}px;font-weight:650;font-size:{int(h * 0.62)}px;color:{INK}">{t}</div>
<div style="display:flex;gap:4px;width:{w}px;height:{h}px">
<div style="width:{shield}%;border-radius:{h // 4}px;background:{TEAL}"></div>
<div style="flex:1;border-radius:{h // 4}px;background:{BOOST}"></div></div></div>''')
    legend = f'''<div class="g" style="display:flex;gap:22px;font-size:{int(h * 0.55)}px;color:{INK};margin-top:6px;padding-left:{label + 18}px">
<span><span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:{TEAL};margin-right:8px"></span>Shield</span>
<span><span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:{BOOST};margin-right:8px"></span>Boost</span></div>'''
    return f'<div style="display:grid;gap:{gap}px">{"".join(out)}{legend}</div>'


logo = base + f'<div style="width:1000px;height:1000px;display:grid;place-items:center;background:{PAPER}"><div style="width:640px;height:640px">{mark()}</div></div>'

header = base + f'''<div class="g" style="width:1500px;height:500px;position:relative;overflow:hidden;color:{INK};background:{PAPER}">
<div style="position:absolute;left:440px;top:150px;width:470px">
<div style="font-size:88px;font-weight:650;line-height:1;letter-spacing:-2px">Stockpool</div>
<div style="font-size:29px;color:#3b5754;margin-top:20px;line-height:1.3">Pool a stock for a week.<br><span style="color:{TEAL}">Shield</span> it or <span style="color:{BOOST}">Boost</span> it.</div></div>
<div style="position:absolute;right:90px;top:72px;padding:26px 30px;background:{SURFACE};border:1px solid #cdd9d4;border-radius:22px">{strips(ROWS, 330, 28, 12, 92)}</div></div>'''

og = base + f'''<div class="g" style="width:1200px;height:630px;position:relative;overflow:hidden;color:{INK};background:{PAPER}">
<div style="position:absolute;left:72px;top:64px;display:flex;align-items:center;gap:16px"><div style="width:56px;height:56px">{mark()}</div><div style="font-size:40px;font-weight:650;letter-spacing:-0.5px">Stockpool</div></div>
<div style="position:absolute;left:72px;top:190px;width:560px;font-size:84px;font-weight:650;line-height:0.98;letter-spacing:-2.5px"><span style="color:{TEAL}">Shield</span> it or <span style="color:{BOOST}">Boost</span> it.</div>
<div style="position:absolute;left:72px;bottom:64px;width:520px;font-size:25px;line-height:1.35;color:#3b5754">Weekly rounds on Robinhood Stock Tokens. Shield keeps its dollars plus a coupon; Boost takes the upside.</div>
<div style="position:absolute;right:64px;top:92px;padding:26px 28px;background:{SURFACE};border:1px solid #cdd9d4;border-radius:22px">{strips(ROWS, 300, 34, 16, 88)}</div></div>'''

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None)  # CHROMIUM_PATH: optional browser to use
    for name, html, w, h in [("stockpool-logo.png", logo, 1000, 1000), ("stockpool-x-header.png", header, 1500, 500), ("og.png", og, 1200, 630)]:
        pg = b.new_page(viewport={"width": w, "height": h})
        pg.set_content(html)
        pg.wait_for_timeout(500)
        pg.screenshot(path=str(here / name))
    b.close()

shutil.copy(here / "og.png", here.parent / "app" / "public" / "og.png")
