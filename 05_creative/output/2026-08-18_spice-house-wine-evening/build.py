#!/usr/bin/env python3
"""Build the Spice House "Evening of Wine" partnership proposal (EN + TH).
Self-contained HTML: brand monogram + Bebas/Inter fonts embedded as base64.
Thai copy is a working translation — needs a native proofread before sending.
"""
import base64, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[3]
BRAND = ROOT / "04_brand"
OUT = pathlib.Path(__file__).resolve().parent
DATE = "2026-08-18"


def b64(path):
    return base64.b64encode(path.read_bytes()).decode()


logo = b64(BRAND / "logo" / "channel_avatar_light.png")   # dark monogram, for light bg
bebas = b64(BRAND / "logo" / "fonts" / "BebasNeue.woff2")
inter = b64(BRAND / "logo" / "fonts" / "Inter500.woff2")
img_seated = b64(OUT / "seated.png")
img_freeflow = b64(OUT / "freeflow.png")
img_nosekit = b64(OUT / "nosekit.png")

CSS = f"""
@page {{ size: 210mm 297mm; margin: 0; }}
@font-face {{ font-family:'Bebas Neue'; src:url(data:font/woff2;base64,{bebas}) format('woff2'); font-weight:400; font-display:swap; }}
@font-face {{ font-family:'Inter'; src:url(data:font/woff2;base64,{inter}) format('woff2'); font-weight:500; font-display:swap; }}

:root {{
  --wine:#8C1C1C; --burg:#5C1010; --black:#1A1A1A; --white:#F5F0EB;
  --cream:#EDE0D0; --gold:#C9A84C; --graphite:#3D3D3D; --stone:#D4C9BC;
}}
* {{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }}
html,body {{ margin:0; padding:0; }}
body {{ font-family:'Inter',system-ui,sans-serif; color:var(--black); background:var(--stone); font-weight:500; }}

.page {{
  width:210mm; height:297mm; margin:0 auto; background:var(--white);
  position:relative; overflow:hidden; page-break-after:always;
  padding:15mm 18mm 12mm;
}}
.page:last-child {{ page-break-after:auto; }}

h1,h2,h3,.bebas {{ font-family:'Bebas Neue',sans-serif; font-weight:400; letter-spacing:.02em; margin:0; }}
.th {{ font-family:'Inter','Noto Sans Thai','Thonburi','Sarabun',sans-serif; color:var(--graphite); }}

/* ---------- COVER ---------- */
.cover {{ display:flex; flex-direction:column; justify-content:center; align-items:center;
  text-align:center; background:linear-gradient(160deg,#fbf8f4 0%,var(--white) 45%,var(--cream) 100%); }}
.cover .mono {{ width:120px; height:120px; margin-bottom:34px; }}
.cover .kicker {{ font-family:'Inter'; letter-spacing:.34em; text-transform:uppercase;
  font-size:11px; color:var(--wine); margin-bottom:20px; }}
.cover h1 {{ font-size:82px; line-height:.92; color:var(--black); }}
.cover .at {{ font-family:'Bebas Neue'; font-size:44px; color:var(--wine); margin-top:2px; letter-spacing:.03em; }}
.cover .th-title {{ font-size:22px; margin-top:16px; color:var(--graphite); letter-spacing:.02em; }}
.cover .rule {{ width:56px; height:2px; background:var(--gold); margin:44px auto 30px; }}
.cover .date {{ font-family:'Bebas Neue'; font-size:28px; color:var(--wine); letter-spacing:.05em; line-height:1.1; }}
.cover .date .th {{ display:block; font-family:'Inter'; font-size:14px; color:var(--graphite);
  letter-spacing:.02em; margin-top:8px; }}

/* ---------- HEADERS ---------- */
.eyebrow {{ font-family:'Inter'; letter-spacing:.28em; text-transform:uppercase;
  font-size:10.5px; color:var(--wine); margin-bottom:10px; }}
.optnum {{ display:inline-block; font-family:'Bebas Neue'; font-size:15px; color:#fff;
  background:var(--wine); padding:2px 12px; border-radius:2px; letter-spacing:.08em;
  vertical-align:middle; margin-right:12px; }}
.sec-title {{ font-size:52px; line-height:.95; color:var(--black); }}
.sec-th {{ font-size:18px; color:var(--graphite); margin-top:4px; }}
.sec-head {{ border-bottom:1px solid var(--stone); padding-bottom:13px; margin-bottom:18px; }}

/* big option label (Option 1 / Option 2 / Add-on) */
.opt-head {{ margin-bottom:16px; }}
.opt-tag {{ display:inline-block; font-family:'Bebas Neue'; font-size:23px; letter-spacing:.14em;
  color:#fff; background:var(--wine); padding:3px 18px; border-radius:3px; }}
.opt-title {{ font-family:'Bebas Neue'; font-weight:400; font-size:58px; line-height:.92;
  color:var(--black); margin:14px 0 0; }}
.opt-th {{ font-size:17px; color:var(--graphite); margin-top:3px; }}

/* scene photo banner */
.scene {{ margin:18px 0; border:1px solid var(--stone); border-radius:10px;
  overflow:hidden; background:var(--white); }}
.scene img {{ width:100%; height:44mm; object-fit:cover; display:block; }}
.scene-cap {{ text-align:center; font-family:'Inter'; font-size:11.5px; color:var(--graphite);
  padding:9px 10px; letter-spacing:.02em; }}

/* nose game — steps + prize strip */
.nsteps {{ display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-top:16px; }}
.nstep {{ border:1px solid var(--stone); border-radius:10px; padding:16px 14px 14px;
  text-align:center; background:#fff; position:relative; }}
.nstep .n {{ font-family:'Bebas Neue'; font-size:15px; color:#fff; background:var(--wine);
  width:26px; height:26px; border-radius:50%; display:flex; align-items:center;
  justify-content:center; margin:0 auto; }}
.nstep .ico {{ font-size:28px; line-height:1; margin:10px 0 6px; }}
.nstep h4 {{ font-family:'Inter'; font-weight:700; font-size:13.5px; color:var(--black); margin:0; }}
.nstep .th {{ font-size:11.5px; margin-top:4px; }}
.nstep .pts {{ font-family:'Bebas Neue'; color:var(--gold); font-size:15px; letter-spacing:.05em; }}
.nkids-wrap {{ text-align:center; margin-top:14px; }}
.nkids {{ display:inline-block; font-family:'Inter'; font-size:12.5px; font-weight:700;
  color:var(--burg); background:var(--cream); padding:8px 20px; border-radius:20px; }}
.nkids .th {{ font-weight:500; color:var(--graphite); }}
.prize-strip {{ margin-top:14px; background:linear-gradient(150deg,var(--burg),var(--wine));
  color:#fff; border-radius:12px; padding:18px 26px; display:grid;
  grid-template-columns:auto 1fr; gap:24px; align-items:center; }}
.prize-strip .cup {{ font-size:44px; line-height:1; text-align:center; }}
.prize-strip .pk {{ font-family:'Inter'; letter-spacing:.22em; text-transform:uppercase;
  font-size:9.5px; opacity:.8; }}
.prize-strip h3 {{ font-family:'Bebas Neue'; font-size:30px; color:#fff; line-height:1; margin:3px 0 0; }}
.prize-strip p {{ font-family:'Inter'; font-size:12.5px; margin:8px 0 0; opacity:.94; line-height:1.5; }}
.prize-strip p .th {{ display:block; color:var(--cream); font-size:11.5px; margin-top:4px; }}
.aromas {{ margin-top:14px; }}
.aromas .lbl {{ text-align:center; font-family:'Inter'; font-size:10.5px; font-weight:700;
  letter-spacing:.14em; text-transform:uppercase; color:var(--wine); margin-bottom:10px; }}
.chips {{ display:flex; flex-wrap:wrap; justify-content:center; gap:7px; }}
.chip {{ font-family:'Inter'; font-size:12px; color:var(--black); background:#fff;
  border:1px solid var(--stone); border-radius:20px; padding:5px 11px; white-space:nowrap; }}
.chip .e {{ margin-right:5px; }}

.intro {{ font-family:'Inter'; font-size:16px; line-height:1.55; color:var(--black);
  margin:0 0 24px; padding-left:16px; border-left:3px solid var(--gold); }}
.intro b {{ color:var(--wine); }}
.intro .th {{ display:block; font-size:13px; color:var(--graphite); margin-top:6px; font-weight:500; }}
.lead {{ font-family:'Inter'; font-size:15px; line-height:1.6; color:var(--black); max-width:150mm; }}
.lead .th {{ display:block; font-size:13.5px; margin-top:7px; line-height:1.55; }}

.badge {{ display:inline-block; font-family:'Inter'; font-size:11px; font-weight:700;
  letter-spacing:.05em; color:var(--burg); background:var(--cream);
  padding:5px 12px; border-radius:20px; margin-top:16px; }}

/* ---------- FLOW (Option 1) ---------- */
.flow {{ margin-top:20px; border:1px solid var(--stone); border-radius:8px; overflow:hidden; }}
.flow-row {{ display:grid; grid-template-columns:38mm 46mm 1fr; align-items:center;
  border-top:1px solid var(--stone); }}
.flow-row:first-child {{ border-top:none; }}
.flow-head {{ background:var(--black); color:var(--white); }}
.flow-head > div {{ font-family:'Bebas Neue'; font-size:16px; letter-spacing:.06em;
  padding:11px 16px; color:var(--gold); }}
.flow-row > div {{ padding:11px 16px; }}
.flow-course {{ font-family:'Bebas Neue'; font-size:22px; color:var(--wine); }}
.flow-course .th {{ font-family:'Inter'; font-size:11px; display:block; margin-top:1px; }}
.flow-wine {{ font-family:'Inter'; font-weight:700; font-size:13px; color:var(--black); }}
.flow-note {{ font-family:'Inter'; font-size:12.5px; color:var(--graphite); line-height:1.45; }}
.flow-cap {{ font-family:'Inter'; font-size:11px; color:var(--graphite); margin-top:12px; font-style:italic; }}

/* ---------- STATIONS (Option 2) ---------- */
.stations {{ display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-top:22px; }}
.station {{ border:1px solid var(--stone); border-radius:10px; padding:22px 18px; text-align:center;
  background:linear-gradient(180deg,#fff 0%,var(--white) 100%); }}
.station .ico {{ font-size:38px; line-height:1; margin-bottom:14px; }}
.station h3 {{ font-size:30px; color:var(--black); }}
.station .en-sub {{ font-family:'Inter'; font-size:11px; font-weight:700; letter-spacing:.1em;
  text-transform:uppercase; color:var(--wine); margin-top:4px; }}
.station .th {{ font-size:14px; margin-top:8px; }}
.station .desc {{ font-family:'Inter'; font-size:12px; color:var(--graphite); margin-top:14px; line-height:1.5; }}
.station.sparkling {{ border-color:var(--gold); }}
.station.sparkling h3 {{ color:var(--burg); }}

/* ---------- NOSE GAME ---------- */
.nose-wrap {{ margin-top:20px; display:grid; grid-template-columns:1.15fr .85fr; gap:0;
  border:1px solid var(--stone); border-radius:12px; overflow:hidden; }}
.nose-l {{ padding:26px 26px; }}
.nose-r {{ background:linear-gradient(155deg,var(--burg),var(--wine)); color:var(--white);
  padding:26px 24px; display:flex; flex-direction:column; justify-content:center; text-align:center; }}
.nose-l p {{ font-family:'Inter'; font-size:13.5px; line-height:1.55; color:var(--black); margin:0 0 12px; }}
.nose-l p .th {{ display:block; font-size:12px; margin-top:5px; }}
.steps {{ list-style:none; padding:0; margin:14px 0 0; }}
.steps li {{ font-family:'Inter'; font-size:13px; color:var(--black); padding:8px 0 8px 34px;
  position:relative; border-top:1px dashed var(--stone); }}
.steps li:first-child {{ border-top:none; }}
.steps li b {{ position:absolute; left:0; top:8px; width:24px; height:24px; border-radius:50%;
  background:var(--wine); color:#fff; font-family:'Bebas Neue'; font-size:14px;
  display:flex; align-items:center; justify-content:center; }}
.nose-r .prize-k {{ font-family:'Inter'; letter-spacing:.24em; text-transform:uppercase;
  font-size:10px; opacity:.8; }}
.nose-r .bottle {{ font-size:54px; margin:6px 0 8px; }}
.nose-r h3 {{ font-size:30px; color:#fff; line-height:1; }}
.nose-r .prize-desc {{ font-family:'Inter'; font-size:12.5px; line-height:1.55; margin-top:14px; opacity:.94; }}
.nose-r .prize-desc .th {{ color:var(--cream); display:block; margin-top:6px; font-size:11.5px; }}
.nose-r .thresh {{ font-family:'Inter'; font-size:10.5px; margin-top:18px; padding-top:14px;
  border-top:1px solid rgba(255,255,255,.25); opacity:.85; }}

/* ---------- TWO-COLUMN (bring / need) ---------- */
.cols {{ display:grid; grid-template-columns:1fr 1fr; gap:22px; margin-top:22px; }}
.col {{ border:1px solid var(--stone); border-radius:10px; padding:24px 22px; background:#fff; }}
.col.need {{ background:var(--black); border-color:var(--black); }}
.col h3 {{ font-size:26px; color:var(--wine); }}
.col.need h3 {{ color:var(--gold); }}
.col .th {{ font-size:13px; margin-top:2px; margin-bottom:16px; }}
.col.need .th {{ color:var(--stone); }}
.col ul {{ list-style:none; padding:0; margin:0; }}
.col li {{ font-family:'Inter'; font-size:13px; line-height:1.5; padding:9px 0 9px 22px;
  position:relative; border-top:1px solid var(--cream); }}
.col li:first-child {{ border-top:none; }}
.col li::before {{ content:'—'; position:absolute; left:0; color:var(--gold); }}
.col.need li {{ color:var(--white); border-top-color:#333; }}
.col li .th {{ display:block; font-size:11px; margin:2px 0 0; }}
.col.need li .th {{ color:var(--stone); }}

/* ---------- NEXT STEP ---------- */
.next-page {{ display:flex; flex-direction:column; justify-content:center; }}
.next {{ text-align:center; background:linear-gradient(160deg,var(--cream),var(--white));
  border:1px solid var(--stone); border-radius:12px; padding:36px 34px; }}
.next .big {{ font-family:'Bebas Neue'; font-size:40px; color:var(--black); line-height:1.02; }}
.next .big span {{ color:var(--wine); }}
.next .th {{ font-size:15px; margin-top:10px; }}
.next .sub {{ font-family:'Inter'; font-size:13.5px; color:var(--graphite); max-width:135mm;
  margin:20px auto 0; line-height:1.6; }}
.next .contact {{ font-family:'Inter'; font-size:13px; color:var(--black); margin-top:26px;
  padding-top:20px; border-top:1px solid var(--stone); }}
.next .contact b {{ color:var(--wine); }}

.footer {{ position:absolute; bottom:8mm; left:18mm; right:18mm; display:flex;
  justify-content:space-between; align-items:center; font-family:'Inter'; font-size:9.5px;
  letter-spacing:.06em; color:var(--graphite); text-transform:uppercase; }}
.footer img {{ height:22px; width:22px; vertical-align:middle; opacity:.9; }}
"""

