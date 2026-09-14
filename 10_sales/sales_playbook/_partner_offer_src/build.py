#!/usr/bin/env python3
"""Build the HoReCa Partner Offer — the deck a rep leaves behind after a meeting.

One self-contained A4 portrait document (8 pages) rendered via headless Chrome
(--print-to-pdf), with a PNG preview of page 1 via pdftoppm.

  1. Cover                    — four ways to make money on wine
  2. The four offers          — 2x2 overview
  3. 01 The cellar            — ~300 wines, 15+ countries, one invoice
  4. 02 The exclusive range   — Russian wine
  5. 02 The exclusive range   — Russian vodka & gin
  6. 03 Wine list engineering — the margin argument
  7. 04 Pop-up wine bar       — events at zero risk
  8. Recent work              — wine lists and events we have produced
  9. How we start             — three steps + contacts

Shelf figures on page 3 come from inventory.v_sku_breakdown (SKUs with stock on
hand), read on 2026-09-14: ~300 wines, 58 spirits, 15+ countries. They are
round numbers on purpose — re-check them before a reprint, not every week.

Fonts (Bebas Neue + Inter), the W&W wordmark, the WhatsApp QR and every image
are embedded as base64, so the PDF and the HTML are each a single portable
file you can drop straight into WhatsApp. English only — brand rule, Phuket
is international.

Photos: assets/hero.jpg, seated.jpg and nose.jpg are mood imagery for the
event formats — they are not captioned as documentary photos of our events.
Drop real event photos in as assets/event1.jpg … event3.jpg and they replace
the mood tiles on page 7 automatically (see EVENT_TILES below).

Output lands one level up, next to price_list.html, so the portal serves it at
/sales-playbook/partner_offer.html.

Run from inside this folder:  python3 build.py
"""
import base64
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent                      # 10_sales/sales_playbook/
ROOT = Path(__file__).resolve().parents[3]
ASSETS = HERE / "assets"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
STEM = "partner_offer"


def b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode()


def img(name: str, mime: str = "image/jpeg") -> str:
    return f"data:{mime};base64,{b64(ASSETS / name)}"


BEBAS = b64(ROOT / "04_brand/logo/fonts/BebasNeue.woff2")
INTER = b64(ROOT / "04_brand/logo/fonts/Inter500.woff2")
WORDMARK = b64(ROOT / "04_brand/logo/logo_black_transparent.png")
WORDMARK_W = b64(ROOT / "04_brand/logo/logo_white.png")
MONOGRAM = b64(ROOT / "04_brand/logo/channel_avatar_light.png")

HERO = img("hero.jpg")
SEATED = img("seated.jpg")
NOSE = img("nose.jpg")
QR = img("wa_qr.png", "image/png")

# Page 7 tiles. A real photo dropped in as assets/eventN.jpg wins over the
# mood image — that is the only thing that has to change when we finally
# shoot our own events.
EVENT_TILES = [
    ("event1.jpg", "seated.jpg", "Seated wine dinner", "Set menu, five pours, our sommelier at the table."),
    ("event2.jpg", "hero.jpg", "Free-flow tasting", "Stations around the room, guests move, bottles open."),
    ("event3.jpg", "nose.jpg", "Tasting games", "24 aromas, teams, prizes — the room stays two hours longer."),
]

WORK = [
    ("spice.jpg", "Spice House", "Full wine list, 14 positions, two-sided card in their own branding."),
    ("veranda.jpg", "Veranda", "A5 insert — Russia and Moldova, English and Russian, their brand."),
    ("ussr.jpg", "USSR", "Festival identity — A2 posters, we were the alcohol partner of the night."),
    ("tent.jpg", "Table tents", "By-the-glass cards that sit on the table and sell the second glass."),
    ("festcard.jpg", "Festival card", "The weekend list, printed and priced, ready for the floor."),
]

CONTACT_NAME = "Pavel Rasputin"
CONTACT_ROLE = "Owner"
CONTACT_PHONE = "+66 80 902 0550"
CONTACT_MAIL = "p@wine-whiskey.com"

