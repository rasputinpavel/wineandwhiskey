---
name: nbp-skill
description: Nano Banana Pro (Gemini 3 Pro Image) prompt engineering skill. Use for AI image generation, visual synthesis, infographics, diagrams, presentation slides, image editing/colorization, text rendering, character consistency, 2D↔3D conversion, storyboards, product photography. Triggers on requests for AI-generated images, Nano Banana Pro, Gemini image model, visual content creation.
---

# Nano Banana Pro

NBP is a "Thinking" model - understands intent, physics, composition. Built on Gemini 3 Pro's reasoning.

## Quick Start

```
Create a [TYPE] for [CONTEXT].
[STYLE description]
[MAIN ELEMENT with position, lighting]
Text: "[EXACT TEXT]" in [weight], [position]
Format: [ASPECT RATIO]
```

## Reference Router

| Task | Read |
|------|------|
| First time / core principles | [golden-rules.md](references/golden-rules.md) |
| Structured prompt creation, task types | [prompt-framework.md](references/prompt-framework.md) |
| Text, infographics, diagrams, data viz | [text-rendering.md](references/text-rendering.md) |
| Presentation slides, deck visuals | [slides.md](references/slides.md) |
| Edit, remove, colorize, restore images | [editing.md](references/editing.md) |
| Same character across images, thumbnails | [characters.md](references/characters.md) |
| 2D→3D, floor plans, meme conversion | [dimensional.md](references/dimensional.md) |
| Storyboards, sequential art, concept art | [storyboards.md](references/storyboards.md) |
| Sketch→final, wireframes, grids | [structural.md](references/structural.md) |

## Anti-Patterns

- ❌ Tag soup: "cool, modern, 4k"
- ❌ External refs: "like Apple"
- ❌ Vague colors: "dark green" → use #228b22
- ❌ Re-roll when 80% correct → edit instead
- ❌ Lens parameters (50mm, f/2.8) → NBP ignores these

## Advanced: JSON Structure

Для сложных сцен с множеством деталей - используй JSON:

```json
{
  "subject": {
    "description": "main subject description",
    "expression": "emotion/pose",
    "clothing": { "top": {}, "bottom": {} }
  },
  "accessories": {
    "jewelry": [],
    "props": []
  },
  "photography": {
    "angle": "eye-level",
    "shot_type": "waist-up",
    "aspect_ratio": "16:9"
  },
  "background": {
    "setting": "location",
    "lighting": "soft natural"
  }
}
```

Когда использовать: fashion shots, product scenes, детальные интерьеры, сложная композиция с 5+ элементами.