FLOW_ROWS = [
    ("Welcome", "Приветственное", "Sparkling", "Bright, celebratory — sets the tone as guests arrive.", "ต้อนรับด้วยสปาร์กลิงสดใส"),
    ("Starters", "Закуски", "Crisp white / rosé", "Fresh acidity to lift lighter, savoury bites.", "ไวน์ขาว/โรเซ่สดชื่นเข้ากับออร์เดิร์ฟ"),
    ("Main", "Горячее", "Structured red", "Body and tannin to stand up to the main course.", "ไวน์แดงโครงสร้างแน่นสำหรับจานหลัก"),
    ("Dessert", "Десерт", "Sweet / fortified", "A sweeter close to round off the evening.", "ไวน์หวานปิดท้ายค่ำคืน"),
]

STATIONS = [
    ("spirits", "🥃", "Spirits", "КРЕПКОЕ", "สุราแรง", "Whisky, gin & signature pours — poured and explained on request."),
    ("sparkling", "🍾", "Sparkling", "ИГРИСТОЕ", "สปาร์กลิง", "Prosecco, cava & more — the room's easy, festive default."),
    ("still", "🍷", "Still Wines", "ТИХИЕ ВИНА", "ไวน์นิ่ง", "Reds, whites & rosé by the glass — with a word on each as we pour."),
]

