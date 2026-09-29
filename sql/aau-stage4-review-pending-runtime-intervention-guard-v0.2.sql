-- AAU Stage-4 review-pending runtime intervention guard v0.2
-- Reclassify already-reconciled non-authoritative failed wakes as completed
-- after the canonical four-candidate revision set is valid and awaiting review.
-- Preserve the original runtime fault in wake metadata for auditability.

begin;

CREATE OR REPLACE FUNCTION agent_lab.reconcile_stage4_review_pending_runtime_interventions_v0_1(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_state jsonb:='{}'::jsonb;
  v_target int:=4;
  v_cohort int:=1;
  v_cycle text:='';
  v_total int:=0;
  v_valid int:=0;
  v_attention_ids uuid[]:=array[]::uuid[];
  v_attention_count int:=0;
  v_wake_count int:=0;
  v_failed_wake_count int:=0;
  v_message_count int:=0;
  v_intervention_count int:=0;
begin
  select coalesce(state_payload,'{}'::jsonb)
  into v_state
  from agent_lab.state
  where agent_id=p_agent_id;

  if coalesce(v_state->>'expertise_candidate_mode','')<>'four_viability_proposals_v0_1'
     or coalesce(v_state->>'expertise_candidate_phase','')<>'review_pending' then
    return jsonb_build_object(
      'status','not_applicable',
      'reason','stage4_not_review_pending'
    );
  end if;

  v_target:=greatest(1,coalesce(nullif(v_state->>'expertise_candidate_target_count','')::int,4));
  v_cohort:=greatest(1,coalesce(nullif(v_state->>'expertise_candidate_cohort','')::int,1));
  v_cycle:=coalesce(v_state->>'expertise_candidate_revision_cycle_id','');

  select
    count(*)::int,
    count(*) filter (
      where coalesce(p.revision_count,0)>=1
        and (v_cycle='' or coalesce(p.report->>'candidate_revision_cycle_id','')=v_cycle)
        and coalesce((agent_lab.validate_expertise_viability_proposal_v0_1(p.report)->>'ok')::boolean,false)
    )::int
  into v_total,v_valid
  from agent_lab.expertise_economic_proposals p
  where p.agent_id=p_agent_id
    and p.status='candidate_pending'
    and coalesce(p.report->>'candidate_mode','')='four_viability_proposals_v0_1'
    and coalesce(nullif(p.report->>'candidate_cohort','')::int,1)=v_cohort;

  if v_total<>v_target or v_valid<>v_target then
    return jsonb_build_object(
      'status','not_reconciled',
      'reason','canonical_revision_set_not_complete',
      'target_count',v_target,
      'candidate_count',v_total,
      'valid_revised_count',v_valid,
      'revision_cycle_id',v_cycle
    );
  end if;

  select coalesce(array_agg(x.attention_item_id),array[]::uuid[])
  into v_attention_ids
  from agent_lab.attention_items x
  where x.agent_id=p_agent_id
    and x.source_type='admin_message'
    and x.attention_class='runtime_intervention'
    and x.provenance->>'origin'='automatic_runtime_intervention_v0_1'
    and x.payload->>'system_authored'='true'
    and x.state in ('pending','deferred','dispatched','coalesced');
  update agent_lab.wake_queue q
  set status='cancelled',
      completed_at=now(),
      last_error='cancelled_stage4_review_pending_reconciliation',
      metadata=coalesce(q.metadata,'{}'::jsonb)||jsonb_build_object(
        'stage4_review_pending_reconciled',true,
        'stage4_review_pending_reconciled_at',now(),
        'reconciliation_contract','stage4_review_pending_runtime_intervention_guard_v0_1'
      )
  where q.agent_id=p_agent_id
    and q.status='queued'
    and q.metadata->>'attention_item_id'=any(
      array(select u::text from unnest(v_attention_ids) u)
    );
  get diagnostics v_wake_count=row_count;

  update agent_lab.wake_queue q
  set status='completed',
      last_error=null,
      metadata=coalesce(q.metadata,'{}'::jsonb)||jsonb_build_object(
        'reconciled_from_status','failed',
        'reconciled_original_error',q.last_error,
        'reconciled_original_failure_class',q.metadata->>'failure_class',
        'reconciled_terminal_status','completed',
        'stage4_review_pending_reconciled',true,
        'stage4_review_pending_reconciled_at',now(),
        'reconciliation_contract','stage4_review_pending_runtime_intervention_guard_v0_2',
        'failure_non_authoritative_for_stage4',true
      )
  where q.agent_id=p_agent_id
    and q.status='failed'
    and coalesce((q.metadata->>'failure_non_authoritative_for_stage4')::boolean,false)
    and coalesce((q.metadata->>'stage4_review_pending_reconciled')::boolean,false);
  get diagnostics v_failed_wake_count=row_count;

  update agent_lab.admin_chat_messages m
  set delivery_status=case
        when m.delivery_status in ('queued','scheduled') then 'delivered'
        else m.delivery_status
      end,
      metadata=coalesce(m.metadata,'{}'::jsonb)||jsonb_build_object(
        'stage4_review_pending_reconciled',true,
        'stage4_review_pending_reconciled_at',now(),
        'reconciliation_contract','stage4_review_pending_runtime_intervention_guard_v0_1'
      ),
      updated_at=now()
  where m.agent_id=p_agent_id
    and m.sender_kind='admin'
    and m.metadata->>'origin'='automatic_runtime_intervention_v0_1'
    and m.metadata->>'system_authored'='true'
    and exists (
      select 1
      from agent_lab.attention_items x
      where x.attention_item_id=any(v_attention_ids)
        and (
          x.source_ref=m.message_id::text
          or x.payload->>'admin_chat_message_id'=m.message_id::text
        )
    );
  get diagnostics v_message_count=row_count;

  update agent_lab.intervention_events ie
  set status='resolved',
      evidence=coalesce(ie.evidence,'{}'::jsonb)||jsonb_build_object(
        'resolution','canonical_stage4_revision_set_already_complete',
        'resolved_at',now(),
        'reconciliation_contract','stage4_review_pending_runtime_intervention_guard_v0_1',
        'revision_cycle_id',v_cycle,
        'valid_revised_count',v_valid
      ),
      updated_at=now()
  where ie.agent_id=p_agent_id
    and ie.status<>'resolved'
    and (
      ie.attention_item_id=any(v_attention_ids)
      or exists (
        select 1
        from agent_lab.admin_chat_messages m
        where m.message_id=ie.message_id
          and m.metadata->>'stage4_review_pending_reconciled'='true'
      )
    );
  get diagnostics v_intervention_count=row_count;

  update agent_lab.attention_items x
  set state='consumed',
      metadata=coalesce(x.metadata,'{}'::jsonb)||jsonb_build_object(
        'reconciliation','canonical_stage4_revision_set_already_complete',
        'reconciled_at',now(),
        'reconciliation_contract','stage4_review_pending_runtime_intervention_guard_v0_1',
        'revision_cycle_id',v_cycle,
        'valid_revised_count',v_valid
      ),
      updated_at=now()
  where x.attention_item_id=any(v_attention_ids);
  get diagnostics v_attention_count=row_count;

  return jsonb_build_object(
    'status','reconciled',
    'contract','stage4_review_pending_runtime_intervention_guard_v0_1',
    'target_count',v_target,
    'valid_revised_count',v_valid,
    'revision_cycle_id',v_cycle,
    'attention_items_consumed',v_attention_count,
    'queued_wakes_cancelled',v_wake_count,
    'failed_wakes_reclassified',v_failed_wake_count,
    'system_messages_reconciled',v_message_count,
    'intervention_events_resolved',v_intervention_count
  );
end
$function$
;

revoke all on function agent_lab.reconcile_stage4_review_pending_runtime_interventions_v0_1(uuid)
from public,anon,authenticated;
grant execute on function agent_lab.reconcile_stage4_review_pending_runtime_interventions_v0_1(uuid)
to service_role;

commit;
