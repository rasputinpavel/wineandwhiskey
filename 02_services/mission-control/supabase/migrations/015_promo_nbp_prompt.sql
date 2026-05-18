-- Phase 2.5: Claude-authored NBP prompts.
--
-- The Phase 3.5 visual renderer used two hardcoded prompt templates
-- (dark / light) shared across every promo. Result: generic backgrounds
-- that ignored theme, SKU, and composition — and ignored "no bottles"
-- because the prompt context was too generic.
--
-- Now Phase 2 (copy gen) also writes a bespoke NBP prompt per campaign
-- using the brief + design-system §5/§6 as cached context. The visual
-- pipeline reads this prompt instead of hardcoded templates.

alter table promo.campaign
  add column if not exists nbp_prompt text;

comment on column promo.campaign.nbp_prompt is
  'Bespoke Nano Banana Pro prompt written by Claude in Phase 2 from the brief + design-system §5/§6. Used by the visual pipeline to generate atmospheric backgrounds.';