BRING = [
    ("A sommelier / host for the evening", "ซอมเมอลิเยร์ประจำงาน"),
    ("Glassware for tasting", "แก้วไวน์สำหรับชิม"),
    ("The wines & spirits, curated to your evening", "ไวน์และสุราคัดสรรสำหรับงานของคุณ"),
    ("The Le Nez 24-aroma kit for the game", "ชุดกลิ่น Le Nez 24 กลิ่นสำหรับเกม"),
    ("Station / table set-up & the storytelling", "การจัดสถานีและการเล่าเรื่องไวน์"),
]
NEED = [
    ("The space & tables at Spice House", "พื้นที่และโต๊ะที่ Spice House"),
    ("Expected number of guests", "จำนวนแขกโดยประมาณ"),
    ("The date of the evening", "วันที่จัดงาน"),
    ("Your food menu — if you choose Option 1, so we pair to it", "เมนูอาหาร — หากเลือกออปชัน 1 เพื่อจับคู่ไวน์"),
]


def flow_html():
    rows = ['<div class="flow-row flow-head"><div>Course</div><div>Wine</div><div>Why it works</div></div>']
    for en, ru, wine, note, th in FLOW_ROWS:
        rows.append(
            f'<div class="flow-row"><div class="flow-course">{en}</div>'
            f'<div class="flow-wine">{wine}</div>'
            f'<div class="flow-note">{note}<span class="th"> · {th}</span></div></div>'
        )
    return '<div class="flow">' + "".join(rows) + "</div>"


