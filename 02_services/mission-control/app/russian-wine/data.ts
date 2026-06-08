// Curated Russian wine & spirits catalog for the festival landing page.
// Descriptive copy is grounded in the Harvest supplier catalog
// (.inbox/Suppliers/Harvest/Russian Wine Harvest price (1).pdf) — region, grape
// and ABV are factual; tasting notes are concise and varietal-typical.
// No retail prices here on purpose: the supplier list is ex-VAT wholesale, so
// the landing introduces the wines and sends people to the store / WhatsApp.

export type Lang = 'ru' | 'en'
export type Loc = Record<Lang, string>

export type Category = 'sparkling' | 'red' | 'white' | 'rose' | 'spirit'

export type Bottle = {
  id: string
  image: string            // file in /public/brand/products/
  name: string             // brand-neutral, kept in latin for both langs
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
  spirit:    { ru: 'Крепкие напитки', en: 'Spirits' },
}

export const CATEGORY_ORDER: Category[] = ['sparkling', 'red', 'white', 'rose', 'spirit']

export const BOTTLES: Bottle[] = [
  // ─── SPARKLING ────────────────────────────────────────────────────────────
  {
    id: 'dravigny-brut', image: 'abrau-durso-victor-dravigny-brut.png',
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
    id: 'reserve-brut', image: 'abrau-durso-reserve-brut.png',
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
    id: 'cuvee-alexander-brut', image: 'aristov-cuvee-alexander-brut.png',
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
    id: 'alexander-ii-vintage', image: 'abrau-durso-alexander-ii-brut-vintage.png',
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
    id: 'brut-dor-bdn', image: 'abrau-durso-brut-dor-blanc-de-noir.png',
    name: "Brut d'Or Blanc de Noir", category: 'sparkling',
    producer: { ru: 'Абрау-Дюрсо', en: 'Abrau-Durso' },
    region:   { ru: 'Долина Абрау, Тамань', en: 'Abrau valley, Taman' },
    grape:    { ru: '100% Пино Нуар', en: '100% Pinot Noir' },
    abv: '12.5%',
    note: {
      ru: 'Блан-де-нуар одного участка — тельность, красные ягоды и бриошь.',
      en: 'Single-vineyard blanc de noir — body, red berries and brioche.',
    },
  },
  {
    id: 'dravigny-rose', image: 'abrau-durso-victor-dravigny-rose.png',
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
    id: 'tamagne-cabernet-reserve', image: 'chateau-tamagne-cabernet-reserve.png',
    name: 'Cabernet Reserve', category: 'red', bestseller: true,
    producer: { ru: 'Шато Тамань', en: 'Château Tamagne' },
    region:   { ru: 'Тамань', en: 'Taman Peninsula' },
    grape:    { ru: '100% Каберне Совиньон', en: '100% Cabernet Sauvignon' },
    abv: '12–14%',
    note: {
      ru: 'Выдержка 12 месяцев в дубе — чёрная смородина, специи и мягкий танин.',
      en: '12 months in oak — blackcurrant, spice and a soft tannin.',
    },
  },
  {
    id: 'tamagne-saperavi-reserve', image: 'chateau-tamagne-saperavi-reserve.png',
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
    id: 'tamagne-krasnostop-2016', image: 'chateau-tamagne-krasnostop-reserve-2016.png',
    name: 'Krasnostop Reserve 2016', category: 'red',
    producer: { ru: 'Шато Тамань', en: 'Château Tamagne' },
    region:   { ru: 'Тамань', en: 'Taman Peninsula' },
    grape:    { ru: '100% Красностоп Анапский', en: '100% Krasnostop Anapskiy' },
    abv: '14%',
    note: {
      ru: 'Автохтон Кубани — 12 месяцев в дубе и 48 в бутылке: зрелая вишня, кожа и табак.',
      en: 'A Kuban native grape — 12 months in oak, 48 in bottle: ripe cherry, leather and tobacco.',
    },
  },
  {
    id: 'aristov-cabernet', image: 'aristov-cabernet-sauvignon.png',
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
    id: 'sikory-cabernet-family', image: 'sikory-cabernet-family-reserve.png',
    name: 'Cabernet Sauvignon Family Reserve', category: 'red',
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
    id: 'vedernikov-krasnostop-oak', image: 'vedernikov-krasnostop-zolotovsky-oak.png',
    name: 'Krasnostop Zolotovsky · Oak Aged', category: 'red',
    producer: { ru: 'Ведерниковъ', en: 'Vedernikov' },
    region:   { ru: 'Долина Дона', en: 'Don Valley' },
    grape:    { ru: '100% Красностоп Золотовский', en: '100% Krasnostop Zolotovsky' },
    abv: '14.5%',
    note: {
      ru: 'Донской автохтон, 16 месяцев во французском дубе — вишнёвый джем, чернослив, дым и ваниль.',
      en: 'A native Don grape, 16 months in French oak — cherry jam, prune, smoke and vanilla.',
    },
  },
  {
    id: 'tamagne-nude-saperavi', image: 'chateau-tamagne-nude-saperavi.png',
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
    id: 'tamagne-premier-rouge', image: 'chateau-tamagne-premier-rouge-reserve.png',
    name: 'Premier Rouge Reserve', category: 'red',
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
    id: 'tamagne-grape-dance-blanc', image: 'chateau-tamagne-grape-dance-blanc.png',
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
    id: 'aristov-riesling', image: 'aristov-riesling.png',
    name: 'Riesling', category: 'white', bestseller: true,
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
    id: 'visokiy-gruner', image: 'visokiy-bereg-gruner-veltliner.png',
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
    id: 'abrau-chardonnay', image: 'abrau-durso-chardonnay.png',
    name: 'Chardonnay', category: 'white',
    producer: { ru: 'Абрау-Дюрсо', en: 'Abrau-Durso' },
    region:   { ru: 'Долина Абрау, Тамань', en: 'Abrau valley, Taman' },
    grape:    { ru: '100% Шардоне', en: '100% Chardonnay' },
    abv: '12%',
    note: {
      ru: 'Тихое шардоне из коллекции премиальных вин — спелое яблоко и лёгкая сливочность.',
      en: 'A still chardonnay from the premium still range — ripe apple and a touch of cream.',
    },
  },
  {
    id: 'vedernikov-sibirkovyi', image: 'vedernikov-sibirkovyi.png',
    name: 'Sibirkovyi', category: 'white',
    producer: { ru: 'Ведерниковъ', en: 'Vedernikov' },
    region:   { ru: 'Долина Дона', en: 'Don Valley' },
    grape:    { ru: '100% Сибирьковый', en: '100% Sibirkovyi' },
    abv: '12%',
    note: {
      ru: 'Редкий донской сорт — акация, лайм и зелёное яблоко, минеральный грейпфрутовый финиш.',
      en: 'A rare Don grape — acacia, lime and green apple, a mineral grapefruit finish.',
    },
  },

  // ─── ROSÉ ─────────────────────────────────────────────────────────────────
  {
    id: 'visokiy-graphite-rose', image: 'visokiy-bereg-graphite-rose.png',
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
    id: 'vedernikov-krasnostop-rose', image: 'vedernikov-krasnostop-rose.png',
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

  // ─── SPIRITS ──────────────────────────────────────────────────────────────
  {
    id: 'czars-gold', image: 'czars-gold.png',
    name: "Czar's Gold Vodka", category: 'spirit',
    producer: { ru: 'Ladoga', en: 'Ladoga' },
    region:   { ru: 'Санкт-Петербург', en: 'St. Petersburg' },
    grape:    { ru: 'Озимая пшеница · 4-кратная дистилляция', en: 'Winter wheat · quadruple-distilled' },
    abv: '40%',
    note: {
      ru: 'Люксовая водка из коллекции Imperial Collection Gold — мягкая, чистая, зерновая сладость.',
      en: 'A luxury vodka from the Imperial Collection Gold range — soft, clean, with grainy sweetness.',
    },
  },
  {
    id: 'czars-original', image: 'czars-original.png',
    name: "Czar's Original Vodka", category: 'spirit',
    producer: { ru: 'Ladoga', en: 'Ladoga' },
    region:   { ru: 'Санкт-Петербург', en: 'St. Petersburg' },
    grape:    { ru: 'Зерновой спирт · мульти-дистилляция', en: 'Grain spirit · multi-distilled' },
    abv: '40%',
    note: {
      ru: 'Супер-премиум водка по историческому рецепту эпохи Петра Великого — гладкая и нейтральная.',
      en: 'A super-premium vodka recreated from a Peter-the-Great-era recipe — smooth and neutral.',
    },
  },
  {
    id: 'ladoga-vodka', image: 'ladoga-vodka.png',
    name: 'Ladoga Premium Vodka', category: 'spirit',
    producer: { ru: 'Ladoga', en: 'Ladoga' },
    region:   { ru: 'Санкт-Петербург', en: 'St. Petersburg' },
    grape:    { ru: 'Зерновой спирт · тройная дистилляция', en: 'Grain spirit · triple-distilled' },
    abv: '40%',
    note: {
      ru: 'Премиальная водка от Ladoga Group — чистая, мягкая, для коктейлей и в чистом виде.',
      en: 'A premium vodka by Ladoga Group — clean and soft, neat or in cocktails.',
    },
  },
  {
    id: 'barrister-dry-gin', image: 'barrister-dry-gin.png',
    name: 'Barrister Dry Gin', category: 'spirit',
    producer: { ru: 'Barrister', en: 'Barrister' },
    region:   { ru: 'Россия', en: 'Russia' },
    grape:    { ru: 'Классический London Dry · 0.7 л', en: 'Classic London Dry · 0.7 L' },
    abv: '40%',
    note: {
      ru: 'Классический сухой джин на можжевельнике и специях. В магазине также Pink и Blue.',
      en: 'A classic juniper-and-spice dry gin. Pink and Blue editions also in store.',
    },
  },
]