CSS = """
  @font-face{ font-family:'Bebas Neue'; src:url(data:font/woff2;base64,__BEBAS__) format('woff2'); font-weight:400; font-display:block; }
  @font-face{ font-family:'Inter'; src:url(data:font/woff2;base64,__INTER__) format('woff2'); font-weight:500; font-display:block; }
  @page{ size:210mm 297mm; margin:0; }
  :root{
    --wine:#8C1C1C; --burgundy:#5C1010; --ink:#1A1A1A; --warm:#F5F0EB;
    --cream:#EDE0D0; --gold:#C9A84C; --graphite:#3D3D3D; --stone:#D4C9BC;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{background:#c9beb0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:'Inter',sans-serif;color:var(--ink);display:flex;
       flex-direction:column;align-items:center;gap:26px;padding:26px}
  .sheet{width:210mm;height:297mm;background:var(--warm);position:relative;
         overflow:hidden;display:flex;flex-direction:column;padding:16mm 16mm 13mm;
         box-shadow:0 12px 44px rgba(60,40,20,.30)}
  .bebas{font-family:'Bebas Neue',sans-serif;text-transform:uppercase}
  .overline{font-size:9.5px;letter-spacing:3px;text-transform:uppercase;
            font-weight:600;color:var(--gold)}

  /* ---- shared page furniture ---- */
  h2.sec{font-family:'Bebas Neue',sans-serif;font-size:43px;letter-spacing:1.5px;
         color:var(--ink);line-height:.95;margin-bottom:3px;text-transform:uppercase}
  h2.sec .em{color:var(--wine)}
  .sec-kick{margin-bottom:4px}
  .lead{font-size:13px;line-height:1.6;color:var(--graphite);margin:10px 0 16px;max-width:165mm}
  .lead b{color:var(--ink);font-weight:600}
  .body{flex:1;display:flex;flex-direction:column;justify-content:space-between}
  .foot{margin-top:0;padding-top:10px;display:flex;align-items:center;
        justify-content:space-between;border-top:1px solid var(--stone)}
  .foot img{height:11mm;width:auto;display:block}
  .foot .c{text-align:right;font-size:7.5px;letter-spacing:1.3px;
           text-transform:uppercase;color:var(--graphite);line-height:1.7}
  .foot .c b{color:var(--wine)}
  .pg{position:absolute;bottom:7mm;left:0;right:0;text-align:center;
      font-size:8px;letter-spacing:2px;color:#b7a893}

  /* ---- cover ---- */
  .cover{padding:0}
  .cover .top{padding:18mm 16mm 0}
  .cover .mark{height:15mm;width:auto;display:block;margin-bottom:16mm}
  .cover h1{font-family:'Bebas Neue',sans-serif;text-transform:uppercase;
            font-size:104px;line-height:.84;letter-spacing:2px}
  .cover h1 .em{color:var(--wine)}
  .cover .sub{margin-top:18px;font-size:14px;line-height:1.6;color:var(--graphite);max-width:150mm}
  .cover .sub b{color:var(--ink);font-weight:600}
  .cover .hero{margin-top:auto;width:100%;height:88mm;object-fit:cover;display:block}
  .cover .strip{background:var(--ink);color:var(--warm);padding:9mm 16mm;
                display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
  .cover .strip .s .n{font-family:'Bebas Neue',sans-serif;font-size:22px;color:var(--gold);line-height:1}
  .cover .strip .s .t{font-size:10.5px;line-height:1.4;margin-top:5px;color:#e8e0d4}
  .cover .cf{padding:7mm 16mm;display:flex;justify-content:space-between;align-items:center;
             font-size:9.5px;letter-spacing:1.5px;text-transform:uppercase;color:var(--graphite)}
  .cover .cf b{color:var(--wine)}

  /* ---- overview grid ---- */
  .grid4{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-top:4px}
  .grow{flex:1}
  .card{border:1px solid var(--stone);border-radius:8px;background:var(--cream);
        padding:15px 15px 14px;display:flex;flex-direction:column}
  .card .n{font-family:'Bebas Neue',sans-serif;font-size:15px;color:var(--gold);letter-spacing:2px}
  .card .h{font-family:'Bebas Neue',sans-serif;font-size:26px;color:var(--wine);
           letter-spacing:1px;line-height:1.02;margin-top:2px}
  .card .p{font-size:11.5px;line-height:1.5;color:var(--graphite);margin-top:7px}
  .card ul{list-style:none;margin-top:9px;display:flex;flex-direction:column;gap:5px}
  .card li{font-size:10.5px;line-height:1.4;color:var(--graphite);padding-left:13px;position:relative}
  .card li::before{content:"";position:absolute;left:0;top:5px;width:5px;height:5px;
                   background:var(--gold);border-radius:50%}
  .card .up{margin-top:auto;padding-top:10px;font-size:10.5px;line-height:1.4;
            color:var(--ink);border-top:1px solid var(--stone)}
  .card .up b{color:var(--wine);font-weight:600}
  .banner{margin-top:12px;background:var(--ink);color:var(--warm);border-radius:8px;
          padding:15px 18px;display:flex;align-items:center;gap:18px}
  .banner .big{font-family:'Bebas Neue',sans-serif;font-size:34px;color:var(--gold);
               line-height:.9;flex:0 0 auto}
  .banner .tx{font-size:11.5px;line-height:1.55}
  .banner .tx b{color:#fff;font-weight:600}

  /* ---- arrow points ---- */
  .why{display:grid;grid-template-columns:1fr 1fr;gap:9px 22px;margin:2px 0 14px}
  .why .w{font-size:12px;line-height:1.5;color:var(--graphite);padding-left:17px;position:relative}
  .why .w::before{content:"\\2192";position:absolute;left:0;color:var(--wine);font-weight:700}
  .why .w b{color:var(--ink);font-weight:600}

  /* ---- tables ---- */
  .tbl{border:1px solid var(--stone);border-radius:8px;overflow:hidden}
  .tbl .row{display:grid;gap:12px;padding:9px 16px;border-bottom:1px solid var(--stone);align-items:baseline}
  .tbl .row:last-child{border-bottom:none}
  .tbl .row.head{background:var(--cream)}
  .tbl .row.head div{font-size:9px;letter-spacing:1.6px;text-transform:uppercase;
                     font-weight:600;color:var(--graphite)}
  .tbl .k{font-size:12px;color:var(--ink);font-weight:600}
  .tbl .k small{display:block;font-weight:400;color:#8a7c68;font-size:10.5px;margin-top:2px}
  .tbl .v{font-family:'Bebas Neue',sans-serif;font-size:20px;color:var(--ink);
          letter-spacing:.5px;text-align:right}
  .tbl .row.win{background:#f3ead9}
  .tbl .row.win .v{color:var(--wine);font-size:24px}
  .t3 .row{grid-template-columns:1fr 27mm 27mm}
  .t4 .row{grid-template-columns:1fr 26mm 26mm 26mm}
  .t2 .row{grid-template-columns:1fr auto}
  .blk-h{font-family:'Bebas Neue',sans-serif;font-size:19px;letter-spacing:1px;
         color:var(--wine);margin:14px 0 7px}
  .note{margin-top:11px;font-size:10px;font-style:italic;color:#8a7c68;line-height:1.5}

  /* ---- two boxes ---- */
  .two{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:4px}
  .box{border:1px solid var(--stone);border-radius:8px;padding:15px 16px;background:var(--cream)}
  .box.dark{background:var(--ink);border-color:var(--ink)}
  .box .bh{font-family:'Bebas Neue',sans-serif;font-size:21px;letter-spacing:1px;
           color:var(--wine);margin-bottom:9px}
  .box.dark .bh{color:var(--gold)}
  .box ul{list-style:none;display:flex;flex-direction:column;gap:7px}
  .box li{font-size:11px;line-height:1.45;color:var(--graphite);padding-left:14px;position:relative}
  .box.dark li{color:#e8e0d4}
  .box li::before{content:"";position:absolute;left:0;top:5px;width:5px;height:5px;
                  background:var(--gold);border-radius:50%}

  /* ---- steps ---- */
  .steps{display:flex;flex-direction:column}
  .step{display:flex;gap:16px;padding:11px 0;border-bottom:1px solid var(--stone)}
  .step:last-child{border-bottom:none}
  .step .no{font-family:'Bebas Neue',sans-serif;font-size:30px;color:var(--gold);
            line-height:.9;flex:0 0 38px}
  .step .tx{font-size:12.5px;line-height:1.55;color:var(--graphite);padding-top:2px}
  .step .tx b{color:var(--ink);font-weight:600}

  /* ---- split stat ---- */
  .split{margin-top:13px;display:grid;grid-template-columns:1fr 1fr;gap:13px}
  .split .s{border:1px solid var(--stone);border-radius:8px;padding:14px;text-align:center;
            background:var(--cream)}
  .split .s .lbl{font-size:9px;letter-spacing:2px;text-transform:uppercase;
                 color:var(--gold);font-weight:600}
  .split .s .big{font-family:'Bebas Neue',sans-serif;font-size:38px;color:var(--wine);
                 line-height:1;margin-top:5px}
  .split .s .sm{font-size:10.5px;color:var(--graphite);margin-top:5px;line-height:1.45}

  .split3{margin-top:13px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:13px}
  .split3 .s{border:1px solid var(--stone);border-radius:8px;padding:14px;text-align:center;
             background:var(--cream)}
  .split3 .s .lbl{font-size:9px;letter-spacing:2px;text-transform:uppercase;
                  color:var(--gold);font-weight:600}
  .split3 .s .big{font-family:'Bebas Neue',sans-serif;font-size:38px;color:var(--wine);
                  line-height:1;margin-top:5px}
  .split3 .s .sm{font-size:10.5px;color:var(--graphite);margin-top:5px;line-height:1.45}
  .tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .tags span{border:1px solid var(--stone);border-radius:20px;padding:5px 12px;
             font-size:10.5px;color:var(--graphite);background:var(--warm)}
  .tags span b{color:var(--wine);font-weight:600}

  /* ---- format chips ---- */
  .chips{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:12px}
  .chip{border:1px solid var(--stone);border-radius:7px;padding:10px 13px;background:var(--warm)}
  .chip .ch{font-family:'Bebas Neue',sans-serif;font-size:17px;color:var(--ink);letter-spacing:.8px}
  .chip .cp{font-size:10.5px;line-height:1.45;color:var(--graphite);margin-top:3px}

  /* ---- picture tiles ---- */
  .tiles{display:grid;grid-template-columns:1fr 1fr 1fr;gap:11px}
  .tile{border:1px solid var(--stone);border-radius:8px;overflow:hidden;background:var(--cream)}
  .tile img{width:100%;height:42mm;object-fit:cover;display:block}
  .tile .cap{padding:9px 11px 11px}
  .tile .cap .h{font-family:'Bebas Neue',sans-serif;font-size:17px;color:var(--wine);letter-spacing:.6px}
  .tile .cap .p{font-size:10px;line-height:1.4;color:var(--graphite);margin-top:3px}
  .work{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;margin-top:12px}
  .work .w{display:flex;flex-direction:column}
  .work .w img{width:100%;height:46mm;object-fit:cover;object-position:top;
               border:1px solid var(--stone);border-radius:6px;display:block;background:#fff}
  .work .w .h{font-family:'Bebas Neue',sans-serif;font-size:15px;color:var(--ink);
              letter-spacing:.6px;margin-top:7px}
  .work .w .p{font-size:9.5px;line-height:1.4;color:var(--graphite);margin-top:2px}

  /* ---- closing ---- */
  .cta{margin-top:14px;background:var(--ink);color:var(--warm);border-radius:8px;
       padding:18px 20px;display:grid;grid-template-columns:1fr auto;gap:22px;align-items:center}
  .cta .ch{font-family:'Bebas Neue',sans-serif;font-size:30px;color:var(--gold);
           letter-spacing:1px;line-height:1}
  .cta .cp{font-size:12px;line-height:1.6;margin-top:8px;color:#e8e0d4}
  .cta .cp b{color:#fff;font-weight:600}
  .cta .qr{width:30mm;height:30mm;background:#fff;border-radius:6px;padding:2.5mm}
  .cta .qr img{width:100%;height:100%;display:block}
  .cta .qc{font-size:8px;letter-spacing:1.6px;text-transform:uppercase;
           text-align:center;color:var(--gold);margin-top:5px}
  .sign{margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .sign .s{border:1px solid var(--stone);border-radius:8px;padding:14px 16px;background:var(--cream)}
  .sign .s .l{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--gold);font-weight:600}
  .sign .s .n{font-family:'Bebas Neue',sans-serif;font-size:24px;color:var(--ink);
              letter-spacing:.8px;margin-top:4px}
  .sign .s .d{font-size:11.5px;line-height:1.6;color:var(--graphite);margin-top:4px}
  .sign .s .d b{color:var(--ink);font-weight:600}

  @media print{
    html,body{background:#fff}
    body{padding:0;gap:0}
    .sheet{box-shadow:none;page-break-after:always}
    .sheet:last-child{page-break-after:auto}
  }
"""