def stations_html():
    out = []
    for cls, ico, en, ru, th, desc in STATIONS:
        out.append(
            f'<div class="station {cls}"><div class="ico">{ico}</div>'
            f'<h3>{en}</h3><div class="en-sub">Station</div>'
            f'<div class="th">{th}</div><div class="desc">{desc}</div></div>'
        )
    return '<div class="stations">' + "".join(out) + "</div>"


def col_html(title, th_title, items, need=False):
    lis = "".join(f'<li>{en}<span class="th">{th}</span></li>' for en, th in items)
    cls = "col need" if need else "col"
    return f'<div class="{cls}"><h3>{title}</h3><div class="th">{th_title}</div><ul>{lis}</ul></div>'


def footer(n):
    return (f'<div class="footer"><span>Wine &amp; Whiskey · Phuket</span>'
            f'<span>An Evening of Wine — Spice House · 29 August</span>'
            f'<span>{n}</span></div>')


# ---- Scene illustrations (inline SVG, brand line-art) ----
BURG, WINE, CREAM, GOLD, GRAPH = "#5C1010", "#8C1C1C", "#EDE0D0", "#C9A84C", "#3D3D3D"


def _seated_svg():
    seats_top, seats_bot, plates = [], [], []
    xs = [150 + i * 68 for i in range(6)]
    for cx in xs:
        # chair + seated guest above the table
        seats_top.append(
            f'<rect x="{cx-14}" y="34" width="28" height="15" rx="4" fill="none" stroke="{GRAPH}" stroke-width="2"/>'
            f'<circle cx="{cx}" cy="24" r="8" fill="#fff" stroke="{GRAPH}" stroke-width="2"/>')
        # chair + seated guest below the table
        seats_bot.append(
            f'<rect x="{cx-14}" y="131" width="28" height="15" rx="4" fill="none" stroke="{GRAPH}" stroke-width="2"/>'
            f'<circle cx="{cx}" cy="156" r="8" fill="#fff" stroke="{GRAPH}" stroke-width="2"/>')
        # place setting on the table: plate + wine glass
        plates.append(
            f'<circle cx="{cx}" cy="90" r="9" fill="#fff" stroke="{BURG}" stroke-width="1.6"/>'
            f'<circle cx="{cx+16}" cy="90" r="3.4" fill="{WINE}"/>')
    return (
        f'<svg viewBox="0 0 660 180" xmlns="http://www.w3.org/2000/svg" role="img" '
        f'aria-label="A long banquet table with guests seated on both sides">'
        f'{"".join(seats_top)}'
        f'<rect x="110" y="72" width="440" height="36" rx="10" fill="{CREAM}" stroke="{BURG}" stroke-width="2"/>'
        f'{"".join(plates)}{"".join(seats_bot)}</svg>')


