-- Personas, scenarios and runs: the app's tables.
CREATE TABLE personas (
  id                text PRIMARY KEY,
  name              text NOT NULL,
  -- The persona's WhatsApp number — how Ordoor tells customers apart, so one per persona.
  phone             text NOT NULL UNIQUE,
  location          jsonb NOT NULL,
  character         text NOT NULL,
  language          text NOT NULL,
  traits            text[] NOT NULL DEFAULT '{}',
  sends_voice_notes boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE scenarios (
  id               text PRIMARY KEY,
  persona_id       text NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  title            text NOT NULL,
  intent           text NOT NULL,
  expected_items   jsonb NOT NULL DEFAULT '[]',
  expected_outcome text NOT NULL CHECK (expected_outcome IN ('order_confirmed', 'order_placed', 'no_order', 'any')),
  store_behaviour  text NOT NULL DEFAULT '',
  max_turns        integer NOT NULL CHECK (max_turns BETWEEN 1 AND 60),
  reset_before_run boolean NOT NULL DEFAULT true,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scenarios_persona_idx ON scenarios (persona_id);

-- A run keeps COPIES of its persona and scenario (as they were when it started), so it stays
-- readable after either is edited or deleted; the ids are kept for grouping and go null on delete.
CREATE TABLE runs (
  id               text PRIMARY KEY,
  batch_id         text,
  persona_id       text REFERENCES personas(id) ON DELETE SET NULL,
  scenario_id      text REFERENCES scenarios(id) ON DELETE SET NULL,
  persona          jsonb NOT NULL,
  scenario         jsonb NOT NULL,
  status           text NOT NULL CHECK (status IN ('queued', 'running', 'evaluating', 'completed', 'failed', 'stopped')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  customer_turns   integer NOT NULL DEFAULT 0,
  end_reason       text,
  transcript       jsonb NOT NULL DEFAULT '[]',
  store_transcript jsonb NOT NULL DEFAULT '[]',
  final_state      jsonb,
  evaluation       jsonb,
  -- Read out of the evaluation for reporting: «pass rate per scenario this week» is one query.
  verdict          text GENERATED ALWAYS AS (evaluation ->> 'verdict') STORED,
  score            integer GENERATED ALWAYS AS ((evaluation ->> 'score')::integer) STORED,
  error            text,
  log              jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX runs_created_idx ON runs (created_at DESC);
CREATE INDEX runs_status_idx ON runs (status) WHERE status IN ('queued', 'running', 'evaluating');
CREATE INDEX runs_scenario_idx ON runs (scenario_id, created_at DESC);
CREATE INDEX runs_persona_idx ON runs (persona_id, created_at DESC);
CREATE INDEX runs_batch_idx ON runs (batch_id) WHERE batch_id IS NOT NULL;
