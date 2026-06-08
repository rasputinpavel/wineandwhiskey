// Russian wine & spirits — festival landing catalog.
// Items are real store SKUs (Loyverse `RUSSIA` category); `code` is the
// loyverse_product_code used to fetch the live retail price (see page.tsx).
// Grouped by wine TYPE (sparkling/red/white/rosé/vodka/gin). Descriptive notes
// are concise and varietal-typical. Prices come live from the store list, so we
// keep none here.

export type Lang = 'ru' | 'en'
export type Loc = Record<Lang, string>

export type Category = 'sparkling' | 'red' | 'white' | 'rose' | 'vodka' | 'gin'

export type Bottle = {
  id: string
  code: string             // loyverse_product_code → live price
  image: string | null     // file in /public/brand/products/ (null → placeholder)
  name: string
  producer: Loc
  region: Loc
  grape: Loc
  abv: string
  category: Category
  bestseller?: boolean
  note: Loc
}

export const CATEGORY_LABEL: Record<Category, Loc> = {
  sparkling: { ru: 'Игристое', en: 'Sparkling' },
  red:       { ru: 'Красное',  en: 'Red' },
  white:     { ru: 'Белое',    en: 'White' },
  rose:      { ru: 'Розовое',  en: 'Rosé' },
  vodka:     { ru: 'Водка',    en: 'Vodka' },
  gin:       { ru: 'Джин',     en: 'Gin' },
}

export const CATEGORY_ORDER: Category[] = ['sparkling', 'red', 'white', 'rose', 'vodka', 'gin']