def foot(n: int) -> str:
    return f"""<div class="foot">
      <img src="data:image/png;base64,{MONOGRAM}" alt="Wine &amp; Whiskey">
      <div class="c">Wine &amp; Whiskey · Wine shop in Rawai, Phuket<br>
        ~300 wines from 15+ countries · <b>{CONTACT_PHONE}</b></div>
    </div><div class="pg">{n}</div>"""


# ============================================================ 1. COVER
P1 = f"""<section class="sheet cover">
  <div class="top">
    <img class="mark" src="data:image/png;base64,{WORDMARK}" alt="Wine &amp; Whiskey">
    <div class="overline">Partner offer · HoReCa Phuket · 2026</div>
    <h1>Four ways<br>to <span class="em">make money</span><br>on wine</h1>
    <div class="sub">We are a wine shop in Rawai — around <b>300 wines from more than 15 countries</b>
      on the shelf, from ฿400 house pours to Pauillac Grand Cru. One of those ranges, the Russian
      one, nobody else on the island can supply. And we don't only deliver bottles: we build wine
      lists that earn, and we run wine events inside your venue <b>where you buy nothing</b>.</div>
  </div>
  <img class="hero" src="{HERO}" alt="">
  <div class="strip">
    <div class="s"><div class="n">01</div><div class="t">The whole cellar</div></div>
    <div class="s"><div class="n">02</div><div class="t">The exclusive range</div></div>
    <div class="s"><div class="n">03</div><div class="t">Wine list engineering</div></div>
    <div class="s"><div class="n">04</div><div class="t">Pop-up wine bar</div></div>
  </div>
  <div class="cf"><div>Open daily 11:00 — 22:00 · Rawai</div>
    <div><b>{CONTACT_PHONE}</b> · wine-whiskey.com</div></div>
</section>"""

