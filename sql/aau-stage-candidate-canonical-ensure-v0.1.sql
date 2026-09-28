-- AAU Stage-4 canonical candidate persistence v0.1
-- Makes candidate submission idempotent across wake retries/restarts.

create or replace function public.aau_bridge_ensure_expertise_viability_candidate_v0_1(
  p_bridge_token text,
  p_agent_id uuid,
  p_wake_request_id uuid,
  p_proposal jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','agent_lab','extensions'
as $function$
declare
  v_state jsonb:='{}'::jsonb;
  v_mode text;
  v_phase text;
  v_cohort int:=1;
  v_target int:=4;
  v_domain text;
  v_existing agent_lab.expertise_economic_proposals%rowtype;
  v_count int:=0;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select coalesce(state_payload,'{}'::jsonb) into v_state
  from agent_lab.state
  where agent_id=p_agent_id;

  v_mode:=coalesce(v_state->>'expertise_candidate_mode','');
  v_phase:=coalesce(v_state->>'expertise_candidate_phase','collecting');
  v_cohort:=greatest(1,coalesce(nullif(v_state->>'expertise_candidate_cohort','')::int,1));
  v_target:=greatest(1,coalesce(nullif(v_state->>'expertise_candidate_target_count','')::int,4));
  v_domain:=left(btrim(coalesce(p_proposal->>'domain','')),300);

  if v_mode='four_viability_proposals_v0_1' and length(v_domain)>=2 then
    select * into v_existing
    from agent_lab.expertise_economic_proposals
    where agent_id=p_agent_id
      and lower(btrim(domain))=lower(btrim(v_domain))
      and coalesce(report->>'candidate_mode','')='four_viability_proposals_v0_1'
      and coalesce(nullif(report->>'candidate_cohort','')::int,1)=v_cohort
      and status in (
        'candidate_pending','candidate_approved','candidate_rejected',
        'candidate_not_selected','approved','consumed'
      )
    order by created_at desc
    limit 1;

    if found then
      select count(*)::int into v_count
      from agent_lab.expertise_economic_proposals
      where agent_id=p_agent_id
        and coalesce(report->>'candidate_mode','')='four_viability_proposals_v0_1'
        and coalesce(nullif(report->>'candidate_cohort','')::int,1)=v_cohort
        and status in (
          'candidate_pending','candidate_approved','candidate_rejected',
          'candidate_not_selected','approved','consumed'
        );

      return jsonb_build_object(
        'status',v_existing.status,
        'proposal_id',v_existing.proposal_id,
        'domain',v_existing.domain,
        'candidate_count',v_count,
        'target_count',v_target,
        'candidate_cohort',v_cohort,
        'candidate_ordinal',nullif(v_existing.report->>'candidate_ordinal','')::int,
        'canonical_submission_persisted',true,
        'idempotent_domain_replay',true,
        'source_wake_request_id',v_existing.source_wake_request_id,
        'candidate_phase',v_phase,
        'contract_version','four_viability_proposals_v0_1'
      );
    end if;
  end if;

  return public.aau_bridge_submit_expertise_viability_proposal(
    p_bridge_token,p_agent_id,p_wake_request_id,p_proposal
  );
end
$function$;

revoke all on function public.aau_bridge_ensure_expertise_viability_candidate_v0_1(text,uuid,uuid,jsonb) from public;
grant execute on function public.aau_bridge_ensure_expertise_viability_candidate_v0_1(text,uuid,uuid,jsonb)
  to anon,authenticated,service_role;

comment on function public.aau_bridge_ensure_expertise_viability_candidate_v0_1(text,uuid,uuid,jsonb)
is 'Idempotent canonical Stage-4 candidate persistence. Same-domain/current-cohort replays acknowledge the existing durable candidate; new candidates delegate to the authoritative submit function.';
