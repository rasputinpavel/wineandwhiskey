# Cat Party — Suno jingle prompts (two, для A/B)

Оба джингла инструментальные (без вокала — чтобы не спорить с текстом на карточках),
короткие, с нарастанием и **пиком-дропом ровно на CTA-карточке в конце**. Ролик ~9с,
но генерь ~20–25с — скрипт сам обрежет и повесит фейды (см. `build_cat_montage.py`,
`AUDIO_START`). Экспортируй mp3 в:

- Вариант А → `assets/audio/cat_house.mp3`
- Вариант Б → `assets/audio/cat_meme.mp3`

Суффикс джингла в имени финалки берётся из этих названий (`house` / `meme`).

---

## Вариант А — «House Drop» (тропикал-хаус, праздничный, дорогой)

**Style prompt (в поле Style/Genre, режим Instrumental = ON):**

```
Upbeat tropical house party jingle, festive and premium, 120 BPM,
four-on-the-floor kick, bright plucky marimba and steel-drum synth,
sunny piano stabs, shakers and claps, a short rising build with a riser
and snare-roll leading into ONE punchy euphoric drop at the very end,
clean radio-ready commercial mix, celebratory summer beach-party energy,
instrumental, no vocals.
```

**Structure hint (в поле Lyrics оставь пустым или впиши только теги):**

```
[Intro] light plucks, 2 sec
[Build] add claps + riser, tension rising
[Drop] full euphoric party drop — this is the CTA moment
[Outro] one clean tail hit
```

Цель: дроп приходит на «CURATED DRINKS FOR YOUR PARTY» / «НАПИТКИ… ПОД КЛЮЧ».

---

## Вариант Б — «Meme Bounce» (игривый, смешной, под котов)

**Style prompt (Instrumental = ON):**

```
Playful bouncy comedic pop jingle, quirky and cute, 128 BPM,
pizzicato strings, marimba, bouncy tuba/wood-bass, cheeky whistling hook,
hand claps and finger snaps, glockenspiel, cartoon-comedy energy, light and
hooky, builds to a fun cheerful button hit at the very end, clean commercial
mix, meme-friendly, instrumental, no vocals.
```

**Structure hint:**

```
[Intro] whistle + pizzicato, cheeky
[Build] add claps + marimba run
[Peak] bright cheerful hit — the CTA moment
[Outro] short comedic button (boop)
```

Цель: совпасть по духу с смешными 3D-котами, легко «прилипает».

---

## Вариант В — «Club Drive» (движовый, мощно-взрослый, под реалистичных котов)

**Style prompt (Instrumental = ON):**

```
Driving adult afro-house / tech-house party track, powerful and grown-up,
124 BPM, deep rolling sub-bass, punchy club kick, tight percussion and
congas, hypnotic synth pluck riff, filtered build with a riser and a big
confident drop at the very end, dark-gold nighttime rooftop-party energy,
sophisticated and sexy, festival main-stage power, clean loud commercial
master, instrumental, no vocals.
```

**Structure hint:**

```
[Intro] deep bass + percussion groove
[Build] filter sweep + riser, tension climbing
[Drop] big confident club drop — the CTA moment
[Outro] one clean tail
```

Цель: взрослая клубная энергия, чтобы креатив читался как тусовка 20+, а не
детский праздник. → сохранить как `assets/audio/cat_club.mp3`

---

### После генерации
Положи оба mp3 по путям выше и запусти сборку — скрипт соберёт по 2 джингла ×
RU/EN × stv/fv для каждой анимации. Пока mp3 нет — скрипт собирает немые версии.
