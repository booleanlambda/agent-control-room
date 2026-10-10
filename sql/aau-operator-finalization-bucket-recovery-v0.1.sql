-- Explicit, idempotent operator renewal for a paused finalization bucket.
-- Distinct from automatic rollover. Never mutates completed child cognition.
begin;
create or replace function agent_lab.operator_renew_paused_finalization_epoch_v0_1(
  p_agent_id uuid,
  p_assignment_key text,
  p_node_path text,
  p_grant_key text,
  p_reason text
) returns jsonb
language plpgsql
set search_path to 'pg_catalog','agent_lab','public'
as $function$
declare
  v_run agent_lab.autonomous_lifecycle_runs%rowtype;
  v_prev agent_lab.cognition_assignment_runtime%rowtype;
  v_renewed jsonb;
  v_new uuid;
  v_child_count integer;
  v_verified_count integer;
  v_finalization_spent integer;
  v_reserve integer;
begin
  if coalesce(length(btrim(p_grant_key)),0) not between 8 and 120
     or coalesce(length(btrim(p_reason)),0)<10 then
    raise exception 'operator_finalization_renewal_requires_auditable_reason_and_key';
  end if;
  select * into v_run from agent_lab.autonomous_lifecycle_runs
    where agent_id=p_agent_id for update;
  if not found then raise exception 'operator_finalization_agent_missing'; end if;
  select * into v_prev from agent_lab.cognition_assignment_runtime
    where agent_id=p_agent_id and assignment_key=p_assignment_key
    order by epoch_no desc limit 1 for update;
  if not found then raise exception 'operator_finalization_epoch_missing'; end if;
  if v_prev.metadata->>'operator_finalization_grant_key'=p_grant_key then
    return jsonb_build_object('status','already_renewed','runtime_id',v_prev.runtime_id,
      'epoch_no',v_prev.epoch_no,'history_preserved',true,'idempotent',true);
  end if;
  if v_run.status<>'paused' or
     coalesce(v_run.last_error,'') not like
       'semantic_bucket_rollover_denied:semantic_budget_bucket_exhausted:finalization:%' then
    raise exception 'operator_finalization_requires_explicit_finalization_pause';
  end if;
  if exists(select 1 from agent_lab.wake_queue q
      where q.agent_id=p_agent_id and q.status in ('queued','claimed','running')) then
    raise exception 'operator_finalization_rejects_active_or_queued_wakes';
  end if;
  if v_prev.status<>'active' or not (
       v_prev.metadata->>'finalization_checkpoint_recovery'='true'
       or v_prev.metadata->>'renewal_kind'='operator_explicit_finalization_bucket_recovery_v0_1'
     ) then
    raise exception 'operator_finalization_expected_exhausted_active_rollover_epoch';
  end if;
  if v_prev.metadata->>'source_node_path'=p_node_path then
    raise exception 'operator_finalization_same_node_repeated_renewal_forbidden';
  end if;
  select count(*)::integer,
         count(*) filter(where c.status='completed'
           and c.result_hash is not null
           and (
             (c.decision_type='ATOMIC'
               and c.decision_payload->>'deterministic_math_verified'='true'
               and c.decision_payload->'deterministic_math_verification'->>'ok'='true'
               and c.decision_payload->'deterministic_math_verification'->>'all_match'='true')
             or (c.decision_type='SPLIT'
               and c.decision_payload->>'synthesis_outcome'='COMPLETE'
               and c.decision_payload->'synthesis_provenance_review'->>'status'='ACCEPT')
           ))::integer
    into v_child_count,v_verified_count
    from agent_lab.cognition_requirement_nodes c
    where c.agent_id=p_agent_id and c.assignment_key=p_assignment_key
      and c.node_path like p_node_path||'.%'
      and cardinality(string_to_array(c.node_path,'.'))=
          cardinality(string_to_array(p_node_path,'.'))+1;
  if v_child_count<1 or v_verified_count<>v_child_count then
    raise exception 'operator_finalization_all_direct_children_must_be_verified:%/%',
      v_verified_count,v_child_count;
  end if;
  if not exists(select 1 from agent_lab.cognition_step_checkpoints c
    where c.agent_id=p_agent_id and c.assignment_key=p_assignment_key
      and c.step_metadata->>'phase'='FINAL_SYNTHESIS'
      and c.step_metadata->>'node_path'=p_node_path
      and c.step_metadata->>'synthesis_outcome'='COMPLETE'
      and c.step_metadata->>'immutable_completed_phase'='true') then
    raise exception 'operator_finalization_durable_completed_synthesis_required';
  end if;
  select greatest(0,coalesce(sum(
    case when e.event_kind='model_call_reservation' and e.outcome='reserved'
       then e.cost_units
    when e.event_kind='model_call_settlement' and e.outcome in ('settled','released')
       then -coalesce(nullif(e.metadata->>'refund_units','')::integer,0)
    when e.event_kind not in ('model_call_reservation','model_call_settlement')
      and e.outcome='charged' then e.cost_units
    else 0 end),0))::integer into v_finalization_spent
    from agent_lab.cognition_runtime_events e
    where e.runtime_id=v_prev.runtime_id
      and e.metadata->>'budget_contract'='semantic_budget_buckets_v0_1'
      and e.metadata->>'budget_bucket'='finalization';
  v_reserve:=coalesce((v_prev.metadata->>'finalization_reserve_units')::integer,0);
  if v_reserve<=0 or v_finalization_spent<=0 then
    raise exception 'operator_finalization_expected_spent_protected_bucket';
  end if;
  update agent_lab.cognition_assignment_runtime
     set status='blocked',
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'block_reason','operator_authorized_exhausted_finalization_bucket_epoch',
           'operator_finalization_grant_key',p_grant_key,
           'operator_finalization_reason',left(p_reason,500),
           'finalization_spent_units_at_boundary',v_finalization_spent,
           'finalization_reserve_units_at_boundary',v_reserve,
           'durable_cognition_preserved',true,
           'reserved_units_not_overdrawn',true
         ),updated_at=now()
    where runtime_id=v_prev.runtime_id;
  v_renewed:=agent_lab.renew_cognition_assignment_runtime_epoch(
    p_agent_id,p_assignment_key,'operator_explicit_finalization_bucket_renewal:'||
    left(p_grant_key,120));
  if v_renewed->>'status'<>'renewed' then
    raise exception 'operator_finalization_epoch_renewal_failed';
  end if;
  v_new:=(v_renewed->>'runtime_id')::uuid;
  update agent_lab.cognition_assignment_runtime
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'renewal_kind','operator_explicit_finalization_bucket_recovery_v0_1',
      'operator_finalization_grant_key',p_grant_key,
      'operator_finalization_reason',left(p_reason,500),
      'renewed_from_finalization_spent_units',v_finalization_spent,
      'source_node_path',p_node_path,
      'verified_direct_children',v_verified_count,
      'durable_cognition_preserved',true,
      'protected_reserve_limit_unchanged',true
    ),updated_at=now()
    where runtime_id=v_new;
  return coalesce(v_renewed,'{}'::jsonb)||jsonb_build_object(
    'status','operator_renewed',
    'contract','operator_finalization_bucket_recovery_v0_1',
    'verified_direct_children',v_verified_count,
    'prior_finalization_spent_units',v_finalization_spent,
    'prior_finalization_reserve_units',v_reserve,
    'history_preserved',true,
    'idempotent',false,
    'operator_grant_key',p_grant_key,
    'agent_still_paused',true
  );
end;
$function$;
revoke all on function agent_lab.operator_renew_paused_finalization_epoch_v0_1(uuid,text,text,text,text)
  from public,anon,authenticated,service_role;
commit;