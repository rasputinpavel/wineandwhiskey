-- Persist Runway/ffmpeg failure messages so the UI can show what actually broke
-- instead of the generic "Check Runway token and retry" hint.

alter table trend_briefs add column if not exists video_error text;
