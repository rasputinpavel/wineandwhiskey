/**
 * Russian Wine & Spirits — B2B / Wholesale price catalog (Wine & Whiskey)
 *
 * A by-bottle catalog for B2B clients. Same range, photos and bilingual
 * (RU + EN) tasting notes as the Russian-festival landing (`app/russian-wine`),
 * but priced from the supplier's "From Latitude to Customers" column
 * (Moi Vina / Harvest, Phuket Wholesale Price List, Summer 2026) instead of the
 * live store retail price.
 *
 * Format = ONE tall scrollable sheet (phone-width, no page breaks), our usual
 * shareable layout — NOT paginated A4. Build writes a self-contained HTML, then
 * renders it through 03_automation/export_creative.ts:
 *   russian_wine_b2b_catalog_2026-06.html         — source (fonts+images inlined)
 *   russian_wine_b2b_catalog_2026-06_scroll.pdf   — single tall page (scroll)
 *   russian_wine_b2b_catalog_2026-06_preview.png  — full-page screenshot
 *
 * Prices are hardcoded below (b2b, THB, per bottle). When the supplier list
 * changes, edit `b2b` on each row and re-run.
 *
 * Run: node build.mjs
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const FONT_DIR = join(ROOT, '04_brand', 'logo', 'fonts');
const IMG_DIR = join(ROOT, '02_services', 'mission-control', 'public', 'brand', 'products');
const EXPORTER = join(ROOT, '03_automation', 'export_creative.ts');
const OUT_DIR = __dirname;

// ─── Fonts (embedded so the sheet is self-contained) ─────────────────────────
const bebasB64     = readFileSync(join(FONT_DIR, 'BebasNeue.woff2')).toString('base64');
const interB64     = readFileSync(join(FONT_DIR, 'Inter500.woff2')).toString('base64');
const oswaldCyrB64 = readFileSync(join(FONT_DIR, 'Oswald500-cyrillic.woff2')).toString('base64');
const oswaldLatB64 = readFileSync(join(FONT_DIR, 'Oswald500-latin.woff2')).toString('base64');

const FONT_FACE = `
  @font-face { font-family:'Bebas Neue'; src:url('data:font/woff2;base64,${bebasB64}') format('woff2'); font-weight:400; font-style:normal; }
  @font-face { font-family:'Inter'; src:url('data:font/woff2;base64,${interB64}') format('woff2'); font-weight:500; font-style:normal; }
  @font-face { font-family:'Oswald'; src:url('data:font/woff2;base64,${oswaldCyrB64}') format('woff2'); font-weight:500; font-style:normal;
    unicode-range: U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116; }
  @font-face { font-family:'Oswald'; src:url('data:font/woff2;base64,${oswaldLatB64}') format('woff2'); font-weight:500; font-style:normal; }
`;

// ─── Image embedding (base64; placeholder when a bottle has no photo) ────────
function imgTag(file) {
  if (file) {
    const p = join(IMG_DIR, file);
    if (existsSync(p)) {
      const b64 = readFileSync(p).toString('base64');
      return `<img class="bottle" src="data:image/png;base64,${b64}" alt="" />`;
    }
  }
  return `<div class="bottle placeholder"><span>W&amp;W</span></div>`;
}

// ─── Order QR — opens a WhatsApp chat with Irina, pre-filled order text ──────
const ORDER_MSG =
  'Здравствуйте! Хочу разместить B2B-заказ на русские вина. / ' +
  "Hello! I'd like to place a B2B order for Russian wines.";
const ORDER_URL =
  'https://wa.me/66939140004?text=' + encodeURIComponent(ORDER_MSG);
const ORDER_QR = (await QRCode.toString(ORDER_URL, {
  type: 'svg', errorCorrectionLevel: 'M', margin: 0,
  color: { dark: '#1A1A1A', light: '#F3ECE2' },
})).replace(/<\?xml.*?\?>/, '').trim();

// ─── Logo lockup ─────────────────────────────────────────────────────────────
function logo(size = 30) {
  return `<div class="logo" style="--logo-size:${size}px;">
      <span class="logo-wine">WINE</span><span class="logo-whisky">&amp; WHISKEY</span></div>`;
}

// ─── Category labels (RU / EN) ───────────────────────────────────────────────
const CATEGORY = {
  sparkling: { ru: 'Игристое', en: 'Sparkling' },
  red:       { ru: 'Красное',  en: 'Red' },
  white:     { ru: 'Белое',    en: 'White' },
  rose:      { ru: 'Розовое',  en: 'Rosé' },
  vodka:     { ru: 'Водка',    en: 'Vodka' },
  gin:       { ru: 'Джин',     en: 'Gin' },
};
const ORDER = ['sparkling', 'red', 'white', 'rose', 'vodka', 'gin'];

// ─── Catalog — 32 bottles. `b2b` = THB, "From Latitude to Customers" column ──
const BOTTLES = [
  // ── SPARKLING ──
  { image:'abrau-durso-victor-dravigny-brut.png', name:'Victor Dravigny Brut', category:'sparkling', b2b:720,
    producer:{ru:'Абрау-Дюрсо',en:'Abrau-Durso'}, region:{ru:'Долина Абрау, Тамань',en:'Abrau valley, Taman'},
    grape:{ru:'Шардоне · Рислинг · Пино Блан',en:'Chardonnay · Riesling · Pinot Blanc'}, abv:'12%',
    note:{ru:'Классическое игристое бутылочной выдержки — тонкая перляжа, яблоко и цитрус, чистый сухой финиш.',
          en:'Classic-method sparkling — fine bubbles, apple and citrus, a clean dry finish.'} },
  { image:'abrau-durso-reserve-brut.png', name:'Reserve Brut', category:'sparkling', b2b:510,
    producer:{ru:'Абрау-Дюрсо',en:'Abrau-Durso'}, region:{ru:'Долина Абрау, Тамань',en:'Abrau valley, Taman'},
    grape:{ru:'Шардоне · Рислинг · Пино Блан',en:'Chardonnay · Riesling · Pinot Blanc'}, abv:'11.5%',
    note:{ru:'Свежее резервное брют — белые цветы и груша, лёгкое и питкое.',
          en:'Fresh reserve brut — white flowers and pear, light and easy-drinking.'} },
  { image:'aristov-cuvee-alexander-brut.png', name:'Cuvée Alexander Blanc de Blancs', category:'sparkling', b2b:750,
    producer:{ru:'Аристов',en:'Aristov'}, region:{ru:'Тамань',en:'Taman Peninsula'},
    grape:{ru:'100% Шардоне',en:'100% Chardonnay'}, abv:'12%',
    note:{ru:'Бланк-де-блан классическим методом — экстра-брют, минеральность и зелёное яблоко.',
          en:'Blanc de blancs, classic method — extra brut, mineral and green apple.'} },
  { image:'abrau-durso-alexander-ii-brut-vintage.png', name:'Alexander II Brut Vintage', category:'sparkling', b2b:1200,
    producer:{ru:'Абрау-Дюрсо',en:'Abrau-Durso'}, region:{ru:'Долина Абрау, Тамань',en:'Abrau valley, Taman'},
    grape:{ru:'Пино Нуар · Пино Блан · Шардоне',en:'Pinot Noir · Pinot Blanc · Chardonnay'}, abv:'12%',
    note:{ru:'Винтажное брют — выдержка в скальных тоннелях не менее 4 лет, глубокое, с нотами выпечки и ореха.',
          en:'Vintage brut aged at least four years in the rock cellars — deep, with brioche and nutty notes.'} },
  { image:'abrau-durso-brut-dor-riesling.png', name:"Brut d'Or Riesling 2021", category:'sparkling', b2b:1000,
    producer:{ru:'Абрау-Дюрсо',en:'Abrau-Durso'}, region:{ru:'Долина Абрау, Тамань',en:'Abrau valley, Taman'},
    grape:{ru:'100% Рислинг',en:'100% Riesling'}, abv:'12.5%',
    note:{ru:'Игристое из рислинга одного участка — лайм, белые цветы и звонкая кислотность.',
          en:'Single-vineyard riesling sparkling — lime, white flowers and a bright acidity.'} },
  { image:'abrau-durso-victor-dravigny-rose.png', name:'Victor Dravigny Rosé Brut', category:'sparkling', b2b:720,
    producer:{ru:'Абрау-Дюрсо',en:'Abrau-Durso'}, region:{ru:'Долина Абрау, Тамань',en:'Abrau valley, Taman'},
    grape:{ru:'Пино Нуар · Каберне Совиньон',en:'Pinot Noir · Cabernet Sauvignon'}, abv:'12%',
    note:{ru:'Розовое брют классическим методом — земляника и роза, сухое.',
          en:'Classic-method rosé brut — wild strawberry and rose, dry.'} },

  // ── RED ──
  { image:'chateau-tamagne-cabernet-reserve.png', name:'Cabernet Reserve', category:'red', b2b:685,
    producer:{ru:'Шато Тамань',en:'Château Tamagne'}, region:{ru:'Тамань',en:'Taman Peninsula'},
    grape:{ru:'100% Каберне Совиньон',en:'100% Cabernet Sauvignon'}, abv:'12–14%',
    note:{ru:'Выдержка в дубе — чёрная смородина, специи и мягкий танин.',
          en:'Oak-aged — blackcurrant, spice and a soft tannin.'} },
  { image:'chateau-tamagne-saperavi-reserve.png', name:'Saperavi Reserve', category:'red', b2b:685,
    producer:{ru:'Шато Тамань',en:'Château Tamagne'}, region:{ru:'Тамань',en:'Taman Peninsula'},
    grape:{ru:'100% Саперави',en:'100% Saperavi'}, abv:'14%',
    note:{ru:'Грузинский сорт на русском терруаре — насыщенное, ежевика, чернослив и дуб.',
          en:'A Georgian variety on Russian terroir — dense, with blackberry, prune and oak.'} },
  { image:'chateau-tamagne-krasnostop-reserve.png', name:'Krasnostop Reserve Collection', category:'red', b2b:875,
    producer:{ru:'Шато Тамань',en:'Château Tamagne'}, region:{ru:'Тамань',en:'Taman Peninsula'},
    grape:{ru:'100% Красностоп',en:'100% Krasnostop'}, abv:'14%',
    note:{ru:'Кубанский автохтон, выдержка в дубе — зрелая вишня, кожа и табак.',
          en:'A Kuban native grape, oak-aged — ripe cherry, leather and tobacco.'} },
  { image:'aristov-cabernet-sauvignon.png', name:'Cabernet Sauvignon', category:'red', b2b:615,
    producer:{ru:'Аристов',en:'Aristov'}, region:{ru:'Кубань',en:'Kuban'},
    grape:{ru:'100% Каберне Совиньон',en:'100% Cabernet Sauvignon'}, abv:'14%',
    note:{ru:'Яркое повседневное каберне — слива, паприка и свежая кислотность.',
          en:'A bright everyday cabernet — plum, paprika and fresh acidity.'} },
  { image:'sikory-cabernet-family-reserve.png', name:'Cabernet Sauvignon Reserve', category:'red', b2b:1900,
    producer:{ru:'Sikory',en:'Sikory'}, region:{ru:'Семигорье',en:'Semigorye'},
    grape:{ru:'100% Каберне Совиньон',en:'100% Cabernet Sauvignon'}, abv:'14%',
    note:{ru:'Гаражное хозяйство Семигорья — концентрированное, чёрные ягоды и графит.',
          en:'A boutique Semigorye estate — concentrated, with dark berries and graphite.'} },
  { image:'vedernikov-krasnostop-zolotovsky-oak.png', name:'Krasnostop Zolotovsky 2020', category:'red', b2b:1250,
    producer:{ru:'Ведерниковъ',en:'Vedernikov'}, region:{ru:'Долина Дона',en:'Don Valley'},
    grape:{ru:'100% Красностоп Золотовский',en:'100% Krasnostop Zolotovsky'}, abv:'14.5%',
    note:{ru:'Донской автохтон, выдержка во французском дубе — вишнёвый джем, чернослив, дым и ваниль.',
          en:'A native Don grape, French-oak aged — cherry jam, prune, smoke and vanilla.'} },
  { image:'chateau-tamagne-nude-saperavi.png', name:'Nude Saperavi · Non-Filtered', category:'red', b2b:575,
    producer:{ru:'Шато Тамань',en:'Château Tamagne'}, region:{ru:'Краснодарский край',en:'Krasnodar Region'},
    grape:{ru:'100% Саперави',en:'100% Saperavi'}, abv:'13.5%',
    note:{ru:'Нефильтрованное саперави — сочное, живое, тёмная слива и пряность.',
          en:'Unfiltered saperavi — juicy and alive, dark plum and spice.'} },
  { image:'chateau-tamagne-premier-rouge-reserve.png', name:'South Coast Reserve Premier Rouge', category:'red', b2b:685,
    producer:{ru:'Шато Тамань',en:'Château Tamagne'}, region:{ru:'Тамань',en:'Taman Peninsula'},
    grape:{ru:'Мерло · Каберне · Красностоп · Саперави',en:'Merlot · Cabernet · Krasnostop · Saperavi'}, abv:'12–14%',
    note:{ru:'Купаж четырёх сортов — округлое и ароматное, красные и чёрные ягоды.',
          en:'A four-grape blend — round and aromatic, red and black fruit.'} },

  // ── WHITE ──
  { image:'chateau-tamagne-grape-dance-blanc.png', name:'Grape Dance Blanc', category:'white', b2b:515,
    producer:{ru:'Шато Тамань',en:'Château Tamagne'}, region:{ru:'Тамань',en:'Taman Peninsula'},
    grape:{ru:'Бианка · Гарганега',en:'Bianca · Garganega'}, abv:'14%',
    note:{ru:'Лёгкое и ароматное белое на каждый день — белые цветы, груша и цитрус.',
          en:'A light, aromatic everyday white — white flowers, pear and citrus.'} },
  { image:'aristov-riesling.png', name:'Riesling «Meow»', category:'white', b2b:610,
    producer:{ru:'Аристов',en:'Aristov'}, region:{ru:'Кубань',en:'Kuban'},
    grape:{ru:'100% Рислинг',en:'100% Riesling'}, abv:'14%',
    note:{ru:'Сухой рислинг — лайм, зелёное яблоко и хрустящая кислотность.',
          en:'A dry riesling — lime, green apple and crisp acidity.'} },
  { image:'visokiy-bereg-gruner-veltliner.png', name:'Grüner Veltliner', category:'white', b2b:595,
    producer:{ru:'Высокий Берег',en:'Visokiy Bereg'}, region:{ru:'Кубань',en:'Kuban'},
    grape:{ru:'100% Грюнер Вельтлинер',en:'100% Grüner Veltliner'}, abv:'12.5%',
    note:{ru:'Австрийский сорт на Кубани — белый перец, груша и минеральность.',
          en:'An Austrian variety in Kuban — white pepper, pear and minerality.'} },
  { image:'abrau-durso-chardonnay.png', name:'Chardonnay', category:'white', b2b:910,
    producer:{ru:'Абрау-Дюрсо',en:'Abrau-Durso'}, region:{ru:'Долина Абрау, Тамань',en:'Abrau valley, Taman'},
    grape:{ru:'100% Шардоне',en:'100% Chardonnay'}, abv:'12%',
    note:{ru:'Тихое шардоне из премиальной коллекции — спелое яблоко и лёгкая сливочность.',
          en:'A still chardonnay from the premium range — ripe apple and a touch of cream.'} },
  { image:'vedernikov-sibirkovyi.png', name:'Sibirkovy', category:'white', b2b:575,
    producer:{ru:'Ведерниковъ',en:'Vedernikov'}, region:{ru:'Долина Дона',en:'Don Valley'},
    grape:{ru:'100% Сибирьковый',en:'100% Sibirkovy'}, abv:'12%',
    note:{ru:'Редкий донской сорт — акация, лайм и зелёное яблоко, минеральный грейпфрутовый финиш.',
          en:'A rare Don grape — acacia, lime and green apple, a mineral grapefruit finish.'} },

  // ── ROSÉ ──
  { image:'visokiy-bereg-graphite-rose.png', name:'Graphite Rosé', category:'rose', b2b:650,
    producer:{ru:'Высокий Берег',en:'Visokiy Bereg'}, region:{ru:'Кубань',en:'Kuban'},
    grape:{ru:'100% Каберне Совиньон',en:'100% Cabernet Sauvignon'}, abv:'12%',
    note:{ru:'Сухое розе из каберне — красная смородина, грейпфрут и солёная свежесть.',
          en:'A dry cabernet rosé — redcurrant, grapefruit and a saline freshness.'} },
  { image:'vedernikov-krasnostop-rose.png', name:'Krasnostop Rosé', category:'rose', b2b:625,
    producer:{ru:'Ведерниковъ',en:'Vedernikov'}, region:{ru:'Долина Дона',en:'Don Valley'},
    grape:{ru:'100% Красностоп Золотовский',en:'100% Krasnostop Zolotovsky'}, abv:'12%',
    note:{ru:'Живое розе — клубника, зефир и ягодный сорбет, шелковистый финиш.',
          en:'A vibrant rosé — strawberry, marshmallow and berry sorbet, a silky finish.'} },

  // ── VODKA ──
  { image:'czars-gold.png', name:"Czar's Gold", category:'vodka', b2b:1060,
    producer:{ru:'Ladoga',en:'Ladoga'}, region:{ru:'Санкт-Петербург',en:'St. Petersburg'},
    grape:{ru:'Озимая пшеница · 0.7 л',en:'Winter wheat · 0.7 L'}, abv:'40%',
    note:{ru:'Люксовая водка из коллекции Imperial Collection Gold — мягкая, чистая, зерновая сладость.',
          en:'A luxury vodka from the Imperial Collection Gold range — soft, clean, grainy sweetness.'} },
  { image:'czars-original.png', name:"Czar's Original", category:'vodka', b2b:610,
    producer:{ru:'Ladoga',en:'Ladoga'}, region:{ru:'Санкт-Петербург',en:'St. Petersburg'},
    grape:{ru:'Зерновой спирт · 0.7 л',en:'Grain spirit · 0.7 L'}, abv:'40%',
    note:{ru:'Супер-премиум водка по историческому рецепту эпохи Петра Великого — гладкая и нейтральная.',
          en:'A super-premium vodka from a Peter-the-Great-era recipe — smooth and neutral.'} },
  { image:'ladoga-vodka.png', name:'Ladoga Premium', category:'vodka', b2b:599,
    producer:{ru:'Ladoga',en:'Ladoga'}, region:{ru:'Санкт-Петербург',en:'St. Petersburg'},
    grape:{ru:'Зерновой спирт · 0.7 л',en:'Grain spirit · 0.7 L'}, abv:'40%',
    note:{ru:'Премиальная водка от Ladoga Group — чистая, мягкая, в чистом виде и в коктейлях.',
          en:'A premium vodka by Ladoga Group — clean and soft, neat or in cocktails.'} },

  // ── GIN — Barrister line ──
  { image:'barrister-dry-gin.png', name:'Barrister Dry', category:'gin', b2b:910,
    producer:{ru:'Barrister',en:'Barrister'}, region:{ru:'Россия · 0.7 л',en:'Russia · 0.7 L'},
    grape:{ru:'Классический London Dry',en:'Classic London Dry'}, abv:'40%',
    note:{ru:'Классический сухой джин на можжевельнике и специях.',
          en:'A classic juniper-and-spice dry gin.'} },
  { image:'barrister-pink-gin.png', name:'Barrister Pink', category:'gin', b2b:990,
    producer:{ru:'Barrister',en:'Barrister'}, region:{ru:'Россия · 0.7 л',en:'Russia · 0.7 L'},
    grape:{ru:'Ароматизированный джин',en:'Flavoured gin'}, abv:'40%',
    note:{ru:'Нежно-розовый, на красных ягодах — клубника и лёгкая сладость.',
          en:'Soft pink, berry-infused — strawberry and a gentle sweetness.'} },
  { image:'barrister-blue-gin.png', name:'Barrister Blue', category:'gin', b2b:990,
    producer:{ru:'Barrister',en:'Barrister'}, region:{ru:'Россия · 0.7 л',en:'Russia · 0.7 L'},
    grape:{ru:'Ароматизированный джин',en:'Flavoured gin'}, abv:'40%',
    note:{ru:'Цитрус и травы, насыщенный синий цвет — меняет оттенок в тонике.',
          en:'Citrus and herbs, a deep blue that shifts colour in tonic.'} },
  { image:null, name:'Barrister Absinthium', category:'gin', b2b:990,
    producer:{ru:'Barrister',en:'Barrister'}, region:{ru:'Россия · 0.7 л',en:'Russia · 0.7 L'},
    grape:{ru:'Ароматизированный джин',en:'Flavoured gin'}, abv:'40%',
    note:{ru:'С полынью и анисом — пряный, в духе абсента.',
          en:'With wormwood and anise — spiced, absinthe-leaning.'} },
  { image:null, name:'Barrister Mumbai', category:'gin', b2b:990,
    producer:{ru:'Barrister',en:'Barrister'}, region:{ru:'Россия · 0.7 л',en:'Russia · 0.7 L'},
    grape:{ru:'Ароматизированный джин',en:'Flavoured gin'}, abv:'40%',
    note:{ru:'Тёплые индийские специи — насыщенный и пряный.',
          en:'Warm Indian spices — rich and aromatic.'} },
  { image:null, name:'Barrister Sloe', category:'gin', b2b:990,
    producer:{ru:'Barrister',en:'Barrister'}, region:{ru:'Россия · 0.7 л',en:'Russia · 0.7 L'},
    grape:{ru:'Ликёрный джин',en:'Sloe gin'}, abv:'40%',
    note:{ru:'На ягодах тёрна — тёмный, сладко-терпкий.',
          en:'Sloe-berry — dark, sweet and tart.'} },
  { image:null, name:'Barrister Tropical', category:'gin', b2b:990,
    producer:{ru:'Barrister',en:'Barrister'}, region:{ru:'Россия · 0.7 л',en:'Russia · 0.7 L'},
    grape:{ru:'Ароматизированный джин',en:'Flavoured gin'}, abv:'40%',
    note:{ru:'Тропические фрукты — сочный и солнечный.',
          en:'Tropical fruit — juicy and sunny.'} },
  { image:null, name:'Barrister Wild Berry', category:'gin', b2b:990,
    producer:{ru:'Barrister',en:'Barrister'}, region:{ru:'Россия · 0.7 л',en:'Russia · 0.7 L'},
    grape:{ru:'Ароматизированный джин',en:'Flavoured gin'}, abv:'40%',
    note:{ru:'Лесные ягоды — яркий и ароматный.',
          en:'Forest berries — bright and aromatic.'} },
];

// ─── Render ──────────────────────────────────────────────────────────────────
const fmt = (n) => '฿' + n.toLocaleString('en-US');

function card(b) {
  return `
    <div class="card">
      <div class="card-img">${imgTag(b.image)}</div>
      <div class="card-body">
        <div class="card-top">
          <h3 class="name">${b.name}</h3>
          <div class="price">${fmt(b.b2b)}</div>
        </div>
        <div class="producer">${b.producer.en}</div>
        <div class="meta">${b.region.en} · ${b.grape.en} · ${b.abv}</div>
        <p class="note note-ru">${b.note.ru}</p>
        <p class="note note-en">${b.note.en}</p>
      </div>
    </div>`;
}

function catSection(cat) {
  const items = BOTTLES.filter((b) => b.category === cat);
  if (!items.length) return '';
  const c = CATEGORY[cat];
  return `
    <section class="cat">
      <div class="cat-head">
        <span class="cat-en">${c.en}</span>
        <span class="cat-ru">${c.ru}</span>
      </div>
      <div class="list">${items.map(card).join('')}</div>
    </section>`;
}

const HEADER = `
  <header class="doc-head">
    <div class="dh-top">
      <div class="kicker">Wholesale Price List · Оптовый прайс</div>
      ${logo(26)}
    </div>
    <h1>RUSSIAN WINE <span>&amp; SPIRITS</span></h1>
    <div class="sub">B2B prices · THB per bottle · Summer 2026 · Rawai, Phuket</div>
    <div class="order-qr">
      <div class="oq-tile">${ORDER_QR}</div>
      <div class="oq-cap">
        <span class="oq-en">Place an order</span>
        <span class="oq-ru">Сделать заказ</span>
        <span class="oq-num">WhatsApp · Irina +66 93 914 0004</span>
      </div>
    </div>
  </header>`;

const FOOTER = `
  <footer class="doc-foot">
    Wine &amp; Whiskey · Rawai, Phuket<br>
    Цены B2B, ฿ за бутылку, действительны на лето 2026.<br>
    B2B prices, THB per bottle, valid Summer 2026.
  </footer>`;

// ─── CSS — phone-width single column, one tall scrollable sheet ──────────────
const CSS = `
  ${FONT_FACE}
  :root {
    --wine:#8C1C1C; --black:#1A1A1A; --amber:#C9A84C; --burgundy:#5C1010;
    --graphite:#3D3D3D; --stone:#D4C9BC; --paper:#F7F2EC;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { background:#2a2a2a; font-family:'Inter'; color:var(--black); -webkit-font-smoothing:antialiased; }

  .sheet {
    width:480px; margin:0 auto; padding:30px 22px 26px;
    background:linear-gradient(180deg,#F7F2EC 0%, #EFE3D4 100%);
  }

  /* ── Document header ── */
  .doc-head { padding-bottom:18px; margin-bottom:18px; border-bottom:2px solid var(--wine); }
  .dh-top { display:flex; justify-content:space-between; align-items:flex-start; }
  .kicker { font-size:9px; letter-spacing:0.16em; text-transform:uppercase; color:var(--graphite); padding-top:5px; }
  .logo { display:inline-flex; flex-direction:column; align-items:flex-end; line-height:0.84; }
  .logo-wine   { font-family:'Bebas Neue'; font-size:var(--logo-size); color:var(--wine); letter-spacing:0.01em; }
  .logo-whisky { font-family:'Bebas Neue'; font-size:var(--logo-size); color:var(--black); letter-spacing:0.01em; margin-top:-0.06em; }
  .doc-head h1 { font-family:'Bebas Neue'; font-size:46px; line-height:0.9; letter-spacing:0.01em; color:var(--black); margin-top:10px; }
  .doc-head h1 span { color:var(--wine); }
  .sub { font-size:11px; letter-spacing:0.02em; color:var(--graphite); margin-top:9px; }

  /* Order QR */
  .order-qr { display:flex; align-items:center; gap:13px; margin-top:16px; padding:11px 13px;
    background:rgba(255,255,255,0.5); border:1px solid var(--stone); border-radius:8px; }
  .oq-tile { flex:0 0 72px; width:72px; height:72px; background:#F3ECE2; padding:5px; border-radius:4px;
    box-shadow:0 0 0 1px rgba(140,28,28,0.45); }
  .oq-tile svg { width:100%; height:100%; display:block; shape-rendering:crispEdges; }
  .oq-cap { display:flex; flex-direction:column; gap:2px; }
  .oq-en { font-family:'Bebas Neue'; font-size:21px; letter-spacing:0.02em; color:var(--wine); line-height:1; }
  .oq-ru { font-family:'Oswald'; font-weight:500; font-size:13px; letter-spacing:0.03em; color:var(--graphite); text-transform:uppercase; }
  .oq-num { font-size:11px; color:var(--graphite); margin-top:3px; }

  /* ── Category ── */
  .cat { margin-bottom:20px; }
  .cat-head { display:flex; align-items:baseline; gap:10px; margin:6px 0 12px; padding-bottom:6px; border-bottom:1px solid var(--stone); }
  .cat-en { font-family:'Bebas Neue'; font-size:28px; letter-spacing:0.03em; color:var(--wine); line-height:1; }
  .cat-ru { font-family:'Oswald'; font-weight:500; font-size:16px; letter-spacing:0.03em; color:var(--graphite); text-transform:uppercase; }

  /* ── Cards (single column) ── */
  .list { display:flex; flex-direction:column; gap:12px; }
  .card { display:flex; gap:14px; padding:13px; align-items:flex-start;
    background:rgba(255,255,255,0.46); border:1px solid var(--stone); border-radius:7px; }
  .card-img { flex:0 0 60px; width:60px; height:120px; display:flex; align-items:center; justify-content:center; }
  img.bottle { max-width:100%; max-height:120px; object-fit:contain; }
  .bottle.placeholder { width:46px; height:118px; border:1px dashed var(--stone); border-radius:4px;
    display:flex; align-items:center; justify-content:center; }
  .bottle.placeholder span { font-family:'Bebas Neue'; font-size:15px; color:var(--stone); }

  .card-body { flex:1 1 auto; min-width:0; }
  .card-top { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; }
  .name { font-size:15px; line-height:1.15; font-weight:500; color:var(--black); }
  .price { font-family:'Bebas Neue'; font-size:25px; line-height:0.95; color:var(--black); white-space:nowrap; }
  .producer { font-family:'Oswald'; font-weight:500; font-size:11px; letter-spacing:0.05em;
    text-transform:uppercase; color:var(--wine); margin-top:3px; }
  .meta { font-size:11px; color:var(--graphite); letter-spacing:0.01em; margin-top:6px;
    padding-bottom:7px; border-bottom:1px solid rgba(212,201,188,0.7); }
  .note { font-size:11.5px; line-height:1.34; margin-top:6px; }
  .note-ru { color:var(--black); }
  .note-en { color:var(--graphite); font-style:italic; }

  /* ── Footer ── */
  .doc-foot { margin-top:20px; padding-top:14px; border-top:1px solid var(--stone);
    font-size:10.5px; line-height:1.6; color:var(--graphite); text-align:center; }
`;

// export_creative.ts measures the first <article> as the sheet, so wrap there.
const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=480, initial-scale=1">
<title>W&W Russian Wine — B2B Catalog</title><style>${CSS}</style></head>
<body><article class="sheet">${HEADER}${ORDER.map(catSection).join('')}${FOOTER}</article></body></html>`;

const htmlPath = join(OUT_DIR, 'russian_wine_b2b_catalog_2026-06.html');
writeFileSync(htmlPath, html);
console.log(`→ Wrote ${htmlPath}`);

console.log('→ Rendering single tall scroll PDF + preview via export_creative…');
execSync(`npx tsx "${EXPORTER}" "${htmlPath}"`, { stdio: 'inherit', cwd: ROOT });

// export_creative writes <base>_standalone.html; our source is already
// self-contained, so drop the duplicate.
try { unlinkSync(join(OUT_DIR, 'russian_wine_b2b_catalog_2026-06_standalone.html')); } catch {}

console.log(`✓ Done (${BOTTLES.length} bottles)`);
console.log('  russian_wine_b2b_catalog_2026-06_scroll.pdf');
console.log('  russian_wine_b2b_catalog_2026-06_preview.png');