def _person(x, foot):
    return (f'<rect x="{x-9}" y="{foot-38}" width="18" height="38" rx="9" fill="#fff" stroke="{GRAPH}" stroke-width="2"/>'
            f'<circle cx="{x}" cy="{foot-46}" r="8" fill="#fff" stroke="{GRAPH}" stroke-width="2"/>')


def _bottle(x, base):
    return (f'<rect x="{x-7}" y="{base-30}" width="14" height="30" rx="3" fill="#fff" stroke="{BURG}" stroke-width="1.6"/>'
            f'<rect x="{x-3}" y="{base-44}" width="6" height="15" fill="#fff" stroke="{BURG}" stroke-width="1.6"/>'
            f'<circle cx="{x}" cy="{base-45}" r="2.6" fill="{GOLD}"/>')


def _hitable(cx):
    return (f'<ellipse cx="{cx}" cy="120" rx="34" ry="9" fill="{CREAM}" stroke="{BURG}" stroke-width="2"/>'
            f'<rect x="{cx-3}" y="120" width="6" height="46" fill="none" stroke="{GRAPH}" stroke-width="2"/>'
            f'<ellipse cx="{cx}" cy="168" rx="20" ry="6" fill="none" stroke="{GRAPH}" stroke-width="2"/>')


def _freeflow_svg():
    # buffet counter (left) with three bottles, two high cocktail tables (right), standing guests
    buffet = (
        f'<rect x="40" y="118" width="176" height="52" rx="6" fill="{CREAM}" stroke="{BURG}" stroke-width="2"/>'
        f'<line x1="40" y1="118" x2="216" y2="118" stroke="{BURG}" stroke-width="2"/>'
        + _bottle(78, 118) + _bottle(128, 118) + _bottle(178, 118))
    tables = _hitable(378) + _hitable(510)
    people = (_person(150, 172) + _person(250, 176)
              + _person(346, 176) + _person(410, 172)
              + _person(478, 176) + _person(542, 172))
    return (
        f'<svg viewBox="0 0 660 190" xmlns="http://www.w3.org/2000/svg" role="img" '
        f'aria-label="Guests standing at a buffet counter and high cocktail tables">'
        f'{buffet}{tables}{people}</svg>')