# ============================================================ 2. THE FOUR OFFERS
P2 = f"""<section class="sheet">
  <div class="body"><div class="head"><div class="sec-kick overline">What we put on the table</div>
  <h2 class="sec">Four offers, <span class="em">one supplier</span></h2>
  <div class="lead">Take one of them or all four. Each stands on its own, and each is built
    so that the risk stays on our side of the table.</div></div>
  <div class="grid4">
    <div class="card">
      <div class="n">01</div><div class="h">One supplier<br>for the whole list</div>
      <div class="p">We are a wine shop first. Around 300 wines on the shelf at any time, plus
        the whiskey the name promises — you can build an entire card with us.</div>
      <ul><li>France, Italy, Spain, Portugal — Bordeaux to Champagne to tawny port</li>
        <li>New World: Australia, USA, Argentina, Chile, New Zealand, South Africa</li>
        <li>Natural, orange, pét-nat — and 58 spirits: whiskey, cognac, gin, rum, tequila</li>
        <li>One delivery, one invoice, one phone number</li></ul>
      <div class="up">Your upside: <b>the entire card from one supplier.</b></div>
    </div>
    <div class="card">
      <div class="n">02</div><div class="h">The exclusive<br>Russian range</div>
      <div class="p">Inside that cellar sits one range no other distributor on the island
        imports — wine, vodka and gin.</div>
      <ul><li>Abrau-Durso, Château Tamagne, Vedernikov, Aristov, Sikory — 41 SKU</li>
        <li>Ladoga vodka across three tiers, Barrister gin in three profiles</li>
        <li>Indigenous grapes your guests have never seen on a list</li>
        <li>Nobody can copy the page or undercut you on it</li></ul>
      <div class="up">Your upside: <b>a list nobody else can put on a table.</b></div>
    </div>
    <div class="card">
      <div class="n">03</div><div class="h">Wine list<br>engineering</div>
      <div class="p">We rebuild your wine card around cost-in, not catalogue prestige — and we
        design and write it for you.</div>
      <ul><li>Bottles from ฿300 in, same price on your list</li>
        <li>Printed card in your branding, English plus the language you need</li>
        <li>Tent cards, neck tags and a 20-minute floor briefing</li>
        <li>Design and copywriting cost you nothing</li></ul>
      <div class="up">Your upside: <b>the same menu price, twice the margin.</b></div>
    </div>
    <div class="card">
      <div class="n">04</div><div class="h">Pop-up<br>wine bar</div>
      <div class="p">For two evenings we bring a wine station and a sommelier into your room.
        Consignment — you buy nothing.</div>
      <ul><li>Our wine, our stand, our sommelier, our print files</li>
        <li>Your till, your licence, your mark-up</li>
        <li>Unsold bottles leave with us, free of charge</li>
        <li>Repeatable as a monthly weekend format</li></ul>
      <div class="up">Your upside: <b>an event night at ฿0 upfront.</b></div>
    </div>
  </div>
  <div class="banner">
    <div class="big">0</div>
    <div class="tx"><b>Nothing here asks you to buy stock up front or commit to a volume.</b><br>
      Start anywhere: a few new lines on the list, a rebuilt card, or two evenings in the calendar.
      The whole card can follow later, once you have seen how we deliver.</div>
  </div>
  </div>
  {foot(2)}
</section>"""

