CREATE TABLE IF NOT EXISTS plans (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  scheduled_job_limit INTEGER NOT NULL CHECK (scheduled_job_limit >= 0),
  max_iterations INTEGER NOT NULL CHECK (max_iterations BETWEEN 1 AND 8),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_hint TEXT NOT NULL DEFAULT '',
  recovery_question TEXT NOT NULL DEFAULT '',
  recovery_answer_hash TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'learner' CHECK (role IN ('learner', 'contributor', 'reviewer', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent migration for databases created before local sign-in support.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
UPDATE users
SET password_hash = 'disabled_legacy_account'
WHERE password_hash IS NULL;
ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hint TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_question TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_answer_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'learner';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('learner', 'contributor', 'reviewer', 'admin'));

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL REFERENCES plans(code),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
  renewal_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS improvement_jobs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  circuit JSONB NOT NULL,
  objective TEXT NOT NULL,
  schedule_at TIMESTAMPTZ NOT NULL,
  max_iterations INTEGER NOT NULL CHECK (max_iterations BETWEEN 1 AND 8),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'running', 'completed', 'failed')),
  result JSONB,
  report_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS improvement_jobs_due_idx
  ON improvement_jobs (status, schedule_at);

CREATE TABLE IF NOT EXISTS improvement_runs (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES improvement_jobs(id) ON DELETE CASCADE,
  iteration INTEGER NOT NULL,
  before_ir JSONB NOT NULL,
  after_ir JSONB NOT NULL,
  metrics JSONB NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected', 'unchanged')),
  report_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS page_events (
  id UUID PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  page_key TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'page_view' CHECK (event_type IN ('page_view')),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS page_events_created_idx ON page_events (created_at DESC);
CREATE INDEX IF NOT EXISTS page_events_page_idx ON page_events (page_key, created_at DESC);

CREATE TABLE IF NOT EXISTS content_feedback (
  id UUID PRIMARY KEY,
  content_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('like', 'inaccuracy')),
  message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (content_id, visitor_id, kind)
);

CREATE INDEX IF NOT EXISTS content_feedback_created_idx ON content_feedback (created_at DESC);

CREATE TABLE IF NOT EXISTS llm_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  provider TEXT NOT NULL CHECK (provider IN ('local', 'openai')),
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key_ciphertext BYTEA NOT NULL,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_submissions (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('research', 'contributor', 'reviewer')),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  license TEXT NOT NULL DEFAULT 'CC BY 4.0 when published',
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'under_review', 'approved', 'rejected')),
  consent_at TIMESTAMPTZ NOT NULL,
  retention_until TIMESTAMPTZ NOT NULL,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  review_note TEXT NOT NULL DEFAULT '',
  delete_requested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS community_submissions_status_idx
  ON community_submissions (status, created_at DESC);

CREATE TABLE IF NOT EXISTS community_audit_log (
  id UUID PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES community_submissions(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS community_audit_submission_idx
  ON community_audit_log (submission_id, created_at);