def scene(b64data, cap):
    return (f'<div class="scene"><img src="data:image/png;base64,{b64data}" alt="">'
            f'<div class="scene-cap">{cap}</div></div>')


# A few of the 24 aromas — real, everyday smells so guests get that it's tangible.
AROMAS = [
    ("🍒", "Cherry"), ("🫐", "Blackcurrant"), ("🍓", "Strawberry"), ("🍋", "Lemon"),
    ("🍑", "Apricot"), ("🍍", "Pineapple"), ("🌹", "Rose"), ("🌸", "Violet"),
    ("🫑", "Green pepper"), ("🍄", "Mushroom"), ("🍯", "Honey"), ("🍞", "Toast"),
    ("🌰", "Hazelnut"), ("☕", "Coffee"), ("🌶️", "Black pepper"),
]


def aromas_html():
    chips = "".join(f'<span class="chip"><span class="e">{e}</span>{n}</span>'
                    for e, n in AROMAS)
    return ('<div class="aromas">'
            '<div class="lbl">Real smells you already know · กลิ่นจริงที่คุณรู้จักอยู่แล้ว</div>'
            f'<div class="chips">{chips}</div></div>')


HTML = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>An Evening of Wine — Spice House · Wine &amp; Whiskey</title>
<style>{CSS}</style></head><body>

