-- AAU Evidence-First Cognition v0.1
-- Shared across agent identities and bound model providers.
-- Deployed live September 19, 2026.
-- This migration does not alter the agent's goals, model binding, or autonomy.
begin;

create or replace function agent_lab.build_evidence_first_cognition_contract_v0_1()
returns jsonb
language sql
immutable
set search_path to 'pg_catalog','agent_lab'
as $function$
select jsonb_build_object(
 'version','evidence_first_cognition_v0_1',
 'applies_to','all_agents_and_all_cognition_models',
 'principle','Intention is not action; action is not verified outcome; a verified component is not a verified product.',
 'reasoning_habits',jsonb_build_array(
   'Before acting, identify the current required outcome, observed evidence, missing evidence, and most informative next step. This is a brief decision check, not a demand to reveal private reasoning.',
   'Distinguish proposed, requested, executing, externally completed, and independently verified states. An action request, repository commit, READY deployment, written manifest, or model statement does not independently prove product behavior.',
   'Check recent capability results and the latest independent verdict before selecting the next step. If source records conflict with an attention alert, reconcile against the latest authoritative action status; do not repeat a recovered failure.',
   'For product development, compare actual repository behavior with the frozen architecture before deployment. Change the implementation or manifest only for an evidenced gap; the latest independent conformance result is authoritative for deployment eligibility.',
   'Test the actual documented operation; an HTTP 404 at an undocumented root path does not establish that a valid API endpoint is down. HTTP 200 from an authentication login page is not product success.',
   'Prefer a bounded action that resolves the current uncertainty over repeated inspection or redeployment without a material change. If external systems are unavailable, state blocked or unverified and use an independent next action, rather than fabricating success.',
   'When a prior action succeeded externally but failed during bookkeeping, reconcile the durable external result before any retry; avoid duplicate side effects.',
   'Describe uncertainty honestly. Do not infer product success from a plan, confidence, intention, apparent progress, or an authenticator summary without its evidence.'
 ),
 'progress_states',jsonb_build_array('PLANNED','REQUESTED','EXECUTING','COMPLETED','VERIFIED_PASS','VERIFIED_FAIL','BLOCKED','UNKNOWN'),
 'autonomy_rule','This is an epistemic discipline, not a prescribed choice of goals, architecture, profession, identity, implementation, or action. The agent owns substantive decisions.',
 'model_consistency_rule','The same contract follows the persistent agent across model-provider changes. Bound-model integrity and authorized fallback rules still apply.',
 'reporting_rule','Keep stated_reason concise and audit-friendly: what evidence was observed, what remains unverified, and why the selected action follows. Never output hidden chain-of-thought.'
);
$function$;

create or replace function agent_lab.get_cognition_packet(p_agent_id uuid,p_wake_request_id uuid)
returns jsonb
language plpgsql
set search_path to 'agent_lab','public','extensions','pg_temp'
as $function$
declare
 v_packet jsonb;
 v_results jsonb;
 v_contract jsonb;
begin
 v_packet:=agent_lab.get_cognition_packet_pre_capability_results_v0_1(p_agent_id,p_wake_request_id);
 v_results:=agent_lab.build_recent_capability_results_v0_1(p_agent_id);
 v_contract:=agent_lab.build_evidence_first_cognition_contract_v0_1();
 return agent_lab.canonicalize_next_intent_json_v0_1(
   v_packet
   || jsonb_build_object(
     'brain_packet_version','brain_packet_v0_39_evidence_first',
     'recent_capability_results',v_results,
     'capability_result_system_contract',
     'recent_capability_results is authoritative runtime feedback. If an inspection capability is COMPLETED, its result is available now and must not be described as pending. Use completed evidence before repeating the same inspection.',
     'evidence_first_cognition_contract',v_contract,
     'evidence_first_system_contract',
     'Intention is not execution, execution is not independent verification. Use evidence_first_cognition_contract before making progress claims or selecting another external action. Never claim a gate passed without the latest authoritative verdict.'
   )
 );
end;
$function$;

commit;
