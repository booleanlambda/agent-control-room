-- AAU canonical expertise candidate ledger v0.1
-- Exposes only the authoritative current candidate-mode/cohort ledger to cognition.

create or replace function public.aau_bridge_expertise_candidate_ledger_v0_1(
  p_bridge_token text,
  p_agent_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','agent_lab','extensions'
as $function$
declare
  v_state jsonb:='{}'::jsonb;
  v_mode text;
  v_cohort int:=1;
  v_target int:=4;
  v_candidates jsonb:='[]'::jsonb;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select coalesce(state_payload,'{}'::jsonb)
    into v_state
  from agent_lab.state
  where agent_id=p_agent_id;

  v_mode:=coalesce(v_state->>'expertise_candidate_mode','');
  v_cohort:=greatest(1,coalesce(nullif(v_state->>'expertise_candidate_cohort','')::int,1));
  v_target:=greatest(1,coalesce(nullif(v_state->>'expertise_candidate_target_count','')::int,4));

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'proposal_id',p.proposal_id,
        'domain',p.domain,
        'status',p.status,
        'candidate_ordinal',nullif(p.report->>'candidate_ordinal','')::int,
        'candidate_cohort',v_cohort,
        'source_wake_request_id',p.source_wake_request_id,
        'created_at',p.created_at
      )
      order by nullif(p.report->>'candidate_ordinal','')::int,p.created_at
    ),
    '[]'::jsonb
  )
  into v_candidates
  from agent_lab.expertise_economic_proposals p
  where p.agent_id=p_agent_id
    and coalesce(p.report->>'candidate_mode','')=v_mode
    and coalesce(nullif(p.report->>'candidate_cohort','')::int,1)=v_cohort
    and p.status in (
      'candidate_pending','candidate_approved','candidate_rejected',
      'candidate_not_selected','approved','consumed'
    );

  return jsonb_build_object(
    'status','ready',
    'contract','expertise_candidate_ledger_v0_1',
    'candidate_mode',v_mode,
    'candidate_cohort',v_cohort,
    'target_count',v_target,
    'submitted_count',jsonb_array_length(v_candidates),
    'candidates',v_candidates
  );
end
$function$;

revoke all on function public.aau_bridge_expertise_candidate_ledger_v0_1(text,uuid)
  from public,authenticated,service_role;
grant execute on function public.aau_bridge_expertise_candidate_ledger_v0_1(text,uuid)
  to anon;

comment on function public.aau_bridge_expertise_candidate_ledger_v0_1(text,uuid)
is 'Authoritative current-cohort Stage-4 candidate ledger for recursive cognition distinctness/progress checks.';