<!-- COVER -->
<section class="page cover">
  <img class="mono" src="data:image/png;base64,{logo}" alt="Wine &amp; Whiskey">
  <h1>An Evening<br>of Wine</h1>
  <div class="at">at Spice House</div>
  <div class="th-title th">ค่ำคืนแห่งไวน์ ที่ Spice House</div>
  <div class="rule"></div>
  <div class="date">29 August · A Special Evening
    <span class="th">29 สิงหาคม · ค่ำคืนพิเศษ</span>
  </div>
</section>

<!-- OPTION 1 -->
<section class="page">
  <p class="intro">You host the evening — we take care of the wine and the stories.<br><b>First, let's choose the format.</b>
    <span class="th">คุณเป็นเจ้าภาพ — เราดูแลไวน์และเรื่องราวทั้งหมด มาเลือกรูปแบบกันก่อน</span>
  </p>
  <div class="opt-head">
    <span class="opt-tag">Option 1</span>
    <div class="opt-title">Seated Wine Dinner</div>
    <div class="opt-th th">ออปชัน 1 · ดินเนอร์ไวน์แบบนั่งโต๊ะ</div>
  </div>
  <p class="lead">Everyone is seated at the table and the courses come out one by one. With each course we open a matched wine, and our sommelier tells its story — why it's interesting, why it belongs with that dish, and where it comes from.
    <span class="th">ทุกคนนั่งที่โต๊ะและเสิร์ฟอาหารทีละคอร์ส ในแต่ละคอร์สเราเปิดไวน์ที่จับคู่ไว้ และซอมเมอลิเยร์เล่าเรื่องของไวน์ — ทำไมน่าสนใจ ทำไมเข้ากับจานนี้ และมาจากที่ไหน</span>
  </p>
  {scene(img_seated, 'One long table · everyone seated · a wine with every course &nbsp;·&nbsp; โต๊ะยาว · นั่งพร้อมกัน · ไวน์ทุกคอร์ส')}
  {flow_html()}
  <div class="badge">Best for a structured, story-led dinner where the wines follow your menu</div>
  {footer('01')}
</section>

<!-- OPTION 2 -->
<section class="page">
  <div class="opt-head">
    <span class="opt-tag">Option 2</span>
    <div class="opt-title">Free-Flow · Three Stations</div>
    <div class="opt-th th">ออปชัน 2 · แบบอิสระ · สามสถานี</div>
  </div>
  <p class="lead">Open tables, buffet-style. Guests stand, mingle and help themselves. We set up three pouring stations and serve by the glass — people come over, choose what they'd like, and we tell them about it as we pour.
    <span class="th">โต๊ะแบบเปิด สไตล์บุฟเฟต์ แขกยืน พูดคุย และเลือกเองได้ เราจัดสามสถานีรินไวน์และเสิร์ฟทีละแก้ว — แขกเดินมาเลือกสิ่งที่ชอบ แล้วเราเล่าเรื่องให้ฟังระหว่างริน</span>
  </p>
  {scene(img_freeflow, 'Guests stand &amp; mingle · high tables · three pouring stations &nbsp;·&nbsp; แขกยืนพูดคุย · โต๊ะสูง · สามสถานีรินไวน์')}
  {stations_html()}
  <div class="badge">Best for a relaxed, mingling evening where guests explore at their own pace</div>
  {footer('02')}