# ============================================================ 3. THE CELLAR
P3 = f"""<section class="sheet">
  <div class="body"><div class="head"><div class="sec-kick overline">Offer 01</div>
  <h2 class="sec">One supplier<br>for the <span class="em">whole list</span></h2>
  <div class="lead">Before anything else we are a wine shop — the cellar in Rawai that a Phuket
    wine drinker walks into. Around <b>300 wines from more than 15 countries</b> on the shelf at
    any time, and 58 spirits behind it. Whatever your card needs, it is one order to one number,
    not four suppliers and four deliveries.</div></div>
  <div class="tbl t2">
    <div class="row"><div class="k">France <small>Bordeaux, Bourgogne, Rhône, Loire, Jura, Alsace — plus Champagne and Crémant. Pontet-Canet Pauillac Grand Cru, Billecart-Salmon, Ruinart, Chapoutier Hermitage</small></div><div class="v">฿585–6,950</div></div>
    <div class="row"><div class="k">Italy <small>Toscana, Piemonte, Veneto, Alto Adige, Sicilia. Pio Cesare Barolo, La Spinetta Timorasso, Begali Valpolicella, Rosso di Montalcino</small></div><div class="v">฿530–2,840</div></div>
    <div class="row"><div class="k">Spain &amp; Portugal <small>Rioja, Ribera, Verdejo, Garnacha, Bobal — and tawny port from Taylor's and Graham's</small></div><div class="v">฿589–3,490</div></div>
    <div class="row"><div class="k">New World <small>Australia, USA, Argentina, Chile, New Zealand, South Africa. Catena Zapata, Chappellet Signature, Chateau Ste Michelle</small></div><div class="v">฿400–8,590</div></div>
    <div class="row"><div class="k">Off the usual map <small>Georgia, Moldova, Austria, Germany — and GranMonte from Khao Yai when the room wants a Thai wine</small></div><div class="v">฿760–1,740</div></div>
    <div class="row win"><div class="k">Russia <small>Exclusive to us on the island — the next two pages</small></div><div class="v">฿570–1,650</div></div>
  </div>
  <div>
    <div class="blk-h">Every style a card needs</div>
    <div class="tags">
      <span>Red</span><span>White</span><span><b>Champagne</b></span><span>Sparkling</span>
      <span>Rosé</span><span>Orange</span><span>Pét-Nat</span><span>Natural</span>
      <span>Port &amp; fortified</span><span>Sherry</span><span>Magnums</span>
      <span><b>Whiskey</b></span><span>Cognac</span><span>Gin</span><span>Rum</span><span>Tequila</span>
    </div>
  </div>
  <div class="split3">
    <div class="s"><div class="lbl">On the shelf</div><div class="big">~300</div>
      <div class="sm">wines in stock at any given time, plus 58 spirits.</div></div>
    <div class="s"><div class="lbl">Countries</div><div class="big">15+</div>
      <div class="sm">Old World, New World, and the odd corners in between.</div></div>
    <div class="s"><div class="lbl">Every price point</div><div class="big">฿400<span style="font-size:22px">–8,590</span></div>
      <div class="sm">house pour to Grand Cru — roughly a third under ฿900.</div></div>
  </div>
  <div class="note">Figures are bottles physically in stock, and prices here are our retail shelf
    prices — HoReCa pricing is lower and quoted position by position. If a guest asks for a Chablis,
    a Malbec and a natural orange in the same evening, that is one order to one number.</div>
  </div>
  {foot(3)}
</section>"""

