-- Бэрримор — долговременная память диалогов
-- Запустить в Supabase SQL Editor

CREATE TABLE IF NOT EXISTS conversation_messages (
  id        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id   BIGINT NOT NULL,
  role      TEXT   NOT NULL CHECK (role IN ('user', 'assistant')),
  content   JSONB  NOT NULL,
  ts        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS conversation_messages_chat_ts_idx
  ON conversation_messages (chat_id, ts DESC);

-- Триграммный индекс для ILIKE-поиска по летописи и задачам
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS chronicle_title_trgm_idx
  ON chronicle USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS chronicle_description_trgm_idx
  ON chronicle USING gin (description gin_trgm_ops);

CREATE INDEX IF NOT EXISTS tasks_title_trgm_idx
  ON tasks USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tasks_description_trgm_idx
  ON tasks USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tasks_notes_trgm_idx
  ON tasks USING gin (notes gin_trgm_ops);
