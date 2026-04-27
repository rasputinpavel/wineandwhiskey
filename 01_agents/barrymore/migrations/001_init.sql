-- Бэрримор — схема БД
-- Запустить в Supabase SQL Editor: https://supabase.com/dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS tasks (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT,
  assignee     TEXT NOT NULL CHECK (assignee IN ('pavel', 'irina', 'both')),
  priority     TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status       TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
  deadline     DATE,
  tags         TEXT[] DEFAULT '{}',
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_by   TEXT
);

CREATE TABLE IF NOT EXISTS daily_logs (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date            DATE NOT NULL UNIQUE,
  morning_plan    TEXT,
  evening_review  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chronicle (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date         DATE NOT NULL,
  event_type   TEXT NOT NULL DEFAULT 'note',
  title        TEXT NOT NULL,
  description  TEXT,
  task_id      UUID REFERENCES tasks(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tasks_status_idx    ON tasks(status);
CREATE INDEX IF NOT EXISTS tasks_assignee_idx  ON tasks(assignee);
CREATE INDEX IF NOT EXISTS tasks_deadline_idx  ON tasks(deadline) WHERE deadline IS NOT NULL;
CREATE INDEX IF NOT EXISTS chronicle_date_idx  ON chronicle(date DESC);
