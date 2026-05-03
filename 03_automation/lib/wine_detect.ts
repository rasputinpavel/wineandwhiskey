// Shared wine grape / region detection used by wine_breakdown.ts and build_purchase_matrix.ts.
// Keep regex updates here so both scripts stay in sync.

export type Grape =
  | "Chardonnay"
  | "Sauvignon Blanc"
  | "Pinot Gris"
  | "Pinot Grigio"
  | "Riesling"
  | "Gewürztraminer"
  | "Grüner Veltliner"
  | "Albariño / Alvarinho"
  | "Verdejo"
  | "Vinho Verde (купаж)"
  | "Vermentino"
  | "Viognier"
  | "Sémillon"
  | "Chenin Blanc"
  | "Cortese (Gavi)"
  | "Moscato / Muscat"
  | "Assyrtiko"
  | "Furmint"
  | "Garganega (Soave)"
  | "Trebbiano"
  | "Ркацители"
  | "Прочее / Купаж";

export const GRAPE_ORDER: Grape[] = [
  "Chardonnay", "Sauvignon Blanc", "Pinot Grigio", "Pinot Gris",
  "Riesling", "Gewürztraminer", "Grüner Veltliner",
  "Albariño / Alvarinho", "Verdejo", "Vinho Verde (купаж)",
  "Vermentino", "Viognier", "Sémillon", "Chenin Blanc",
  "Cortese (Gavi)", "Moscato / Muscat", "Assyrtiko", "Furmint",
  "Garganega (Soave)", "Trebbiano", "Ркацители",
  "Прочее / Купаж",
];

export function detectGrape(name: string): Grape {
  const n = name.toLowerCase();
  if (/pinot\s*grigio|пино\s*гриджио/.test(n))                                   return "Pinot Grigio";
  if (/pinot\s*gris|пино\s*гри/.test(n))                                          return "Pinot Gris";
  if (/sa[uv]+(?:i|in|)g[no]+n?\s*blan[ck]?|\bsauv\w{0,4}gnon\b|\bsauvingon\b|\bsavignon\b|совиньон\s*блан|совиньон-блан|совиньонблан/.test(n)) return "Sauvignon Blanc";
  if (/\bsauvignon\b/.test(n))                                                    return "Sauvignon Blanc";
  if (/cha[rd]+onn?ay|шардоне/.test(n))                                           return "Chardonnay";
  if (/riesling|risling|rissen|рислинг/.test(n))                                  return "Riesling";
  if (/gew(?:ü|u|ur)rzt?raminer|гевюрц/.test(n))                                  return "Gewürztraminer";
  if (/gr(?:ü|u|uv)ner\s*velt|grüner|gruner|грюнер/.test(n))                      return "Grüner Veltliner";
  if (/albari[ñn]o|alvarinho|альвариньо|альбариньо/.test(n))                      return "Albariño / Alvarinho";
  if (/verdejo|вердехо/.test(n))                                                  return "Verdejo";
  if (/vin[hr]?o\s+verde|винью\s+верде/.test(n))                                  return "Vinho Verde (купаж)";
  if (/vermentino|верментино/.test(n))                                            return "Vermentino";
  if (/viognier|вионье|condrieu|кондрие/.test(n))                                 return "Viognier";
  if (/s[ée]millon|семильон|sauternes|сотерн/.test(n))                            return "Sémillon";
  if (/chenin\s*blanc|шенен\s*блан|vouvray/.test(n))                              return "Chenin Blanc";
  if (/\bgavi\b|cortese|кортезе|гави/.test(n))                                    return "Cortese (Gavi)";
  if (/moscato|мускат|muscat\b/.test(n))                                          return "Moscato / Muscat";
  if (/assyrtiko|ассиртико/.test(n))                                              return "Assyrtiko";
  if (/furmint|фурминт|tokaji|tokay|токай/.test(n))                               return "Furmint";
  if (/\bsoave\b|garganega|гарганега|соаве/.test(n))                              return "Garganega (Soave)";
  if (/trebbiano|треббьяно/.test(n))                                              return "Trebbiano";
  if (/rkatsiteli|ркацител|tsinandali|цинандали/.test(n))                         return "Ркацители";
  if (/sancerre|сансер|pouilly[\-\s]?fum[ée]|пуйи[\-\s]?фюме|менет[уоy]|menetou[\-\s]?salon|quincy|reuilly/.test(n)) return "Sauvignon Blanc";
  if (/chablis|шабли|meursault|мерсо|pouilly[\-\s]?fuiss[ée]|пуйи[\-\s]?фюисе|saint[\-\s]?v[ée]ran|st[\-\s]?v[ée]ran|puligny[\-\s]?montrachet|chassagne[\-\s]?montrachet|m[âa]con|макон|montrachet|p[ée]ti[ts]?\s+chablis|bourgogne\s+blanc|aligot[ée]|алиготе/.test(n)) return "Chardonnay";
  return "Прочее / Купаж";
}