export const BOTTLES: Bottle[] = [
  // ─── SPARKLING ────────────────────────────────────────────────────────────
  {
    id: 'dravigny-brut', code: 'A102', image: 'abrau-durso-victor-dravigny-brut.png',
    name: 'Victor Dravigny Brut', category: 'sparkling', bestseller: true,
    producer: { ru: 'Абрау-Дюрсо', en: 'Abrau-Durso' },
    region:   { ru: 'Долина Абрау, Тамань', en: 'Abrau valley, Taman' },
    grape:    { ru: 'Шардоне · Рислинг · Пино Блан', en: 'Chardonnay · Riesling · Pinot Blanc' },
    abv: '12%',
    note: {
      ru: 'Классическое игристое бутылочной выдержки — тонкая перляжа, яблоко и цитрус, чистый сухой финиш.',
      en: 'Classic-method sparkling — fine bubbles, apple and citrus, a clean dry finish.',
    },
  },
  {
    id: 'reserve-brut', code: 'A101', image: 'abrau-durso-reserve-brut.png',
    name: 'Reserve Brut', category: 'sparkling', bestseller: true,
    producer: { ru: 'Абрау-Дюрсо', en: 'Abrau-Durso' },
    region:   { ru: 'Долина Абрау, Тамань', en: 'Abrau valley, Taman' },
    grape:    { ru: 'Шардоне · Рислинг · Пино Блан', en: 'Chardonnay · Riesling · Pinot Blanc' },
    abv: '11.5%',
    note: {
      ru: 'Свежее резервное брют — белые цветы и груша, лёгкое и питкое.',
      en: 'Fresh reserve brut — white flowers and pear, light and easy-drinking.',
    },
  },
  {
    id: 'cuvee-alexander-brut', code: '10462', image: 'aristov-cuvee-alexander-brut.png',
    name: 'Cuvée Alexander Blanc de Blancs', category: 'sparkling',
    producer: { ru: 'Аристов', en: 'Aristov' },
    region:   { ru: 'Тамань', en: 'Taman Peninsula' },
    grape:    { ru: '100% Шардоне', en: '100% Chardonnay' },
    abv: '12%',
    note: {
      ru: 'Бланк-де-блан классическим методом — экстра-брют, минеральность и зелёное яблоко.',
      en: 'Blanc de blancs, classic method — extra brut, mineral and green apple.',
    },
  },
  {
    id: 'alexander-ii-vintage', code: 'A104', image: 'abrau-durso-alexander-ii-brut-vintage.png',
    name: 'Alexander II Brut Vintage', category: 'sparkling',
    producer: { ru: 'Абрау-Дюрсо', en: 'Abrau-Durso' },
    region:   { ru: 'Долина Абрау, Тамань', en: 'Abrau valley, Taman' },
    grape:    { ru: 'Пино Нуар · Пино Блан · Шардоне', en: 'Pinot Noir · Pinot Blanc · Chardonnay' },
    abv: '12%',
    note: {
      ru: 'Винтажное брют — выдержка в скальных тоннелях не менее 4 лет, глубокое, с нотами выпечки и ореха.',
      en: 'Vintage brut aged at least four years in the rock cellars — deep, with brioche and nutty notes.',
    },
  },
  {
    id: 'brut-dor-riesling', code: '10642', image: 'abrau-durso-brut-dor-riesling.png',
    name: "Brut d'Or Riesling 2021", category: 'sparkling',
    producer: { ru: 'Абрау-Дюрсо', en: 'Abrau-Durso' },
    region:   { ru: 'Долина Абрау, Тамань', en: 'Abrau valley, Taman' },
    grape:    { ru: '100% Рислинг', en: '100% Riesling' },
    abv: '12.5%',
    note: {
      ru: 'Игристое из рислинга одного участка — лайм, белые цветы и звонкая кислотность.',
      en: 'Single-vineyard riesling sparkling — lime, white flowers and a bright acidity.',
    },
  },
  {
    id: 'dravigny-rose', code: '10479', image: 'abrau-durso-victor-dravigny-rose.png',
    name: 'Victor Dravigny Rosé Brut', category: 'sparkling',
    producer: { ru: 'Абрау-Дюрсо', en: 'Abrau-Durso' },
    region:   { ru: 'Долина Абрау, Тамань', en: 'Abrau valley, Taman' },
    grape:    { ru: 'Пино Нуар · Каберне Совиньон', en: 'Pinot Noir · Cabernet Sauvignon' },
    abv: '12%',
    note: {
      ru: 'Розовое брют классическим методом — земляника и роза, сухое.',
      en: 'Classic-method rosé brut — wild strawberry and rose, dry.',
    },
  },

  // ─── RED ──────────────────────────────────────────────────────────────────
  {
    id: 'tamagne-cabernet-reserve', code: '10322', image: 'chateau-tamagne-cabernet-reserve.png',
    name: 'Cabernet Reserve', category: 'red', bestseller: true,
    producer: { ru: 'Шато Тамань', en: 'Château Tamagne' },
    region:   { ru: 'Тамань', en: 'Taman Peninsula' },
    grape:    { ru: '100% Каберне Совиньон', en: '100% Cabernet Sauvignon' },
    abv: '12–14%',
    note: {
      ru: 'Выдержка в дубе — чёрная смородина, специи и мягкий танин.',
      en: 'Oak-aged — blackcurrant, spice and a soft tannin.',
    },
  },
  {
    id: 'tamagne-saperavi-reserve', code: '10319', image: 'chateau-tamagne-saperavi-reserve.png',
    name: 'Saperavi Reserve', category: 'red', bestseller: true,
    producer: { ru: 'Шато Тамань', en: 'Château Tamagne' },
    region:   { ru: 'Тамань', en: 'Taman Peninsula' },
    grape:    { ru: '100% Саперави', en: '100% Saperavi' },
    abv: '14%',
    note: {
      ru: 'Грузинский сорт на русском терруаре — насыщенное, ежевика, чернослив и дуб.',
      en: 'A Georgian variety on Russian terroir — dense, with blackberry, prune and oak.',
    },
  },
  {
    id: 'tamagne-krasnostop', code: '10165', image: 'chateau-tamagne-krasnostop-reserve.png',
    name: 'Krasnostop Reserve Collection', category: 'red',
    producer: { ru: 'Шато Тамань', en: 'Château Tamagne' },
    region:   { ru: 'Тамань', en: 'Taman Peninsula' },
    grape:    { ru: '100% Красностоп', en: '100% Krasnostop' },
    abv: '14%',
    note: {
      ru: 'Кубанский автохтон, выдержка в дубе — зрелая вишня, кожа и табак.',
      en: 'A Kuban native grape, oak-aged — ripe cherry, leather and tobacco.',
    },
  },
  {
    id: 'aristov-cabernet', code: '10324', image: 'aristov-cabernet-sauvignon.png',
    name: 'Cabernet Sauvignon', category: 'red', bestseller: true,
    producer: { ru: 'Аристов', en: 'Aristov' },
    region:   { ru: 'Кубань', en: 'Kuban' },
    grape:    { ru: '100% Каберне Совиньон', en: '100% Cabernet Sauvignon' },
    abv: '14%',
    note: {
      ru: 'Яркое повседневное каберне — слива, паприка и свежая кислотность.',
      en: 'A bright everyday cabernet — plum, paprika and fresh acidity.',
    },
  },
  {
    id: 'sikory-cabernet-family', code: '10289', image: 'sikory-cabernet-family-reserve.png',
    name: 'Cabernet Sauvignon Reserve', category: 'red',
    producer: { ru: 'Sikory', en: 'Sikory' },
    region:   { ru: 'Семигорье', en: 'Semigorye' },
    grape:    { ru: '100% Каберне Совиньон', en: '100% Cabernet Sauvignon' },
    abv: '14%',
    note: {
      ru: 'Гаражное хозяйство Семигорья — концентрированное, чёрные ягоды и графит.',
      en: 'A boutique Semigorye estate — concentrated, with dark berries and graphite.',
    },
  },
  {
    id: 'vedernikov-krasnostop-oak', code: '10481', image: 'vedernikov-krasnostop-zolotovsky-oak.png',
    name: 'Krasnostop Zolotovsky 2020', category: 'red',
    producer: { ru: 'Ведерниковъ', en: 'Vedernikov' },
    region:   { ru: 'Долина Дона', en: 'Don Valley' },
    grape:    { ru: '100% Красностоп Золотовский', en: '100% Krasnostop Zolotovsky' },
    abv: '14.5%',
    note: {
      ru: 'Донской автохтон, выдержка во французском дубе — вишнёвый джем, чернослив, дым и ваниль.',
      en: 'A native Don grape, French-oak aged — cherry jam, prune, smoke and vanilla.',
    },
  },
  {
    id: 'tamagne-nude-saperavi', code: '10320', image: 'chateau-tamagne-nude-saperavi.png',
    name: 'Nude Saperavi · Non-Filtered', category: 'red',
    producer: { ru: 'Шато Тамань', en: 'Château Tamagne' },
    region:   { ru: 'Краснодарский край', en: 'Krasnodar Region' },
    grape:    { ru: '100% Саперави', en: '100% Saperavi' },
    abv: '13.5%',
    note: {
      ru: 'Нефильтрованное саперави — сочное, живое, тёмная слива и пряность.',
      en: 'Unfiltered saperavi — juicy and alive, dark plum and spice.',
    },
  },
  {
    id: 'tamagne-premier-rouge', code: '10325', image: 'chateau-tamagne-premier-rouge-reserve.png',
    name: 'South Coast Reserve Premier Rouge', category: 'red',
    producer: { ru: 'Шато Тамань', en: 'Château Tamagne' },
    region:   { ru: 'Тамань', en: 'Taman Peninsula' },
    grape:    { ru: 'Мерло · Каберне · Красностоп · Саперави', en: 'Merlot · Cabernet · Krasnostop · Saperavi' },
    abv: '12–14%',
    note: {
      ru: 'Купаж четырёх сортов — округлое и ароматное, красные и чёрные ягоды.',
      en: 'A four-grape blend — round and aromatic, red and black fruit.',
    },
  },

  // ─── WHITE ────────────────────────────────────────────────────────────────
  {
    id: 'tamagne-grape-dance-blanc', code: '10316', image: 'chateau-tamagne-grape-dance-blanc.png',
    name: 'Grape Dance Blanc', category: 'white', bestseller: true,
    producer: { ru: 'Шато Тамань', en: 'Château Tamagne' },
    region:   { ru: 'Тамань', en: 'Taman Peninsula' },
    grape:    { ru: 'Бианка · Гарганега', en: 'Bianca · Garganega' },
    abv: '14%',
    note: {
      ru: 'Лёгкое и ароматное белое на каждый день — белые цветы, груша и цитрус.',
      en: 'A light, aromatic everyday white — white flowers, pear and citrus.',
    },
  },
  {
    id: 'aristov-riesling', code: '10323', image: 'aristov-riesling.png',
    name: 'Riesling «Meow»', category: 'white', bestseller: true,
    producer: { ru: 'Аристов', en: 'Aristov' },
    region:   { ru: 'Кубань', en: 'Kuban' },
    grape:    { ru: '100% Рислинг', en: '100% Riesling' },
    abv: '14%',
    note: {
      ru: 'Сухой рислинг — лайм, зелёное яблоко и хрустящая кислотность.',
      en: 'A dry riesling — lime, green apple and crisp acidity.',
    },
  },
  {
    id: 'visokiy-gruner', code: '10321', image: 'visokiy-bereg-gruner-veltliner.png',
    name: 'Grüner Veltliner', category: 'white',
    producer: { ru: 'Высокий Берег', en: 'Visokiy Bereg' },
    region:   { ru: 'Кубань', en: 'Kuban' },
    grape:    { ru: '100% Грюнер Вельтлинер', en: '100% Grüner Veltliner' },
    abv: '12.5%',
    note: {
      ru: 'Австрийский сорт на Кубани — белый перец, груша и минеральность.',
      en: 'An Austrian variety in Kuban — white pepper, pear and minerality.',
    },
  },
  {
    id: 'abrau-chardonnay', code: '10482', image: 'abrau-durso-chardonnay.png',
    name: 'Chardonnay', category: 'white',
    producer: { ru: 'Абрау-Дюрсо', en: 'Abrau-Durso' },
    region:   { ru: 'Долина Абрау, Тамань', en: 'Abrau valley, Taman' },
    grape:    { ru: '100% Шардоне', en: '100% Chardonnay' },
    abv: '12%',
    note: {
      ru: 'Тихое шардоне из премиальной коллекции — спелое яблоко и лёгкая сливочность.',
      en: 'A still chardonnay from the premium range — ripe apple and a touch of cream.',
    },
  },
  {
    id: 'vedernikov-sibirkovyi', code: '10480', image: 'vedernikov-sibirkovyi.png',
    name: 'Sibirkovy', category: 'white',
    producer: { ru: 'Ведерниковъ', en: 'Vedernikov' },
    region:   { ru: 'Долина Дона', en: 'Don Valley' },
    grape:    { ru: '100% Сибирьковый', en: '100% Sibirkovy' },
    abv: '12%',
    note: {
      ru: 'Редкий донской сорт — акация, лайм и зелёное яблоко, минеральный грейпфрутовый финиш.',
      en: 'A rare Don grape — acacia, lime and green apple, a mineral grapefruit finish.',
    },
  },

  // ─── ROSÉ ─────────────────────────────────────────────────────────────────
  {
    id: 'visokiy-graphite-rose', code: '10461', image: 'visokiy-bereg-graphite-rose.png',
    name: 'Graphite Rosé', category: 'rose',
    producer: { ru: 'Высокий Берег', en: 'Visokiy Bereg' },
    region:   { ru: 'Кубань', en: 'Kuban' },
    grape:    { ru: '100% Каберне Совиньон', en: '100% Cabernet Sauvignon' },
    abv: '12%',
    note: {
      ru: 'Сухое розе из каберне — красная смородина, грейпфрут и солёная свежесть.',
      en: 'A dry cabernet rosé — redcurrant, grapefruit and a saline freshness.',
    },
  },
  {
    id: 'vedernikov-krasnostop-rose', code: '10502', image: 'vedernikov-krasnostop-rose.png',
    name: 'Krasnostop Rosé', category: 'rose',
    producer: { ru: 'Ведерниковъ', en: 'Vedernikov' },
    region:   { ru: 'Долина Дона', en: 'Don Valley' },
    grape:    { ru: '100% Красностоп Золотовский', en: '100% Krasnostop Zolotovsky' },
    abv: '12%',
    note: {
      ru: 'Живое розе — клубника, зефир и ягодный сорбет, шелковистый финиш.',
      en: 'A vibrant rosé — strawberry, marshmallow and berry sorbet, a silky finish.',
    },
  },

  // ─── VODKA ────────────────────────────────────────────────────────────────
  {
    id: 'czars-gold', code: '10250', image: 'czars-gold.png',
    name: "Czar's Gold", category: 'vodka',
    producer: { ru: 'Ladoga', en: 'Ladoga' },
    region:   { ru: 'Санкт-Петербург', en: 'St. Petersburg' },
    grape:    { ru: 'Озимая пшеница · 0.7 л', en: 'Winter wheat · 0.7 L' },
    abv: '40%',
    note: {
      ru: 'Люксовая водка из коллекции Imperial Collection Gold — мягкая, чистая, зерновая сладость.',
      en: 'A luxury vodka from the Imperial Collection Gold range — soft, clean, grainy sweetness.',
    },
  },
  {
    id: 'czars-original', code: '10252', image: 'czars-original.png',
    name: "Czar's Original", category: 'vodka',
    producer: { ru: 'Ladoga', en: 'Ladoga' },
    region:   { ru: 'Санкт-Петербург', en: 'St. Petersburg' },
    grape:    { ru: 'Зерновой спирт · 0.7 л', en: 'Grain spirit · 0.7 L' },
    abv: '40%',
    note: {
      ru: 'Супер-премиум водка по историческому рецепту эпохи Петра Великого — гладкая и нейтральная.',
      en: 'A super-premium vodka from a Peter-the-Great-era recipe — smooth and neutral.',
    },
  },
  {
    id: 'ladoga-vodka', code: '10254', image: 'ladoga-vodka.png',
    name: 'Ladoga Premium', category: 'vodka',
    producer: { ru: 'Ladoga', en: 'Ladoga' },
    region:   { ru: 'Санкт-Петербург', en: 'St. Petersburg' },
    grape:    { ru: 'Зерновой спирт · 0.7 л', en: 'Grain spirit · 0.7 L' },
    abv: '40%',
    note: {
      ru: 'Премиальная водка от Ladoga Group — чистая, мягкая, в чистом виде и в коктейлях.',
      en: 'A premium vodka by Ladoga Group — clean and soft, neat or in cocktails.',
    },
  },

  // ─── GIN — the full Barrister line ────────────────────────────────────────
  {
    id: 'barrister-dry', code: '10255', image: 'barrister-dry-gin.png',
    name: 'Barrister Dry', category: 'gin', bestseller: true,
    producer: { ru: 'Barrister', en: 'Barrister' },
    region:   { ru: 'Россия · 0.7 л', en: 'Russia · 0.7 L' },
    grape:    { ru: 'Классический London Dry', en: 'Classic London Dry' },
    abv: '40%',
    note: {
      ru: 'Классический сухой джин на можжевельнике и специях.',
      en: 'A classic juniper-and-spice dry gin.',
    },
  },
  {
    id: 'barrister-pink', code: '10257', image: 'barrister-pink-gin.png',
    name: 'Barrister Pink', category: 'gin',
    producer: { ru: 'Barrister', en: 'Barrister' },
    region:   { ru: 'Россия · 0.7 л', en: 'Russia · 0.7 L' },
    grape:    { ru: 'Ароматизированный джин', en: 'Flavoured gin' },
    abv: '40%',
    note: {
      ru: 'Нежно-розовый, на красных ягодах — клубника и лёгкая сладость.',
      en: 'Soft pink, berry-infused — strawberry and a gentle sweetness.',
    },
  },
  {
    id: 'barrister-blue', code: '10256', image: 'barrister-blue-gin.png',
    name: 'Barrister Blue', category: 'gin',
    producer: { ru: 'Barrister', en: 'Barrister' },
    region:   { ru: 'Россия · 0.7 л', en: 'Russia · 0.7 L' },
    grape:    { ru: 'Ароматизированный джин', en: 'Flavoured gin' },
    abv: '40%',
    note: {
      ru: 'Цитрус и травы, насыщенный синий цвет — меняет оттенок в тонике.',
      en: 'Citrus and herbs, a deep blue that shifts colour in tonic.',
    },
  },
  {
    id: 'barrister-absinthium', code: '10571', image: null,
    name: 'Barrister Absinthium', category: 'gin',
    producer: { ru: 'Barrister', en: 'Barrister' },
    region:   { ru: 'Россия · 0.7 л', en: 'Russia · 0.7 L' },
    grape:    { ru: 'Ароматизированный джин', en: 'Flavoured gin' },
    abv: '40%',
    note: {
      ru: 'С полынью и анисом — пряный, в духе абсента.',
      en: 'With wormwood and anise — spiced, absinthe-leaning.',
    },
  },
  {
    id: 'barrister-mumbai', code: '10570', image: null,
    name: 'Barrister Mumbai', category: 'gin',
    producer: { ru: 'Barrister', en: 'Barrister' },
    region:   { ru: 'Россия · 0.7 л', en: 'Russia · 0.7 L' },
    grape:    { ru: 'Ароматизированный джин', en: 'Flavoured gin' },
    abv: '40%',
    note: {
      ru: 'Тёплые индийские специи — насыщенный и пряный.',
      en: 'Warm Indian spices — rich and aromatic.',
    },
  },
  {
    id: 'barrister-sloe', code: '10573', image: null,
    name: 'Barrister Sloe', category: 'gin',
    producer: { ru: 'Barrister', en: 'Barrister' },
    region:   { ru: 'Россия · 0.7 л', en: 'Russia · 0.7 L' },
    grape:    { ru: 'Ликёрный джин', en: 'Sloe gin' },
    abv: '40%',
    note: {
      ru: 'На ягодах тёрна — тёмный, сладко-терпкий.',
      en: 'Sloe-berry — dark, sweet and tart.',
    },
  },
  {
    id: 'barrister-tropical', code: '10572', image: null,
    name: 'Barrister Tropical', category: 'gin',
    producer: { ru: 'Barrister', en: 'Barrister' },
    region:   { ru: 'Россия · 0.7 л', en: 'Russia · 0.7 L' },
    grape:    { ru: 'Ароматизированный джин', en: 'Flavoured gin' },
    abv: '40%',
    note: {
      ru: 'Тропические фрукты — сочный и солнечный.',
      en: 'Tropical fruit — juicy and sunny.',
    },
  },
  {
    id: 'barrister-wildberry', code: '10581', image: null,
    name: 'Barrister Wild Berry', category: 'gin',
    producer: { ru: 'Barrister', en: 'Barrister' },
    region:   { ru: 'Россия · 0.7 л', en: 'Russia · 0.7 L' },
    grape:    { ru: 'Ароматизированный джин', en: 'Flavoured gin' },
    abv: '40%',
    note: {
      ru: 'Лесные ягоды — яркий и ароматный.',
      en: 'Forest berries — bright and aromatic.',
    },
  },
]