</section>

<!-- NOSE GAME -->
<section class="page">
  <div class="opt-head">
    <span class="opt-tag">Add-on</span>
    <div class="opt-title">The Nose Game</div>
    <div class="opt-th th">เกมจมูกไวน์ · เสริมได้กับทั้งสองออปชัน</div>
  </div>
  <p class="lead">Wine hides dozens of aromas. Our tasting box holds <b>24 of them</b> in little vials — you smell one without knowing what it is, and try to name it.
    <span class="th">ไวน์ซ่อนกลิ่นหอมนับสิบ กล่องชิมของเรามี <b>24 กลิ่น</b> ในหลอดเล็ก ๆ — ดมโดยไม่รู้ว่ากลิ่นอะไร แล้วลองทาย</span>
  </p>
  {scene(img_nosekit, '24 aromas in one box — smell one, guess what it is &nbsp;·&nbsp; 24 กลิ่นในกล่องเดียว — ดมแล้วทายว่ากลิ่นอะไร')}
  {aromas_html()}
  <div class="nsteps">
    <div class="nstep"><div class="n">1</div><div class="ico">👃</div>
      <h4>Smell a hidden aroma</h4><div class="th">ดมกลิ่นที่ปิดไว้</div></div>
    <div class="nstep"><div class="n">2</div><div class="ico">✅</div>
      <h4>Name it right → <span class="pts">+1 point</span></h4><div class="th">ทายถูก → +1 คะแนน</div></div>
    <div class="nstep"><div class="n">3</div><div class="ico">🏆</div>
      <h4>Most points wins</h4><div class="th">คะแนนมากที่สุดชนะ</div></div>
  </div>
  <div class="nkids-wrap">
    <span class="nkids">Everyone can play — even kids &nbsp;·&nbsp; <span class="th">เล่นได้ทุกคน แม้แต่เด็ก ๆ</span></span>
  </div>
  <div class="prize-strip">
    <div><div class="cup">🍷</div></div>
    <div>
      <div class="pk">The prize</div>
      <h3>Chief Nose of the Evening</h3>
      <p>A special, hand-picked bottle with a craft "for the Nose" tag — a keepsake to take home.
        <span class="th">ไวน์ขวดพิเศษคัดด้วยมือ พร้อมป้าย "for the Nose" — ของที่ระลึกให้นำกลับบ้าน</span>
      </p>
    </div>
  </div>
  {footer('03')}
</section>

<!-- NEXT STEP -->
<section class="page next-page">
  <div class="next">
    <div class="big">Pick a format —<br>then we build <span>your offer</span></div>
    <div class="th">เลือกรูปแบบ แล้วเราจะจัดข้อเสนอสำหรับคุณ</div>
    <div class="sub">Once you choose, we prepare the final proposal: a curated wine list matched to your evening and special partner pricing built just for you.
      <span class="th" style="display:block;margin-top:6px">เมื่อคุณเลือกแล้ว เราจะจัดทำข้อเสนอสุดท้าย: รายการไวน์คัดสรรและราคาพิเศษสำหรับพาร์ทเนอร์โดยเฉพาะ</span>
    </div>
    <div class="contact">Wine &amp; Whiskey · Phuket &nbsp;·&nbsp; <b>29 August — let's make it happen</b></div>
  </div>
  {footer('04')}
</section>

</body></html>"""

out_file = OUT / f"spice-house-wine-evening_en-th_{DATE}.html"
out_file.write_text(HTML, encoding="utf-8")
print("wrote", out_file, f"({len(HTML)//1024} KB)")
