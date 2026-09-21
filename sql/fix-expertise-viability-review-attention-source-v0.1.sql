-- Fix unified expertise review attention source to allowed system_event.
CREATE OR REPLACE FUNCTION agent_lab.operator_review_expertise_viability_proposal(p_proposal_id uuid, p_decision text, p_operator_id text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_case agent_lab.expertise_economic_proposals%rowtype;
  v_check jsonb;
  v_materialized jsonb:='{}'::jsonb;
  v_item uuid;
  v_arb jsonb;
begin
  if p_decision not in('approved','rejected')
     or length(btrim(coalesce(p_operator_id,'')))<3
     or length(btrim(coalesce(p_note,'')))<10 then
    raise exception 'expertise_viability_review_requires_decision_operator_and_reason';
  end if;

  select * into v_case
  from agent_lab.expertise_economic_proposals
  where proposal_id=p_proposal_id for update;

  if not found or v_case.status<>'pending' then
    raise exception 'expertise_viability_proposal_not_pending';
  end if;

  if p_decision='approved' then
    v_check:=agent_lab.validate_expertise_viability_proposal_v0_1(v_case.report);
    if not coalesce((v_check->>'ok')::boolean,false) then
      raise exception 'cannot_approve_incomplete_expertise_viability_unit:%',v_check->'missing';
    end if;
  end if;

  update agent_lab.expertise_economic_proposals
  set status=p_decision,operator_id=p_operator_id,operator_note=left(p_note,6000),
      reviewed_at=now(),updated_at=now()
  where proposal_id=p_proposal_id
  returning * into v_case;

  if p_decision='approved' then
    v_materialized:=agent_lab.materialize_approved_expertise_viability_v0_1(p_proposal_id);
  end if;

  update agent_lab.autonomous_lifecycle_runs
  set status='running',next_wake_at=null,last_error=null,
      metadata=(coalesce(metadata,'{}'::jsonb)
        -'operator_approval_required'
        -'pending_economic_proposal_id'
        -'pause_reason'
        -'proposal_revision_required')
        ||jsonb_build_object(
          'expertise_viability_review_decision',p_decision,
          'expertise_viability_reviewed_at',now(),
          'expertise_viability_proposal_id',p_proposal_id
        ),
      updated_at=now()
  where agent_id=v_case.agent_id and status='paused';

  update agent_lab.agent_existence_accounts
  set account_state='current',levy_enabled=true,next_due_at=now()+interval '1 minute',
      metadata=(coalesce(metadata,'{}'::jsonb)-'suspended_reason'-'suspended_at')
        ||jsonb_build_object(
          'resumed_at',now(),
          'resume_rule','expertise_viability_review_decision_v0_1',
          'review_decision',p_decision
        ),
      updated_at=now()
  where agent_id=v_case.agent_id;

  update agent_lab.state
  set state_payload=(coalesce(state_payload,'{}'::jsonb)
        -'paused_at'-'pause_reason'-'repair_pause_reason'-'proposal_revision_required')
      ||jsonb_build_object(
        'awake',true,'sleeping',false,'system_paused',false,
        'manual_wake_mode',false,'intent_pending',false,'wake_pending',false,
        'expertise_viability_review_decision',p_decision,
        'expertise_viability_proposal_id',p_proposal_id
      ),
      updated_at=now()
  where agent_id=v_case.agent_id;

  v_item:=agent_lab.enqueue_attention_item_v0_1(
    v_case.agent_id,'system_event','expertise-viability-review:'||p_proposal_id::text,
    'operator_expertise_viability_review',0.98,0.95,0.80,0.75,0,1,'boundary',
    jsonb_build_object(
      'proposal_id',p_proposal_id,'decision',p_decision,
      'operator_note',left(p_note,6000),
      'artifact_id',v_materialized->>'expertise_artifact_id'
    ),
    jsonb_build_object(
      'origin','expertise_viability_review_v0_1',
      'unit_approval',true
    )
  );
  v_arb:=agent_lab.arbitrate_attention_v0_1(v_case.agent_id);

  return jsonb_build_object(
    'proposal_id',p_proposal_id,'agent_id',v_case.agent_id,
    'domain',v_case.domain,'decision',p_decision,
    'reviewed_by',p_operator_id,'reviewed_at',v_case.reviewed_at,
    'materialized',v_materialized,
    'wake_request_id',v_arb->'wake_request_id',
    'note','Decision applies to expertise + viability as one unit. Approval authorizes development but does not verify competence, revenue, funding, or measured impact.'
  );
end
$function$
;
