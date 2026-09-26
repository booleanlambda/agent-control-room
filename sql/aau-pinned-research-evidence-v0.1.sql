-- AAU pinned research evidence v0.1
-- Explicitly requested source excerpts are persisted outside cognition node context compaction.

CREATE TABLE IF NOT EXISTS agent_lab.cognition_pinned_research_evidence (
  evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agent_lab.agents(agent_id) ON DELETE CASCADE,
  assignment_key text NOT NULL,
  node_path text NOT NULL,
  model_id text NOT NULL,
  source_key text NOT NULL,
  source_id text,
  url text,
  title text,
  publisher text,
  source_sha256 text,
  fetch_status text,
  coverage text,
  excerpt text NOT NULL DEFAULT '',
  excerpt_bytes integer NOT NULL DEFAULT 0 CHECK (excerpt_bytes >= 0 AND excerpt_bytes <= 20000),
  audit_batch_id uuid,
  first_wake_request_id uuid REFERENCES agent_lab.wake_queue(wake_request_id),
  last_wake_request_id uuid REFERENCES agent_lab.wake_queue(wake_request_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id,assignment_key,node_path,model_id,source_key)
);

CREATE INDEX IF NOT EXISTS cognition_pinned_research_node_idx
  ON agent_lab.cognition_pinned_research_evidence(agent_id,assignment_key,node_path,model_id,updated_at DESC);

ALTER TABLE agent_lab.cognition_pinned_research_evidence ENABLE ROW LEVEL SECURITY;

-- Production function body is applied by migration aau_pinned_research_evidence_v0_1.
-- The SECURITY DEFINER bridge function:
--   public.aau_bridge_cognition_pinned_research_v0_1(...)
-- validates bridge token, wake ownership, bound model, node identity and HTTPS URLs;
-- supports list/save; stores up to 16 evidence records per save; and returns
-- inserted/extended/unchanged/restored_or_extended counts for convergence accounting.
