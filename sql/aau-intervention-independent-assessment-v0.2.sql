-- AAU Intervention Protocol v0.2: reviews are independent of expertise-verification verdicts.
CREATE TABLE IF NOT EXISTS agent_lab.intervention_review_cases (
 case_id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
 agent_id uuid NOT NULL REFERENCES agent_lab.agents(agent_id),
 work_id uuid REFERENCES agent_lab.complex_work_pilots(work_id),
 source_file_id uuid REFERENCES agent_lab.agent_files(file_id),
 evidence_sha256 text NOT NULL,
 review_purpose text NOT NULL,
 status text NOT NULL DEFAULT 'review_pending'
  CHECK(status IN ('review_pending','assessing','reviewer_blocked','feedback_ready','feedback_delivered','closed')),
 frozen_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
 authenticator jsonb NOT NULL DEFAULT '{}'::jsonb,
 adjudicator jsonb NOT NULL DEFAULT '{}'::jsonb,
 feedback jsonb NOT NULL DEFAULT '{}'::jsonb,
 feedback_message_id uuid REFERENCES agent_lab.admin_chat_messages(message_id),
 outcome_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 closed_at timestamptz,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS intervention_review_scope_dedupe_v0_2
 ON agent_lab.intervention_review_cases(agent_id,evidence_sha256,review_purpose);
ALTER TABLE agent_lab.intervention_review_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agent_lab.intervention_review_cases FROM PUBLIC,anon,authenticated;