# ============================================================ 4. RUSSIAN WINE
P4 = f"""<section class="sheet">
  <div class="body"><div class="head"><div class="sec-kick overline">Offer 02 · the exclusive range</div>
  <h2 class="sec">The list nobody else<br>on Phuket <span class="em">can sell you</span></h2>
  <div class="lead">One shelf in that cellar works differently from the rest. We are the exclusive
    importer of these houses on the island — nobody can undercut you on them, and nobody can put
    the same bottle on a table across the street. It is the page of your list that stays yours.</div></div>
  <div class="why">
    <div class="w"><b>Exclusivity that holds.</b> One distributor, one island — your list stays yours.</div>
    <div class="w"><b>A huge Russian guest flow.</b> A familiar label closes the sale by itself.</div>
    <div class="w"><b>Grapes with no price anchor.</b> Krasnostop, Saperavi, Sibirkovyi — the guest
      judges the glass, not the reputation.</div>
    <div class="w"><b>Méthode classique at a Charmat price.</b> Real bottle fermentation from ฿830.</div>
  </div>
  <div class="blk-h">The houses</div>
  <div class="tbl t2">
    <div class="row"><div class="k">Abrau-Durso <small>Russia's oldest sparkling house, 1870 — nine sparkling SKU, four years in rock tunnels at the top of the range</small></div><div class="v">฿570–1,100</div></div>
    <div class="row"><div class="k">Château Tamagne <small>The workhorse of the list — Krasnostop, Saperavi, oak-aged Reserve, unfiltered Nude</small></div><div class="v">฿570–970</div></div>
    <div class="row"><div class="k">Vedernikov · Don Valley <small>Indigenous specialists — Krasnostop Zolotovsky, Sibirkovyi, 16 months French oak</small></div><div class="v">฿640–1,380</div></div>
    <div class="row"><div class="k">Aristov <small>Méthode classique Blanc de Blancs, Riesling, Cabernet Sauvignon</small></div><div class="v">฿680–830</div></div>
    <div class="row"><div class="k">Sikory · Semigorye <small>The flagship end — Family Reserve Cabernet Sauvignon 2016</small></div><div class="v">฿1,420–1,650</div></div>
  </div>
  <div class="split">
    <div class="s"><div class="lbl">Instead of Prosecco</div><div class="big">฿570</div>
      <div class="sm">Abrau-Durso Reserve Brut — Charmat, 90+ days on the lees.</div></div>
    <div class="s"><div class="lbl">Instead of Crémant</div><div class="big">฿830</div>
      <div class="sm">Victor Dravigny Brut — méthode classique, our bestseller.</div></div>
  </div>
  <div class="note">All prices B2B per bottle, 750 ml, VAT 7% not included. Full list — 41 SKU —
    in the separate price list. Samples are arranged once we have picked the SKUs that fit your concept.</div>
  </div>
  {foot(4)}
</section>"""

# ============================================================ 5. VODKA & GIN
P5 = f"""<section class="sheet">
  <div class="body"><div class="head"><div class="sec-kick overline">Offer 02 · the exclusive range</div>
  <h2 class="sec">The bottle that leaves<br>the table <span class="em">empty</span></h2>
  <div class="lead">Wine is sold by the glass and argued about. Vodka is ordered by the bottle,
    by name, and it is gone by the end of the evening. It is the shortest path from a Russian
    table to a large bill — and most venues on Phuket carry nothing but the two global brands.</div></div>
  <div class="blk-h">Ladoga Group · St. Petersburg · 40% ABV</div>
  <div class="tbl t3">
    <div class="row head"><div>Bottle</div><div>0.7 L</div><div>1.0 L</div></div>
    <div class="row"><div class="k">Ladoga Vodka <small>Triple-distilled premium grain spirit — the house pour</small></div><div class="v">฿660</div><div class="v">฿830</div></div>
    <div class="row"><div class="k">Czar's Original <small>Super premium, recreated from a Peter the Great era recipe</small></div><div class="v">฿680</div><div class="v">฿900</div></div>
    <div class="row"><div class="k">Czar's Gold <small>Imperial Collection — winter wheat from Ladoga's own fields; the celebration bottle</small></div><div class="v">฿1,170</div><div class="v">฿1,310</div></div>
  </div>
  <div class="blk-h">Barrister · London dry, made in St. Petersburg · 0.7 L · 40% ABV</div>
  <div class="tbl t2">
    <div class="row"><div class="k">Barrister Dry Gin <small>Juniper-forward — G&amp;T, Negroni, Martini. Bombay-plus quality, Beefeater-minus cost</small></div><div class="v">฿1,010</div></div>
    <div class="row"><div class="k">Barrister Pink Gin <small>Strawberry and cardamom — spritz and signature serves</small></div><div class="v">฿1,090</div></div>
    <div class="row"><div class="k">Barrister Blue Gin <small>Butterfly pea hue — the cocktail that changes colour at the table</small></div><div class="v">฿1,090</div></div>
  </div>
  <div class="blk-h">What one bottle does for you</div>
  <div class="tbl t4">
    <div class="row head"><div>Ladoga Vodka 0.7 L</div><div>Cost-in</div><div>Guest pays</div><div>Your margin</div></div>
    <div class="row"><div class="k">Bottle service to the table</div><div class="v">฿660</div><div class="v">฿2,200</div><div class="v">฿1,540</div></div>
    <div class="row win"><div class="k">Or poured by the shot <small>40 ml × 17 pours at ฿150</small></div><div class="v">฿660</div><div class="v">฿2,550</div><div class="v">฿1,890</div></div>
  </div>
  <div class="note">Illustrative at typical Phuket menu prices — your own pricing decides the number.
    The point holds either way: no wine on your list returns this much cash per unit sold.</div>
  </div>
  {foot(5)}
</section>"""