export type RedCountry =
  | "Франция" | "Италия" | "Испания" | "Португалия"
  | "Аргентина" | "Чили" | "США" | "Австралия" | "Новая Зеландия"
  | "ЮАР" | "Германия" | "Австрия" | "Грузия" | "Молдова"
  | "Греция" | "Венгрия" | "Болгария" | "Кипр" | "Ливан"
  | "Прочее / Не определено";

export const RED_COUNTRY_ORDER: RedCountry[] = [
  "Франция", "Италия", "Испания", "Португалия",
  "Аргентина", "Чили", "США", "Австралия", "Новая Зеландия", "ЮАР",
  "Германия", "Австрия", "Грузия", "Молдова",
  "Греция", "Венгрия", "Болгария", "Кипр", "Ливан",
  "Прочее / Не определено",
];

interface RegionRule {
  country: RedCountry;
  region: string;
  pattern: RegExp;
}

const RED_REGION_RULES: RegionRule[] = [
  { country: "Франция", region: "Бордо",          pattern: /\bbordeaux\b|\bbordo\b|бордо/i },
  { country: "Франция", region: "Бордо",          pattern: /\bsaint[\-\s]?(?:emili|émili)on|st[\-\s]?emili|сент[\-\s]?эмиль/i },
  { country: "Франция", region: "Бордо",          pattern: /\bpomerol|помероль/i },
  { country: "Франция", region: "Бордо",          pattern: /\bmargaux|марго/i },
  { country: "Франция", region: "Бордо",          pattern: /\bpauillac|пойяк|пойак/i },
  { country: "Франция", region: "Бордо",          pattern: /\bsaint[\-\s]?julien|сен[\-\s]?жульен/i },
  { country: "Франция", region: "Бордо",          pattern: /\bsaint[\-\s]?est[èe]phe|сент[\-\s]?эстеф/i },
  { country: "Франция", region: "Бордо",          pattern: /\bhaut[\-\s]?m[ée]doc|haut[\-\s]?medoc/i },
  { country: "Франция", region: "Бордо",          pattern: /\bm[ée]doc\b/i },
  { country: "Франция", region: "Бордо",          pattern: /\bgraves\b/i },
  { country: "Франция", region: "Бордо",          pattern: /\bpessac[\-\s]?l[ée]ognan/i },
  { country: "Франция", region: "Бордо",          pattern: /\bsauternes|сотерн/i },
  { country: "Франция", region: "Бордо",          pattern: /\blalande[\-\s]?de[\-\s]?pomerol/i },
  { country: "Франция", region: "Бордо",          pattern: /\bcanon[\-\s]?fronsac|fronsac/i },
  { country: "Франция", region: "Бордо",          pattern: /\bcru\s+bourgeois|grand\s+cru\s+class[ée]/i },
  { country: "Франция", region: "Бургундия",       pattern: /\bbourgogne|бургунд/i },
  { country: "Франция", region: "Бургундия",       pattern: /\bbeaujolais|божоле/i },
  { country: "Франция", region: "Бургундия",       pattern: /\bchablis|шабли/i },
  { country: "Франция", region: "Бургундия",       pattern: /\bgevrey[\-\s]?chambertin|жевре[\-\s]?шамберт/i },
  { country: "Франция", region: "Бургундия",       pattern: /\bpommard|поммар/i },
  { country: "Франция", region: "Бургундия",       pattern: /\bvolnay|вольне/i },
  { country: "Франция", region: "Бургундия",       pattern: /\bmeursault|мерсо/i },
  { country: "Франция", region: "Бургундия",       pattern: /\bmercurey|меркюре/i },
  { country: "Франция", region: "Бургундия",       pattern: /\bmonthelie/i },
  { country: "Франция", region: "Бургундия",       pattern: /\bsaint[\-\s]?aubin/i },
  { country: "Франция", region: "Бургундия",       pattern: /\bnuits[\-\s]?saint[\-\s]?georges/i },
  { country: "Франция", region: "Бургундия",       pattern: /\bvosne[\-\s]?roman[ée]e/i },
  { country: "Франция", region: "Бургундия",       pattern: /\bpouilly[\-\s]?fuiss[ée]/i },
  { country: "Франция", region: "Бургундия",       pattern: /\bchassagne[\-\s]?montrachet|puligny[\-\s]?montrachet/i },
  { country: "Франция", region: "Бургундия",       pattern: /\bsaint[\-\s]?v[ée]ran|st[\-\s]?veran/i },
  { country: "Франция", region: "Бургундия",       pattern: /\bcot[ée]\s+de\s+(?:nuits|beaune)/i },
  { country: "Франция", region: "Рона",            pattern: /c[oô]tes?[\-\s]?du[\-\s]?rh[oô]ne|кот[\-\s]?дю[\-\s]?рон/i },
  { country: "Франция", region: "Рона",            pattern: /ch[aâ]teauneuf[\-\s]?du[\-\s]?pape|шатонёф/i },
  { country: "Франция", region: "Рона",            pattern: /\bhermitage|эрмитаж/i },
  { country: "Франция", region: "Рона",            pattern: /\bcondrieu|кондрие/i },
  { country: "Франция", region: "Рона",            pattern: /\bgigondas|жигондас/i },
  { country: "Франция", region: "Рона",            pattern: /\bvacqueyras/i },
  { country: "Франция", region: "Рона",            pattern: /\bcornas|c[oô]te[\-\s]?r[oô]tie/i },
  { country: "Франция", region: "Луара",           pattern: /\bsancerre|сансер/i },
  { country: "Франция", region: "Луара",           pattern: /\bpouilly[\-\s]?fum[ée]/i },
  { country: "Франция", region: "Луара",           pattern: /\bbourgueil|бургей/i },
  { country: "Франция", region: "Луара",           pattern: /\bvouvray/i },
  { country: "Франция", region: "Луара",           pattern: /\bmuscadet/i },
  { country: "Франция", region: "Луара",           pattern: /\bchinon/i },
  { country: "Франция", region: "Луара",           pattern: /val[\-\s]?de[\-\s]?loire|loire\b/i },
  { country: "Франция", region: "Лангедок-Руссильон", pattern: /\bcorbi[èe]res|корбьер/i },
  { country: "Франция", region: "Лангедок-Руссильон", pattern: /\bminervois/i },
  { country: "Франция", region: "Лангедок-Руссильон", pattern: /\bpic[\-\s]?saint[\-\s]?loup/i },
  { country: "Франция", region: "Лангедок-Руссильон", pattern: /pays[\-\s]?d[\'\’]?oc|pay\'?d\'?oc/i },
  { country: "Франция", region: "Лангедок-Руссильон", pattern: /\bsaint[\-\s]?chinian/i },
  { country: "Франция", region: "Лангедок-Руссильон", pattern: /\bfaug[èe]res/i },
  { country: "Франция", region: "Лангедок-Руссильон", pattern: /\bcahors|каор/i },
  { country: "Франция", region: "Лангедок-Руссильон", pattern: /\bmadiran/i },
  { country: "Франция", region: "Лангедок-Руссильон", pattern: /\bgascogne/i },
  { country: "Франция", region: "Прованс",         pattern: /provence|прованс/i },
  { country: "Франция", region: "Эльзас",          pattern: /\balsace|эльзас/i },
  { country: "Франция", region: "Жюра",            pattern: /\bjura\b|c[oô]tes?\s+du\s+jura/i },
  { country: "Италия",  region: "Тоскана",         pattern: /\bchianti|кьянти/i },
  { country: "Италия",  region: "Тоскана",         pattern: /\bbrunello\s*(?:di\s+)?montalcino|брунелло/i },
  { country: "Италия",  region: "Тоскана",         pattern: /\bvino\s+nobile\s+di\s+montepulciano|nobile\s+di\s+montepulciano/i },
  { country: "Италия",  region: "Тоскана",         pattern: /\bbolgheri|больгери/i },
  { country: "Италия",  region: "Тоскана",         pattern: /\btoscana|toscano|тоскан/i },
  { country: "Италия",  region: "Тоскана",         pattern: /\bsassicaia|tignanello|ornellaia/i },
  { country: "Италия",  region: "Пьемонт",         pattern: /\bbarolo|бароло/i },
  { country: "Италия",  region: "Пьемонт",         pattern: /\bbarbaresco|барбареско/i },
  { country: "Италия",  region: "Пьемонт",         pattern: /\bbarbera|барбера/i },
  { country: "Италия",  region: "Пьемонт",         pattern: /\bnebbi[oa]l[oa]|неббиоло/i },
  { country: "Италия",  region: "Пьемонт",         pattern: /\blanghe|ланге/i },
  { country: "Италия",  region: "Пьемонт",         pattern: /\bgavi\b|гави/i },
  { country: "Италия",  region: "Пьемонт",         pattern: /\bpiemonte|пьемонт/i },
  { country: "Италия",  region: "Пьемонт",         pattern: /\bd['\’ ]?asti|d['\’ ]?alba\b/i },
  { country: "Италия",  region: "Пьемонт",         pattern: /\barneis|moscato\s+d['\’ ]?asti|dolcetto/i },
  { country: "Италия",  region: "Венето",          pattern: /\bamarone|амароне/i },
  { country: "Италия",  region: "Венето",          pattern: /\bvalpolicella|вальполич/i },
  { country: "Италия",  region: "Венето",          pattern: /\bripasso/i },
  { country: "Италия",  region: "Венето",          pattern: /\bsoave\b/i },
  { country: "Италия",  region: "Венето",          pattern: /\bvenez(?:ie|ia)|veneto|венеци|венето/i },
  { country: "Италия",  region: "Венето",          pattern: /\blugana/i },
  { country: "Италия",  region: "Сицилия",         pattern: /\bsicil[iy]a|сицил/i },
  { country: "Италия",  region: "Сицилия",         pattern: /\betna\b/i },
  { country: "Италия",  region: "Сицилия",         pattern: /\bnero\s*d[\'\’ ]?avola/i },
  { country: "Италия",  region: "Сицилия",         pattern: /\bcatarratto|grillo|frappato/i },
  { country: "Италия",  region: "Сардиния",        pattern: /\bsardegna|sardinia|сардин/i },
  { country: "Италия",  region: "Сардиния",        pattern: /\bcannonau|vermentino\s+di\s+sardegna/i },
  { country: "Италия",  region: "Апулия",          pattern: /\bpuglia|апули/i },
  { country: "Италия",  region: "Апулия",          pattern: /\bprimitivo|примитиво/i },
  { country: "Италия",  region: "Апулия",          pattern: /\bnegroamaro|неграмар/i },
  { country: "Италия",  region: "Апулия",          pattern: /\bsalice\s+salentino|salento/i },
  { country: "Италия",  region: "Апулия",          pattern: /\bmanduria|мандур/i },
  { country: "Италия",  region: "Апулия",          pattern: /\bnero\s+di\s+troia/i },
  { country: "Италия",  region: "Кампания",        pattern: /\bcampania|кампани/i },
  { country: "Италия",  region: "Кампания",        pattern: /\baglianico|альянико/i },
  { country: "Италия",  region: "Кампания",        pattern: /\btaurasi|таураси/i },
  { country: "Италия",  region: "Кампания",        pattern: /\birpinia|fiano|greco\s+di\s+tufo|piedirosso/i },
  { country: "Италия",  region: "Абруццо",         pattern: /\bmontepulciano\s+d[\'\’ ]?abruzzo|abruzzo|абруц/i },
  { country: "Италия",  region: "Марке",           pattern: /\bmarche|марке/i },
  { country: "Италия",  region: "Марке",           pattern: /\bverdicchio/i },
  { country: "Италия",  region: "Умбрия",          pattern: /\bumbria|умбри/i },
  { country: "Италия",  region: "Умбрия",          pattern: /\borvieto|sagrantino\s+di\s+montefalco/i },
  { country: "Италия",  region: "Лацио",           pattern: /\blazio|frascati|roma\s+doc/i },
  { country: "Италия",  region: "Фриули",          pattern: /\bfriuli|фриули/i },
  { country: "Италия",  region: "Трентино / Альто-Адидже", pattern: /\btrentin|alto[\-\s]?adige|dolomiti|альто[\-\s]?адидж/i },
  { country: "Италия",  region: "Эмилия-Романья",  pattern: /\blambrusco|emilia/i },
  { country: "Италия",  region: "Ломбардия",       pattern: /\blombardia|franciacorta/i },
  { country: "Италия",  region: "Италия (прочее)", pattern: /\bitalia\b|d['\’ ]?italia|итали/i },
  { country: "Испания", region: "Риоха",           pattern: /\brioja|риоха/i },
  { country: "Испания", region: "Рибера-дель-Дуэро", pattern: /\bribera\s+del\s+duero|рибер/i },
  { country: "Испания", region: "Приорат",         pattern: /\bpriorat/i },
  { country: "Испания", region: "Торо",            pattern: /\btoro\b/i },
  { country: "Испания", region: "Руэда",           pattern: /\brueda|руэда/i },
  { country: "Испания", region: "Риас Байшас",     pattern: /\br[ií]as\s+baixas|albari[ñn]o|альвариньо/i },
  { country: "Испания", region: "Галисия",         pattern: /\bgalicia|valdeorras|ribeira\s+sacra/i },
  { country: "Испания", region: "Пенедес / Каталония", pattern: /\bpenedes|catalunya|catalonia/i },
  { country: "Испания", region: "Юмилья / Хумилья", pattern: /\bjumilla|monastrell/i },
  { country: "Испания", region: "Аликанте",        pattern: /\balicante/i },
  { country: "Испания", region: "Утьель-Рекена",   pattern: /\butiel[\-\s]?requena/i },
  { country: "Испания", region: "Бьерсо",          pattern: /\bbierzo|menc[ií]a/i },
  { country: "Испания", region: "Ла-Манча",        pattern: /\bla\s+mancha|valdepe[ñn]as/i },
  { country: "Испания", region: "Валенсия",        pattern: /\bvalencia|tarima\s+mediterraneo/i },
  { country: "Испания", region: "Испания (прочее)", pattern: /\bespa[ñn]a|испан/i },
  { country: "Португалия", region: "Дору",         pattern: /\bdouro|дуро/i },
  { country: "Португалия", region: "Алентежу",     pattern: /\balentej[ao]|алентеж/i },
  { country: "Португалия", region: "Винью Верде",  pattern: /vinho\s+verde|винью\s+верде/i },
  { country: "Португалия", region: "Лиссабон",     pattern: /lisboa|lisbon|лиссабон/i },
  { country: "Португалия", region: "Дау",          pattern: /\bd[ãa]o\b/i },
  { country: "Португалия", region: "Сетубал",      pattern: /set[uú]bal/i },
  { country: "Португалия", region: "Португалия (прочее)", pattern: /portug[ua]l|португал|symington/i },
  { country: "Аргентина", region: "Мендоса",       pattern: /\bmendoza|мендоса/i },
  { country: "Аргентина", region: "Аргентина (прочее)", pattern: /\bargentin|аргентин/i },
  { country: "Чили",      region: "Майпо",          pattern: /\bmaipo/i },
  { country: "Чили",      region: "Колчагуа",       pattern: /\bcolchagua|колчагуа/i },
  { country: "Чили",      region: "Касабланка",     pattern: /\bcasablanca/i },
  { country: "Чили",      region: "Мауле",          pattern: /\bmaule|almaule/i },
  { country: "Чили",      region: "Чили (прочее)",  pattern: /\bchile\b|чили\b|carmenere|карменер/i },
  { country: "США",       region: "Напа",           pattern: /\bnapa|напа/i },
  { country: "США",       region: "Сонома",         pattern: /\bsonoma/i },
  { country: "США",       region: "Орегон",         pattern: /\boregon/i },
  { country: "США",       region: "Пасо Роблс",     pattern: /\bpaso\s+robles/i },
  { country: "США",       region: "Лоди",           pattern: /\blodi\b/i },
  { country: "США",       region: "Монтерей",       pattern: /\bmonterey|монтерей/i },
  { country: "США",       region: "Мендосино",      pattern: /\bmendocino/i },
  { country: "США",       region: "Колумбия",       pattern: /\bcolumbia\s+valley|red\s+mountain/i },
  { country: "США",       region: "Вашингтон",      pattern: /\bwashington\s+state/i },
  { country: "США",       region: "США (прочее)",   pattern: /\bcalifornia|калифорни|usa\b|\bu\.s\.a/i },
  { country: "Австралия", region: "Баросса",        pattern: /\bbarossa|барос/i },
  { country: "Австралия", region: "МакЛарен Вэйл",  pattern: /\bmcl?aren\s+vale/i },
  { country: "Австралия", region: "Кунаварра",      pattern: /\bcoonawarra/i },
  { country: "Австралия", region: "Маргарет Ривер", pattern: /margaret\s+river/i },
  { country: "Австралия", region: "Хантер Вэлли",   pattern: /hunter\s+valley/i },
  { country: "Австралия", region: "Ярра",           pattern: /\byarra/i },
  { country: "Австралия", region: "Лаймстоун Кост", pattern: /limestone\s+coast|padthaway/i },
  { country: "Австралия", region: "Австралия (прочее)", pattern: /\baustralia|австрали/i },
  { country: "Новая Зеландия", region: "Мальборо",  pattern: /\bmarlborough|мальбор/i },
  { country: "Новая Зеландия", region: "Хоукс Бей", pattern: /hawkes?\s+bay/i },
  { country: "Новая Зеландия", region: "Новая Зеландия (прочее)", pattern: /new\s+zealand|новая\s+зеланд/i },
  { country: "ЮАР",       region: "Стелленбош",     pattern: /\bstellenbosch/i },
  { country: "ЮАР",       region: "Свартланд",      pattern: /\bswartland/i },
  { country: "ЮАР",       region: "Уэстерн Кейп",   pattern: /western\s+cape|cape\s+town/i },
  { country: "ЮАР",       region: "ЮАР (прочее)",   pattern: /\bsouth\s+africa|pinotage|pinot[\-\s]?age/i },
  { country: "Германия",  region: "Мозель",         pattern: /\bmosel|мозель/i },
  { country: "Германия",  region: "Рейнгау",        pattern: /\brheingau|рейнгау/i },
  { country: "Германия",  region: "Пфальц",         pattern: /\bpfalz|пфальц/i },
  { country: "Германия",  region: "Рейнхессен",     pattern: /\brheinhessen/i },
  { country: "Германия",  region: "Германия (прочее)", pattern: /\bdeutsch|german/i },
  { country: "Австрия",   region: "Вахау",          pattern: /\bwachau/i },
  { country: "Австрия",   region: "Австрия (прочее)", pattern: /\baustria|moser\s+weine|niederosterreich/i },
  { country: "Грузия",    region: "Кахетия",        pattern: /\bkakheti|кахет/i },
  { country: "Грузия",    region: "Кахетия",        pattern: /saperavi|сапервави|сапер/i },
  { country: "Грузия",    region: "Кахетия",        pattern: /kindzmarauli|киндзм/i },
  { country: "Грузия",    region: "Кахетия",        pattern: /tsinandali|цинандал/i },
  { country: "Грузия",    region: "Кахетия",        pattern: /rkatsiteli|ркацител/i },
  { country: "Грузия",    region: "Кахетия",        pattern: /qvevri|квеври/i },
  { country: "Грузия",    region: "Грузия (прочее)", pattern: /\bgeorgia|askaneli|грузия/i },
  { country: "Греция",    region: "Греция",         pattern: /\bgreek|greece|retsina|assyrtiko|греци|санторин|santorini/i },
  { country: "Кипр",      region: "Кипр",           pattern: /\bcyprus|kypros|кипр/i },
  { country: "Ливан",     region: "Ливан",          pattern: /\blebanon|bekaa|ливан/i },
  { country: "Венгрия",   region: "Токай",          pattern: /\btokaji|tokay|токай/i },
  { country: "Венгрия",   region: "Венгрия (прочее)", pattern: /\bhungar|венгр/i },
  { country: "Болгария",  region: "Болгария",       pattern: /\bbulgar|болгар/i },
  { country: "Молдова",   region: "Молдова",        pattern: /\bmoldova|молдов/i },
  { country: "Аргентина", region: "Регион не указан", pattern: /\bmalbec|мальбек|малбек/i },
  { country: "США",       region: "Регион не указан", pattern: /\bzinfandel|зинфандель/i },
  { country: "Австралия", region: "Регион не указан", pattern: /\bshiraz\b|шираз/i },
  { country: "Испания",   region: "Регион не указан", pattern: /\btempranillo|темпранильо/i },
  { country: "Аргентина", region: "Мендоса",         pattern: /\bcatena\b|achaval\s*ferrer|susana\s+balbo|aleanna|el\s+enemigo|vistalba|aruma/i },
  { country: "Франция",   region: "Лангедок-Руссильон", pattern: /vignobles\s+vellas/i },
  { country: "Франция",   region: "Бургундия",       pattern: /\bpatriarche|domaine\s+aegerter|faiveley/i },
  { country: "США",       region: "Калифорния",      pattern: /coppola|caymus|silver\s+oak|stags\s*leap|joseph\s+phelps|chappellet|honig|duckhorn|gnarly\s+head|three\s+finger\s+jack|francis\s+coppola|stone\s+cellars|the\s+prisoner|adulation|j\.?\s*lohr|long\s+barn/i },
  { country: "Австралия", region: "Австралия (прочее)", pattern: /edenvale|reschke|langmeil|trentham|whistler|outstation|bandicoot|stonehaven|magarey|trinity\s+hill|bucher\s+thomas|two\s+hands|schild\s+estate|babich|frank\s+cabernet/i },
  { country: "Чили",      region: "Чили (прочее)",   pattern: /montgras|luz\s+chilena|punti\s+ferrer|antu\s+ninquen|terra\s+sagrada|teerra\s+sagrada|maturana|guimaro|concha\s+y\s+toro|joel\s+gott/i },
  { country: "Новая Зеландия", region: "Мальборо",   pattern: /kapuka|annalina|clearwater\s+cove|mataverde|petal.*stem|brightwater|harakeke|ant\s+moore|kono|villa\s+maria/i },
  { country: "Франция",   region: "Бордо",            pattern: /\bsain\s+emili|\bsain\s+julien|\bsain\s+est[ée]ph/i },
  { country: "Франция",   region: "Бордо",            pattern: /bordeaux\s+sup[ée]rieur|bordeaux\s+rouge|bordeaux\s+red|bordeaux\s+reserve|bordeaux\s+aoc/i },
  { country: "Италия",    region: "Венето",           pattern: /tenuta\s+sant['\’ ]?anna/i },
  { country: "Италия",    region: "Венето",           pattern: /colli\s+berici/i },
  { country: "Италия",    region: "Фриули",           pattern: /\breguta\b/i },
  { country: "Италия",    region: "Абруццо",          pattern: /cantina\s+tollo|tollo\s+gufo/i },
  { country: "Италия",    region: "Абруццо",          pattern: /\bmontepulciano\b/i },
  { country: "Италия",    region: "Тоскана",          pattern: /\bfontodi\b|tenuta\s+luce|le\s+volte\s+dell|le\s+serre\s+nuove|trinoro|petra\s+zingari|castello\s+di\s+ama|lucente.*la\s+vite|fontalloro|le\s+difese|frescobaldi/i },
  { country: "Италия",    region: "Сицилия",          pattern: /pietradolce|archineri|piccini\s+memoro/i },
  { country: "Италия",    region: "Умбрия",           pattern: /sagrantino|sargrantino|montefalco/i },
  { country: "Италия",    region: "Трентино / Альто-Адидже", pattern: /cantina\s+terlan|elena\s+walch|st\.?\s+michael\s+eppan|cembra/i },
  { country: "Италия",    region: "Ломбардия",        pattern: /valtellina|valgella|sandro\s+fay/i },
  { country: "Италия",    region: "Пьемонт",          pattern: /\bgaja\b|borgogno|chiarlo|produttori\s+del\s+barbaresco|viberti/i },
  { country: "Португалия", region: "Португалия (прочее)", pattern: /confidencial|jose\s+maria\s+da\s+fonseca|niepoort/i },
  { country: "Испания",   region: "Риоха",            pattern: /muriel|cvne|el\s+jardin\s+de\s+la\s+emperatriz|manzanos\s+crianza|berceo\s+tempranillo|alejandro\s+fernandez|arzuaga|macan\s+clasico|raul\s+perez|dominio\s+de\s+pingus/i },
  { country: "Испания",   region: "Рибера-дель-Дуэро", pattern: /montecastro|protos\b/i },
  { country: "Аргентина", region: "Мендоса",          pattern: /\bvaso\b|tilia\s+malbec|alamos|ojo\s+de\s+agua|cheval\s+des\s+andes|garzon|adrianna\s+fortuna|noemia/i },
  { country: "ЮАР",       region: "Стелленбош",        pattern: /kanonkop|nederburg|rickety\s+bridge|eikendal|roodeberg/i },
  { country: "Новая Зеландия", region: "Мальборо",    pattern: /\btohu\b|awatere\s+valley/i },
  { country: "Австралия", region: "Тасмания",         pattern: /calrossie/i },
  { country: "Австралия", region: "Австралия (прочее)", pattern: /penfolds|torbreck|rockford|pertaringa/i },
  { country: "США",       region: "Калифорния",       pattern: /murphy\s+goode|jordan\s+winery|martin\s+ray|au\s+bon\s+climat|dashe\s+cellars|alexander\s+valley|napa\s+valley|stags?\s+leap|melka|elizabeth\s+spencer|tor\s+oakville|bella\s+union|coup\s+de\s+foudre|freemark\s+abbey|far\s+niente|shafer|pine\s+ridge|louis\s+martini|heitz\s+cellar|1924\s+double\s+black|three\s+finger\s+jack|stone\s+cellars|the\s+wanted/i },
  { country: "США",       region: "Орегон",           pattern: /willamette/i },
  { country: "Франция",   region: "Бургундия",        pattern: /aegerter|nuiton|robert\s+chevillon|chassagne|domaine\s+parent|domaine\s+l['\’ ]?(?:ambert|l)\s+pavelot|stephane\s+ogier|ziereisen|borgogne|nuits[\-\s]?st[\-\s]?georges/i },
  { country: "Франция",   region: "Лангедок-Руссильон", pattern: /producteurs\s+reunis|vache\s+d['\’ ]?automne|domaine\s+fondreche|tertre|beaurempart|le\s+king|aubert\s*&?\s*mathieu/i },
  { country: "Франция",   region: "Бордо",            pattern: /clerc\s+milon|alter\s+ego|le\s+marquis\s+de\s+calon|d['\’ ]?armailhac|les\s+hauts\s+de\s+smith|fugue\s+de\s+nenin/i },
  { country: "Франция",   region: "Рона",             pattern: /domaine\s+jume/i },
  { country: "Франция",   region: "Луара",            pattern: /arnaud\s+lambert|saumur|florian\s+mollet|florina\s+mollet/i },
  { country: "Франция",   region: "Савойя",           pattern: /\bsavoie|domaine\s+curtet|frisson\s+des\s+cimes|mondeuse/i },
  { country: "Кипр",      region: "Кипр",              pattern: /\bothello\b/i },
  { country: "Франция",   region: "Франция (прочее)",  pattern: /\bch[âa]teau\b/i },
];

export function detectRedCountryRegion(name: string): { country: RedCountry; region: string } {
  for (const rule of RED_REGION_RULES) {
    if (rule.pattern.test(name)) return { country: rule.country, region: rule.region };
  }
  return { country: "Прочее / Не определено", region: "Не определено" };
}
