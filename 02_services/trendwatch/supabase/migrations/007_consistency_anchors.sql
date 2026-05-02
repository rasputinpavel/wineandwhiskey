-- Store the four "anchor" strings (subject / location / lighting / style) that
-- runway-prompts methodology bakes into every scene's prompt. Lets us reuse
-- them when re-running a brief or chaining last-frame inputs in image-to-video.

alter table trend_briefs add column if not exists consistency_anchors jsonb;