# ============================================================ 6. WINE LIST ENGINEERING
P6 = f"""<section class="sheet">
  <div class="body"><div class="head"><div class="sec-kick overline">Offer 03</div>
  <h2 class="sec">The same wine list,<br><span class="em">twice the margin</span></h2>
  <div class="lead">Most wine lists on the island are built from a catalogue: famous regions,
    famous grapes, a price the guest can check on their phone. You pay for the reputation and
    the guest pays for it too — but the margin in the middle is thin. We build the list the
    other way round: <b>from the cost-in up</b>.</div></div>
  <div class="steps">
    <div class="step"><div class="no">1</div><div class="tx"><b>We read your current list and your menu.</b>
      What sells, what sits, what your kitchen needs a wine for.</div></div>
    <div class="step"><div class="no">2</div><div class="tx"><b>We pick by cost-in, not by prestige.</b>
      Less-famous regions and indigenous grapes carry no price expectation — the guest judges what
      is in the glass, and blind, these over-deliver.</div></div>
    <div class="step"><div class="no">3</div><div class="tx"><b>We write and design the card.</b>
      Tasting notes, food pairings, your branding, printed and ready. In English plus Russian,
      Thai or whatever your room speaks.</div></div>
    <div class="step"><div class="no">4</div><div class="tx"><b>We arm the floor.</b>
      Tent cards, neck tags, a 20-minute briefing so your team can sell the second glass.</div></div>
  </div>
  <div class="blk-h">One bottle, two ways to buy it</div>
  <div class="tbl t4">
    <div class="row head"><div>Per bottle</div><div>Cost-in</div><div>On your list</div><div>Your margin</div></div>
    <div class="row"><div class="k">Typical import list <small>famous region, price the guest can look up</small></div><div class="v">฿700–900</div><div class="v">฿1,290</div><div class="v">฿390–590</div></div>
    <div class="row win"><div class="k">List built by us <small>same shelf price for the guest</small></div><div class="v">from ฿300</div><div class="v">฿1,290</div><div class="v">฿990</div></div>
    <div class="row win"><div class="k">The same bottle by the glass <small>฿250 × 5 pours</small></div><div class="v">from ฿300</div><div class="v">฿1,250</div><div class="v">฿950</div></div>
  </div>
  <div class="banner">
    <div class="big">2×</div>
    <div class="tx"><b>The guest pays exactly what they paid before. You keep roughly twice as much.</b><br>
      No price rise, no argument at the table — the change is invisible on the floor and
      obvious in the P&amp;L.</div>
  </div>
  <div class="note">Illustrative figures at a common Phuket price point. We do the same exercise
    on your real list and show you the delta per position before you change a thing. The card
    design and the copy are free — we earn on the bottles.</div>
  </div>
  {foot(6)}
</section>"""

# ============================================================ 7. POP-UP WINE BAR
P7 = f"""<section class="sheet">
  <div class="body"><div class="head"><div class="sec-kick overline">Offer 04</div>
  <h2 class="sec">We become a wine bar<br><span class="em">inside your venue</span></h2>
  <div class="lead">For two evenings we move in: a mobile wine station, the whole selection and
    a sommelier who stands by the wine and talks to your guests. You sell through your till,
    under your licence, and keep the mark-up. <b>You buy nothing and you pre-pay nothing.</b></div></div>
  <div class="steps">
    <div class="step"><div class="no">1</div><div class="tx"><b>We set up the station</b> in a corner of
      your room or at the entrance, dressed for the event.</div></div>
    <div class="step"><div class="no">2</div><div class="tx"><b>The wine arrives on consignment.</b>
      Bottles to sell whole, plus light wines for the glass. Open a glass bottle and it is yours
      at cost — the rest you sell at leisure.</div></div>
    <div class="step"><div class="no">3</div><div class="tx"><b>The guest orders from you and pays you.</b>
      Your till, your licence. Our sommelier does the talking and the pouring.</div></div>
    <div class="step"><div class="no">4</div><div class="tx"><b>We settle afterwards</b> on what actually
      sold. Unopened bottles leave with us, free of charge.</div></div>
  </div>
  <div class="blk-h">One weekend, illustrative — two evenings, ~120 guests a night</div>
  <div class="tbl t4">
    <div class="row head"><div>What happens</div><div>Cost-in</div><div>Guest pays</div><div>Your margin</div></div>
    <div class="row"><div class="k">60 bottles sold <small>the same wine sits at ฿1,200+ on a normal list</small></div><div class="v">฿450</div><div class="v">฿900</div><div class="v">฿27,000</div></div>
    <div class="row"><div class="k">12 bottles opened for the glass <small>≈5 pours each at ฿160</small></div><div class="v">฿350</div><div class="v">฿9,600</div><div class="v">฿5,400</div></div>
    <div class="row win"><div class="k">Weekend total <small>upfront investment: none</small></div><div class="v">฿0</div><div class="v">—</div><div class="v">฿32,400</div></div>
  </div>
  <div class="chips">
    <div class="chip"><div class="ch">Weekend Wine Festival</div><div class="cp">Two evenings, station in the room, festival pricing. The repeatable monthly format.</div></div>
    <div class="chip"><div class="ch">Seated wine dinner</div><div class="cp">Your set menu against five pours, our sommelier walking the table through each one.</div></div>
    <div class="chip"><div class="ch">Free-flow tasting</div><div class="cp">Three stations, guests circulate, one ticket price. Fills a quiet weeknight.</div></div>
    <div class="chip"><div class="ch">Themed country night</div><div class="cp">Russia, the USSR republics, Italy — identity, posters and playlist included.</div></div>
  </div>
  <div class="note">The only line item on your side is printing the artwork we supply. Wine, stand,
    design and sommelier are ours. A one-page consignment and event agreement covers the evening.</div>
  </div>
  {foot(7)}
</section>"""


def tile(real: str, fallback: str, head: str, cap: str) -> str:
    src = img(real) if (ASSETS / real).exists() else img(fallback)
    return f"""<div class="tile"><img src="{src}" alt="">
      <div class="cap"><div class="h">{head}</div><div class="p">{cap}</div></div></div>"""


def work(name: str, head: str, cap: str) -> str:
    return f"""<div class="w"><img src="{img(name)}" alt="">
      <div class="h">{head}</div><div class="p">{cap}</div></div>"""


P8 = f"""<section class="sheet">
  <div class="body"><div class="head"><div class="sec-kick overline">Track record</div>
  <h2 class="sec">What your venue<br><span class="em">actually gets</span></h2>
  <div class="lead">Three formats we run in partner venues — and, below them, the wine lists and
    event material we have already designed, written and printed for restaurants on Phuket. The
    venue supplied the room. We supplied everything else.</div></div>
  <div class="blk-h">The formats</div>
  <div class="tiles">
    {''.join(tile(*t) for t in EVENT_TILES)}
  </div>
  <div class="blk-h">Wine lists and event material we have produced</div>
  <div class="work">
    {''.join(work(*w) for w in WORK)}
  </div>
  <div class="note">Design, copywriting, translation and print-ready files come with the wine —
    there is no design fee. Your logo goes on the card, not ours, unless you want it there.</div>
  </div>
  {foot(8)}
</section>"""

# ============================================================ 9. HOW WE START
P9 = f"""<section class="sheet">
  <div class="body"><div class="head"><div class="sec-kick overline">Next step</div>
  <h2 class="sec">Three steps,<br><span class="em">no commitment</span></h2>
  <div class="lead">Nothing here needs a decision today. The first step costs you twenty minutes
    and tells you exactly what the numbers would look like in your room.</div></div>
  <div class="steps">
    <div class="step"><div class="no">1</div><div class="tx"><b>Twenty minutes at your venue.</b>
      We look at your wine list, your menu and your room, and ask what your guests actually order.</div></div>
    <div class="step"><div class="no">2</div><div class="tx"><b>We come back with a proposal.</b>
      The SKUs that fit your concept with cost-in prices, the margin delta on your current list
      position by position, and — if the room suits it — a date and a plan for an evening.</div></div>
    <div class="step"><div class="no">3</div><div class="tx"><b>You pick what you want.</b>
      A few new lines on the list, a rebuilt card, an event weekend, or all three. One page of
      paperwork, samples arranged for the SKUs you shortlist.</div></div>
  </div>
  <div class="cta">
    <div><div class="ch">Let's put a date in</div>
      <div class="cp">Message us on WhatsApp with your venue name and we will come to you.<br>
        <b>Early week or end of week — whichever suits your floor.</b></div></div>
    <div><div class="qr"><img src="{QR}" alt="WhatsApp QR"></div>
      <div class="qc">Scan to chat</div></div>
  </div>
  <div class="sign">
    <div class="s"><div class="l">Your contact</div><div class="n">{CONTACT_NAME}</div>
      <div class="d">{CONTACT_ROLE}, Wine &amp; Whiskey<br><b>{CONTACT_PHONE}</b><br>{CONTACT_MAIL}</div></div>
    <div class="s"><div class="l">The store</div><div class="n">Wine &amp; Whiskey</div>
      <div class="d">Phuket, Rawai · wine bar next door<br>Open daily 11:00 — 22:00<br>wine-whiskey.com</div></div>
  </div>
  </div>
  {foot(9)}
</section>"""


def main() -> None:
    css = CSS.replace("__BEBAS__", BEBAS).replace("__INTER__", INTER)
    html = (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        "<title>Partner Offer — Wine &amp; Whiskey</title>"
        f"<style>{css}</style></head><body>"
        + P1 + P2 + P3 + P4 + P5 + P6 + P7 + P8 + P9
        + "</body></html>"
    )
    html_path = OUT / f"{STEM}.html"
    html_path.write_text(html, encoding="utf-8")
    print(f"[html] {html_path.name}  {html_path.stat().st_size / 1024:.0f} KB")

    pdf_path = OUT / f"{STEM}.pdf"
    subprocess.run([
        CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
        f"--print-to-pdf={pdf_path}", html_path.as_uri(),
    ], check=True, capture_output=True)
    print(f"[pdf ] {pdf_path.name}  {pdf_path.stat().st_size / 1024:.0f} KB")

    prev = OUT / f"{STEM}_preview"
    subprocess.run([
        "pdftoppm", "-png", "-r", "110", "-singlefile", "-f", "1",
        str(pdf_path), str(prev),
    ], check=True)
    print(f"[png ] {prev.name}.png")


if __name__ == "__main__":
    main()
