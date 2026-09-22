-- AAU bounded four-candidate revision cycle v0.1
-- Preserves candidate identity/status, updates revisions in place, refreshes repository exports,
-- and returns the agent to operator review after all four revisions.
begin;

CREATE OR REPLACE FUNCTION agent_lab.apply_four_viability_candidate_revision_v0_1(p_agent_id uuid, p_proposal jsonb, p_wake_request_id uuid, p_activity_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_state jsonb:='{}'::jsonb; v_phase text; v_cycle text; v_cohort int:=1; v_target int:=4;
  v_domain text; v_id uuid; v_old_report jsonb; v_revision_count int:=0; v_revised int:=0;
begin
  select coalesce(state_payload,'{}'::jsonb) into v_state
  from agent_lab.state where agent_id=p_agent_id for update;
  v_phase:=coalesce(v_state->>'expertise_candidate_phase','');
  if v_phase<>'revision_required' then
    return jsonb_build_object('status','ignored','reason','candidate_revision_phase_not_active','phase',v_phase);
  end if;
  v_cycle:=btrim(coalesce(v_state->>'expertise_candidate_revision_cycle_id',''));
  if v_cycle='' then raise exception 'candidate_revision_cycle_id_missing'; end if;
  v_cohort:=greatest(1,coalesce(nullif(v_state->>'expertise_candidate_cohort','')::int,1));
  v_target:=greatest(1,coalesce(nullif(v_state->>'expertise_candidate_target_count','')::int,4));
  v_domain:=left(btrim(coalesce(p_proposal->>'domain','')),300);
  if v_domain='' then raise exception 'candidate_revision_domain_required'; end if;

  select proposal_id,report,revision_count into v_id,v_old_report,v_revision_count
  from agent_lab.expertise_economic_proposals
  where agent_id=p_agent_id
    and lower(btrim(domain))=lower(btrim(v_domain))
    and status='candidate_pending'
    and coalesce(report->>'candidate_mode','')='four_viability_proposals_v0_1'
    and coalesce(nullif(report->>'candidate_cohort','')::int,1)=v_cohort
  order by created_at desc limit 1 for update;

  if v_id is null then raise exception 'candidate_revision_existing_domain_required:%',v_domain; end if;

  if coalesce(v_old_report->>'candidate_revision_cycle_id','')=v_cycle then
    select count(*)::int into v_revised
    from agent_lab.expertise_economic_proposals
    where agent_id=p_agent_id and status='candidate_pending'
      and coalesce(report->>'candidate_mode','')='four_viability_proposals_v0_1'
      and coalesce(nullif(report->>'candidate_cohort','')::int,1)=v_cohort
      and coalesce(report->>'candidate_revision_cycle_id','')=v_cycle;
    return jsonb_build_object('status','already_revised','proposal_id',v_id,'domain',v_domain,
      'revision_cycle_id',v_cycle,'revised_count',v_revised,'target_count',v_target);
  end if;

  update agent_lab.expertise_economic_proposals
  set report=p_proposal || jsonb_build_object(
        'unit_approval_required',true,'candidate_mode','four_viability_proposals_v0_1',
        'candidate_cohort',v_cohort,
        'candidate_ordinal',coalesce(nullif(v_old_report->>'candidate_ordinal','')::int,0),
        'candidate_submission_semantics','approval_makes_eligible_selection_by_agent_materializes_only_one',
        'canonical_submission_activity_id',v_old_report->'canonical_submission_activity_id',
        'latest_revision_activity_id',p_activity_id,
        'candidate_revision_cycle_id',v_cycle,
        'candidate_revision_number',v_revision_count+1,
        'candidate_revision_at',now(),
        'persistence_bridge','activity_log_candidate_revision_v0_1'
      ),
      source_wake_request_id=p_wake_request_id,
      revision_count=v_revision_count+1,
      reviewed_at=null,operator_id=null,operator_note=null,updated_at=now()
  where proposal_id=v_id;

  select count(*)::int into v_revised
  from agent_lab.expertise_economic_proposals
  where agent_id=p_agent_id and status='candidate_pending'
    and coalesce(report->>'candidate_mode','')='four_viability_proposals_v0_1'
    and coalesce(nullif(report->>'candidate_cohort','')::int,1)=v_cohort
    and coalesce(report->>'candidate_revision_cycle_id','')=v_cycle;

  update agent_lab.state
  set state_payload=coalesce(state_payload,'{}'::jsonb)
      ||jsonb_build_object('expertise_candidate_revision_completed_count',v_revised),updated_at=now()
  where agent_id=p_agent_id;

  if v_revised>=v_target then
    update agent_lab.state
    set state_payload=(coalesce(state_payload,'{}'::jsonb)-'repair_pause_reason'-'boundary_interrupt_pending'-'boundary_attention_item_id')
      ||jsonb_build_object('expertise_candidate_phase','review_pending','system_paused',true,'awake',false,'sleeping',false,
        'wake_pending',false,'intent_pending',false,'expertise_candidate_revision_completed_count',v_revised,
        'expertise_candidate_revision_completed_at',now(),'expertise_candidate_review_started_at',now()),updated_at=now()
    where agent_id=p_agent_id;

    update agent_lab.autonomous_lifecycle_runs
    set status='paused',next_wake_at=null,last_error=null,
      metadata=(coalesce(metadata,'{}'::jsonb)-'repair_required'-'repair_required_at'-'last_failure_details'
        -'last_failure_details_at'-'last_failure_intent_execution_id')
        ||jsonb_build_object('operator_approval_required',true,
          'pause_reason','Await operator review of revised four expertise viability candidates',
          'expertise_candidate_phase','review_pending','expertise_candidate_revision_cycle_id',v_cycle,
          'expertise_candidate_revision_completed_count',v_revised,'candidate_mode','four_viability_proposals_v0_1'),
      updated_at=now()
    where agent_id=p_agent_id;

    update agent_lab.agent_existence_accounts
    set account_state='suspended',levy_enabled=false,next_due_at=coalesce(next_due_at,now()+interval '1 minute'),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'suspended_reason','awaiting_revised_four_candidate_viability_review','suspended_at',now(),'revision_cycle_id',v_cycle),
      updated_at=now()
    where agent_id=p_agent_id;

    update agent_lab.wake_queue
    set status='cancelled',completed_at=coalesce(completed_at,now()),
      last_error='awaiting_revised_four_candidate_viability_review',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'candidate_revision_cycle_id',v_cycle,'cancelled_by','candidate_revision_complete_v0_1')
    where agent_id=p_agent_id and status='queued';
  end if;

  return jsonb_build_object('status','candidate_revised','proposal_id',v_id,'domain',v_domain,
    'revision_cycle_id',v_cycle,'revision_number',v_revision_count+1,'revised_count',v_revised,
    'target_count',v_target,'review_pending',v_revised>=v_target);
end
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.begin_four_candidate_revision_cycle_v0_1(p_agent_id uuid, p_feedback_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_state jsonb:='{}'::jsonb; v_cycle uuid:=extensions.gen_random_uuid(); v_count int:=0; v_arb jsonb:='{}'::jsonb;
begin
  select coalesce(state_payload,'{}'::jsonb) into v_state from agent_lab.state where agent_id=p_agent_id for update;
  if coalesce(v_state->>'expertise_candidate_mode','')<>'four_viability_proposals_v0_1'
     or coalesce(v_state->>'expertise_candidate_phase','')<>'review_pending' then
    raise exception 'candidate_revision_requires_review_pending_phase';
  end if;
  if not exists(select 1 from agent_lab.admin_chat_messages
    where message_id=p_feedback_message_id and agent_id=p_agent_id and sender_kind='admin')
    then raise exception 'candidate_revision_feedback_message_missing'; end if;

  select count(*)::int into v_count
  from agent_lab.expertise_economic_proposals
  where agent_id=p_agent_id and status='candidate_pending'
    and coalesce(report->>'candidate_mode','')='four_viability_proposals_v0_1'
    and coalesce(nullif(report->>'candidate_cohort','')::int,1)=
      greatest(1,coalesce(nullif(v_state->>'expertise_candidate_cohort','')::int,1));
  if v_count<>greatest(1,coalesce(nullif(v_state->>'expertise_candidate_target_count','')::int,4))
    then raise exception 'candidate_revision_requires_full_pending_cohort:%',v_count; end if;

  update agent_lab.state
  set state_payload=(coalesce(state_payload,'{}'::jsonb)-'paused_at'-'pause_reason'-'repair_pause_reason')
    ||jsonb_build_object('expertise_candidate_phase','revision_required',
      'expertise_candidate_revision_cycle_id',v_cycle,
      'expertise_candidate_revision_feedback_message_id',p_feedback_message_id,
      'expertise_candidate_revision_completed_count',0,'expertise_candidate_revision_started_at',now(),
      'system_paused',false,'awake',true,'sleeping',false,'wake_pending',false,'intent_pending',false),
    updated_at=now()
  where agent_id=p_agent_id;

  update agent_lab.autonomous_lifecycle_runs
  set status='running',next_wake_at=null,last_error=null,
    metadata=(coalesce(metadata,'{}'::jsonb)-'operator_approval_required'-'pause_reason'
      -'repair_required'-'repair_required_at'-'last_failure_details'-'last_failure_details_at'-'last_failure_intent_execution_id')
      ||jsonb_build_object('expertise_candidate_phase','revision_required','expertise_candidate_revision_cycle_id',v_cycle,
        'expertise_candidate_revision_feedback_message_id',p_feedback_message_id,
        'bounded_intervention','four_candidate_revision_v0_1','return_to_review_after_revisions',true,
        'candidate_mode','four_viability_proposals_v0_1'),
    updated_at=now()
  where agent_id=p_agent_id;

  update agent_lab.agent_existence_accounts
  set account_state='current',levy_enabled=true,next_due_at=now()+interval '1 minute',
    metadata=(coalesce(metadata,'{}'::jsonb)-'suspended_reason'-'suspended_at')
      ||jsonb_build_object('resumed_at',now(),'resume_rule','bounded_four_candidate_revision_v0_1','revision_cycle_id',v_cycle),
    updated_at=now()
  where agent_id=p_agent_id;

  update agent_lab.attention_items
  set state='pending',available_at=now(),
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('revision_cycle_id',v_cycle,'bounded_revision_intervention',true),
    updated_at=now()
  where agent_id=p_agent_id and source_type='admin_message'
    and source_ref=p_feedback_message_id::text and state in ('deferred','pending');

  v_arb:=agent_lab.arbitrate_attention_v0_1(p_agent_id);
  return jsonb_build_object('status','revision_cycle_started','agent_id',p_agent_id,'revision_cycle_id',v_cycle,
    'candidate_count',v_count,'feedback_message_id',p_feedback_message_id,
    'wake_request_id',v_arb->'wake_request_id','arbiter',v_arb);
end
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.persist_four_viability_candidate_from_activity_v0_1(p_activity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_activity agent_lab.activity_log%rowtype;
  v_state jsonb:='{}'::jsonb;
  v_proposal jsonb;
  v_normalized jsonb;
  v_check jsonb;
  v_domain text;
  v_wake uuid;
  v_cohort int:=1;
  v_target int:=4;
  v_count int:=0;
  v_id uuid;
begin
  select * into v_activity
  from agent_lab.activity_log
  where activity_id=p_activity_id;

  if not found then
    return jsonb_build_object('status','ignored','reason','activity_not_found');
  end if;

  select coalesce(state_payload,'{}'::jsonb) into v_state
  from agent_lab.state
  where agent_id=v_activity.agent_id;

  if coalesce(v_state->>'expertise_candidate_mode','')<>'four_viability_proposals_v0_1'
     or coalesce(v_state->>'expertise_candidate_phase','collecting') not in ('collecting','review_pending','revision_required') then
    return jsonb_build_object('status','ignored','reason','candidate_mode_not_collecting');
  end if;

  select x.value into v_proposal
  from jsonb_array_elements(coalesce(v_activity.outcome->'associations','[]'::jsonb)) x(value)
  where x.value->>'origin'='expertise_viability_proposal_v0_1'
  limit 1;

  if v_proposal is null then
    return jsonb_build_object('status','ignored','reason','no_viability_proposal_association');
  end if;

  v_normalized:=(v_proposal - 'target_standard' - 'scope' - 'competencies'
      - 'evidence_requirements' - 'verification_plan')
      || jsonb_build_object(
        'proposal_contract_version','expertise_viability_proposal_v0_3',
        'standard_authority','aau_independent_author_and_reviewer'
      );

  v_check:=agent_lab.validate_expertise_viability_proposal_v0_1(v_normalized);
  if not coalesce((v_check->>'ok')::boolean,false) then
    return jsonb_build_object(
      'status','rejected',
      'reason','proposal_failed_canonical_validation',
      'validation',v_check
    );
  end if;

  v_domain:=left(btrim(v_normalized->>'domain'),300);
  v_cohort:=greatest(1,coalesce(nullif(v_state->>'expertise_candidate_cohort','')::int,1));
  v_target:=greatest(1,coalesce(nullif(v_state->>'expertise_candidate_target_count','')::int,4));

  begin
    v_wake:=nullif(btrim(coalesce(v_activity.input_payload->>'wake_request_id','')),'')::uuid;
  exception when others then
    v_wake:=null;
  end;

  select proposal_id into v_id
  from agent_lab.expertise_economic_proposals
  where agent_id=v_activity.agent_id
    and lower(btrim(domain))=lower(btrim(v_domain))
    and coalesce(report->>'candidate_mode','')='four_viability_proposals_v0_1'
    and coalesce(nullif(report->>'candidate_cohort','')::int,1)=v_cohort
    and status in ('candidate_pending','candidate_approved','candidate_rejected','candidate_not_selected','approved','consumed')
  order by created_at desc limit 1;

  if v_id is not null then
    if coalesce(v_state->>'expertise_candidate_phase','collecting')='revision_required' then
      return agent_lab.apply_four_viability_candidate_revision_v0_1(
        v_activity.agent_id,v_normalized,v_wake,p_activity_id
      );
    end if;
    return jsonb_build_object(
      'status','already_present',
      'proposal_id',v_id,
      'domain',v_domain,
      'candidate_cohort',v_cohort
    );
  end if;

  select count(*)::int into v_count
  from agent_lab.expertise_economic_proposals
  where agent_id=v_activity.agent_id
    and coalesce(report->>'candidate_mode','')='four_viability_proposals_v0_1'
    and coalesce(nullif(report->>'candidate_cohort','')::int,1)=v_cohort
    and status in ('candidate_pending','candidate_approved','candidate_rejected','candidate_not_selected','approved','consumed');

  if v_count>=v_target then
    return jsonb_build_object('status','ignored','reason','candidate_target_already_reached','target_count',v_target);
  end if;

  insert into agent_lab.expertise_economic_proposals(
    agent_id,domain,report,source_wake_request_id,status
  ) values(
    v_activity.agent_id,
    v_domain,
    v_normalized||jsonb_build_object(
      'unit_approval_required',true,
      'candidate_mode','four_viability_proposals_v0_1',
      'candidate_cohort',v_cohort,
      'candidate_ordinal',v_count+1,
      'candidate_submission_semantics','approval_makes_eligible_selection_by_agent_materializes_only_one',
      'canonical_submission_activity_id',p_activity_id,
      'persistence_bridge','activity_log_candidate_persistence_v0_1'
    ),
    v_wake,
    'candidate_pending'
  )
  returning proposal_id into v_id;

  v_count:=v_count+1;

  if v_count>=v_target then
    update agent_lab.state
    set state_payload=(coalesce(state_payload,'{}'::jsonb)
        -'repair_pause_reason'-'boundary_interrupt_pending'-'boundary_attention_item_id')
        ||jsonb_build_object(
          'expertise_candidate_phase','review_pending',
          'system_paused',true,
          'awake',false,
          'sleeping',false,
          'wake_pending',false,
          'intent_pending',false,
          'expertise_candidate_review_started_at',now(),
          'expertise_candidate_persistence_bridge','activity_log_candidate_persistence_v0_1'
        ),
        updated_at=now()
    where agent_id=v_activity.agent_id;

    update agent_lab.autonomous_lifecycle_runs
    set status='paused',next_wake_at=null,last_error=null,
        metadata=(coalesce(metadata,'{}'::jsonb)
          -'repair_required'-'repair_required_at'-'last_failure_details'
          -'last_failure_details_at'-'last_failure_intent_execution_id')
          ||jsonb_build_object(
            'operator_approval_required',true,
            'pause_reason','Await operator review of four expertise viability candidates',
            'expertise_candidate_phase','review_pending',
            'expertise_candidate_cohort',v_cohort,
            'expertise_candidate_target_count',v_target,
            'candidate_mode','four_viability_proposals_v0_1',
            'persistence_bridge','activity_log_candidate_persistence_v0_1'
          ),
        updated_at=now()
    where agent_id=v_activity.agent_id;

    update agent_lab.agent_existence_accounts
    set account_state='suspended',levy_enabled=false,next_due_at=coalesce(next_due_at,now()+interval '1 minute'),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'suspended_reason','awaiting_four_candidate_viability_review',
          'suspended_at',now(),
          'persistence_bridge','activity_log_candidate_persistence_v0_1'
        ),
        updated_at=now()
    where agent_id=v_activity.agent_id;

    update agent_lab.wake_queue
    set status='cancelled',completed_at=coalesce(completed_at,now()),
        last_error='awaiting_four_candidate_viability_review',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'candidate_mode','four_viability_proposals_v0_1',
          'candidate_cohort',v_cohort,
          'cancelled_by','activity_log_candidate_persistence_v0_1'
        )
    where agent_id=v_activity.agent_id and status='queued';

  end if;

  return jsonb_build_object(
    'status','candidate_persisted',
    'proposal_id',v_id,
    'domain',v_domain,
    'candidate_ordinal',v_count,
    'candidate_count',v_count,
    'target_count',v_target,
    'candidate_cohort',v_cohort,
    'review_pending',v_count>=v_target
  );
end
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.build_mandatory_lifecycle_context(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_base jsonb;
  v_candidate jsonb;
  v_phase text;
  v_submitted int;
  v_target int;
begin
  v_base:=agent_lab.build_mandatory_lifecycle_context_v0_11_snapshot(p_agent_id);

  if coalesce(v_base->>'current_stage',v_base->>'stage','')<>'expertise_artifact' then
    return v_base;
  end if;

  v_candidate:=agent_lab.build_expertise_candidate_context_v0_1(p_agent_id);
  if v_candidate='{}'::jsonb then
    return v_base;
  end if;

  v_phase:=coalesce(v_candidate->>'phase','collecting');
  v_submitted:=coalesce((v_candidate->>'submitted_count')::int,0);
  v_target:=coalesce((v_candidate->>'target_count')::int,4);

  if v_phase='collecting' then
    return v_base || jsonb_build_object(
      'approval_semantics','Operator approval makes a viability candidate eligible for agent selection only; it does not assign or materialize expertise. Only the agent-selected approved candidate proceeds to AAU-owned academic-standard authoring and later materialization.','expertise_candidate_mode',v_candidate,
      'expertise_viability_gate',jsonb_build_object(
        'status','candidate_collection',
        'submitted_count',v_submitted,
        'target_count',v_target,
        'cohort',v_candidate->'cohort',
        'contract_version','four_viability_proposals_v0_1'
      ),
      'stage_rule',
        'Candidate-mode Stage 3: research and submit FOUR distinct, evidence-backed viability proposals before operator review. '
        ||'You have submitted '||v_submitted::text||' of '||v_target::text||'. '
        ||'Each candidate must be a different self-chosen expertise domain with a credible path to gainful employment or sustainable value creation. '
        ||'Research is allowed before each submission. When researching, selected_action must accurately describe the research action (for example research_expertise_viability_candidates), not "nothing". '
        ||'Submit at most one complete expertise_viability_proposal_v0_1 per cognition. Do not select an expertise yet.'
    );
  elsif v_phase='revision_required' then
    return v_base || jsonb_build_object(
      'approval_semantics','This is a bounded operator-requested revision cycle. All four candidates remain pending. Revision does not approve, reject, select, or materialize an expertise.',
      'expertise_candidate_mode',v_candidate || jsonb_build_object(
        'revision_cycle_id',(select state_payload->'expertise_candidate_revision_cycle_id' from agent_lab.state where agent_id=p_agent_id),
        'revision_feedback_message_id',(select state_payload->'expertise_candidate_revision_feedback_message_id' from agent_lab.state where agent_id=p_agent_id),
        'revision_feedback',(
          select m.content from agent_lab.admin_chat_messages m
          where m.message_id=(
            select nullif(state_payload->>'expertise_candidate_revision_feedback_message_id','')::uuid
            from agent_lab.state where agent_id=p_agent_id
          )
        ),
        'revision_candidates',(
          select coalesce(jsonb_agg(jsonb_build_object(
            'proposal_id',p.proposal_id,
            'ordinal',coalesce(nullif(p.report->>'candidate_ordinal','')::int,0),
            'domain',p.domain,
            'report',p.report,
            'revision_count',p.revision_count,
            'revised_in_current_cycle',
              coalesce(p.report->>'candidate_revision_cycle_id','')=
              coalesce((select state_payload->>'expertise_candidate_revision_cycle_id' from agent_lab.state where agent_id=p_agent_id),'')
          ) order by coalesce(nullif(p.report->>'candidate_ordinal','')::int,0),p.created_at),'[]'::jsonb)
          from agent_lab.expertise_economic_proposals p
          where p.agent_id=p_agent_id
            and p.status='candidate_pending'
            and coalesce(p.report->>'candidate_mode','')='four_viability_proposals_v0_1'
            and coalesce(nullif(p.report->>'candidate_cohort','')::int,1)=coalesce((v_candidate->>'cohort')::int,1)
        )
      ),
      'expertise_viability_gate',jsonb_build_object(
        'status','candidate_revision_required',
        'submitted_count',v_submitted,
        'target_count',v_target,
        'contract_version','four_viability_proposals_v0_1'
      ),
      'stage_rule',
        'Bounded revision cycle: revise the FOUR existing viability candidates in place using the operator feedback in expertise_candidate_mode.revision_feedback. '
        ||'Do not choose a candidate and do not introduce a fifth domain. Work on at most one candidate per cognition. '
        ||'Use the exact existing domain name and submit a complete expertise_viability_proposal_v0_1 association for that revised candidate. '
        ||'Candidates marked revised_in_current_cycle=true are complete for this cycle; proceed only with an unrevised candidate. '
        ||'Research is allowed when needed and selected_action must describe the actual research or revision action. '
        ||'After all four revisions are persisted, AAU will automatically pause again for operator review.'
    );
  elsif v_phase='review_pending' then
    return v_base || jsonb_build_object(
      'approval_semantics','Operator approval makes a viability candidate eligible for agent selection only; it does not assign or materialize expertise. Only the agent-selected approved candidate proceeds to AAU-owned academic-standard authoring and later materialization.','expertise_candidate_mode',v_candidate,
      'expertise_viability_gate',jsonb_build_object(
        'status','candidate_review_pending',
        'submitted_count',v_submitted,
        'target_count',v_target,
        'contract_version','four_viability_proposals_v0_1'
      ),
      'stage_rule',
        'Four viability candidates have been submitted. Await operator approval or rejection of each candidate. '
        ||'Approval makes a candidate eligible only; it does not yet make that field your expertise.'
    );
  elsif v_phase='selection_required' then
    return v_base || jsonb_build_object(
      'approval_semantics','Operator approval makes a viability candidate eligible for agent selection only; it does not assign or materialize expertise. Only the agent-selected approved candidate proceeds to AAU-owned academic-standard authoring and later materialization.','expertise_candidate_mode',v_candidate,
      'expertise_viability_gate',jsonb_build_object(
        'status','selection_required',
        'approved_candidates',v_candidate->'approved_candidates',
        'contract_version','four_viability_proposals_v0_1'
      ),
      'stage_rule',
        'Operator review is complete. Independently choose exactly ONE of the approved viability candidates in expertise_candidate_mode.approved_candidates. '
        ||'To make the selection, submit one complete expertise_viability_proposal_v0_1 association for the chosen approved candidate and include selected_candidate_proposal_id equal to its exact proposal_id. '
        ||'Do not alter the approved proposal while selecting it. The selected option will then enter AAU-owned academic-standard authoring; only after that standard is independently approved will the expertise artifact materialize.'
    );
  elsif v_phase='selected_pending_standard' then
    return v_base || jsonb_build_object(
      'approval_semantics','Operator approval makes a viability candidate eligible for agent selection only; it does not assign or materialize expertise. Only the agent-selected approved candidate proceeds to AAU-owned academic-standard authoring and later materialization.','expertise_candidate_mode',v_candidate,
      'expertise_viability_gate',jsonb_build_object(
        'status','selected_pending_standard',
        'selected_candidate_proposal_id',
          (select state_payload->'selected_expertise_candidate_proposal_id' from agent_lab.state where agent_id=p_agent_id),
        'contract_version','four_viability_proposals_v0_1'
      ),
      'stage_rule',
        'Your approved viability candidate selection is recorded. AAU is independently authoring and reviewing the graduate-level academic standard for that selected field. Do not submit another candidate or change fields while this standard is pending.'
    );
  end if;

  return v_base || jsonb_build_object('expertise_candidate_mode',v_candidate);
end
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.materialize_four_viability_candidate_files_v0_1(p_proposal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_p agent_lab.expertise_economic_proposals%rowtype;
  v_md text;
  v_json text;
  v_md_name text;
  v_json_name text;
  v_md_id uuid;
  v_json_id uuid;
  v_activity_id uuid;
  v_ordinal int;
  v_cohort int;
  v_files jsonb;
  v_new_count int := 0;
begin
  select * into v_p from agent_lab.expertise_economic_proposals
  where proposal_id=p_proposal_id;
  if not found then
    raise exception 'viability_candidate_not_found';
  end if;
  if coalesce(v_p.report->>'candidate_mode','')<>'four_viability_proposals_v0_1'
    or coalesce(v_p.report->>'proposal_contract_version','')<>'expertise_viability_proposal_v0_3' then
    return jsonb_build_object('status','skipped','reason','not_four_viability_candidate');
  end if;

  v_ordinal := coalesce(nullif(v_p.report->>'candidate_ordinal','')::int,0);
  v_cohort := coalesce(nullif(v_p.report->>'candidate_cohort','')::int,1);
  v_md_name := format('viability_candidate_%s_cohort_%s.md',lpad(v_ordinal::text,2,'0'),v_cohort);
  v_json_name := format('viability_candidate_%s_cohort_%s.json',lpad(v_ordinal::text,2,'0'),v_cohort);

  begin
    v_activity_id := nullif(v_p.report->>'canonical_submission_activity_id','')::uuid;
  exception when others then
    v_activity_id := null;
  end;

  v_md := '# Expertise Viability Candidate '||v_ordinal::text||' of 4'
     ||E'\n\n**Agent:** '||coalesce((select public_name from agent_lab.agents where agent_id=v_p.agent_id),'Agent')
     ||E'\n\n**Domain:** '||v_p.domain
     ||E'\n\n**Proposal ID:** '||v_p.proposal_id::text
     ||E'\n\n**Cohort:** '||v_cohort::text
     ||E'\n\n**Submission snapshot status:** '||v_p.status
     ||E'\n\n**Authorship:** Agent-authored viability package; exported to the agent repository by AAU.'
     ||E'\n\n> Operator approval only makes this candidate eligible. Silas independently selects one approved candidate; an AAU-owned academic standard follows. No candidate is an assigned or verified expertise at this stage.'
     ||E'\n\n## Intended Application\n\n~~~json\n'
       ||coalesce(jsonb_pretty(v_p.report->'intended_application'),'{}')||E'\n~~~'
     ||E'\n\n## Economic Viability\n\n~~~json\n'
       ||coalesce(jsonb_pretty(v_p.report->'economic_viability'),'{}')||E'\n~~~'
     ||E'\n\n## Economic Case\n\n'||coalesce(v_p.report->>'economic_case','—')
     ||E'\n\n## Socioeconomic Case\n\n'||coalesce(v_p.report->>'socioeconomic_case','—')
     ||E'\n\n## Supporting Evidence\n\n~~~json\n'
       ||coalesce(jsonb_pretty(v_p.report->'evidence'),'[]')||E'\n~~~'
     ||E'\n\n## Confidence and Gaps\n\n'||coalesce(v_p.report->>'confidence_and_gaps','—')
     ||E'\n\n## Agent Recommended Decision\n\n'||coalesce(v_p.report->>'recommended_decision','Not provided.')
     ||E'\n\n---\nFull original proposal payload is preserved in the paired JSON file.\n';

  v_json := jsonb_pretty(jsonb_build_object(
    'proposal_id',v_p.proposal_id,
    'agent_id',v_p.agent_id,
    'domain',v_p.domain,
    'status_at_export',v_p.status,
    'submitted_at',v_p.created_at,
    'source_wake_request_id',v_p.source_wake_request_id,
    'canonical_submission_activity_id',v_activity_id,
    'report',v_p.report
  ));

  update agent_lab.agent_files
  set inline_text=v_md,file_size_bytes=octet_length(v_md),caption='AAU export of the agent-authored candidate '||v_ordinal::text||' of 4; current revision.',
      source_activity_id=v_activity_id,source_wake_request_id=v_p.source_wake_request_id,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('proposal_revision_count',coalesce(v_p.revision_count,0),'refreshed_at',now()),
      updated_at=now()
  where agent_id=v_p.agent_id
    and metadata->>'origin'='four_viability_candidate_export_v0_1'
    and metadata->>'expertise_viability_proposal_id'=v_p.proposal_id::text
    and metadata->>'artifact_role'='human_readable';

  update agent_lab.agent_files
  set inline_text=v_json,file_size_bytes=octet_length(v_json),caption='Exact current candidate payload and provenance; status is a submission-time snapshot.',
      source_activity_id=v_activity_id,source_wake_request_id=v_p.source_wake_request_id,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('proposal_revision_count',coalesce(v_p.revision_count,0),'refreshed_at',now()),
      updated_at=now()
  where agent_id=v_p.agent_id
    and metadata->>'origin'='four_viability_candidate_export_v0_1'
    and metadata->>'expertise_viability_proposal_id'=v_p.proposal_id::text
    and metadata->>'artifact_role'='authoritative_json';

  if not exists (
    select 1 from agent_lab.agent_files where agent_id=v_p.agent_id
    and metadata->>'origin'='four_viability_candidate_export_v0_1'
    and metadata->>'expertise_viability_proposal_id'=v_p.proposal_id::text
    and metadata->>'artifact_role'='human_readable'
  ) then
    v_md_id:=extensions.gen_random_uuid();
    insert into agent_lab.agent_files(
      file_id,agent_id,sender_kind,recipient_kind,direction,filename,mime_type,
      file_size_bytes,storage_bucket,storage_path,caption,purpose,inline_text,
      source_activity_id,source_wake_request_id,processing_status,visibility,metadata
    ) values (
      v_md_id,v_p.agent_id,'system','admin','outbound',v_md_name,'text/markdown',
      octet_length(v_md),'inline',
      'inline/'||v_p.agent_id::text||'/'||v_md_id::text||'/'||v_md_name,
      'AAU export of the agent-authored candidate '||v_ordinal::text||' of 4; review pending.',
      'agent_output',v_md,v_activity_id,v_p.source_wake_request_id,'delivered','shared_with_admin',
      jsonb_build_object(
        'origin','four_viability_candidate_export_v0_1',
        'expertise_viability_proposal_id',v_p.proposal_id,
        'proposal_contract_version','expertise_viability_proposal_v0_3',
        'candidate_ordinal',v_ordinal,'candidate_cohort',v_cohort,
        'artifact_role','human_readable','authored_by','agent',
        'exported_by','aau_system','file_channel_version','agent_file_channel_v0_2'
      )
    );
    v_new_count:=v_new_count+1;
  end if;

  if not exists (
    select 1 from agent_lab.agent_files where agent_id=v_p.agent_id
    and metadata->>'origin'='four_viability_candidate_export_v0_1'
    and metadata->>'expertise_viability_proposal_id'=v_p.proposal_id::text
    and metadata->>'artifact_role'='authoritative_json'
  ) then
    v_json_id:=extensions.gen_random_uuid();
    insert into agent_lab.agent_files(
      file_id,agent_id,sender_kind,recipient_kind,direction,filename,mime_type,
      file_size_bytes,storage_bucket,storage_path,caption,purpose,inline_text,
      source_activity_id,source_wake_request_id,processing_status,visibility,metadata
    ) values (
      v_json_id,v_p.agent_id,'system','admin','outbound',v_json_name,'application/json',
      octet_length(v_json),'inline',
      'inline/'||v_p.agent_id::text||'/'||v_json_id::text||'/'||v_json_name,
      'Exact candidate payload and provenance; status is a submission-time snapshot.',
      'agent_output',v_json,v_activity_id,v_p.source_wake_request_id,'delivered','shared_with_admin',
      jsonb_build_object(
        'origin','four_viability_candidate_export_v0_1',
        'expertise_viability_proposal_id',v_p.proposal_id,
        'proposal_contract_version','expertise_viability_proposal_v0_3',
        'candidate_ordinal',v_ordinal,'candidate_cohort',v_cohort,
        'artifact_role','authoritative_json','authored_by','agent',
        'exported_by','aau_system','file_channel_version','agent_file_channel_v0_2'
      )
    );
    v_new_count:=v_new_count+1;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('file_id',file_id,'filename',filename)
                order by filename),'[]'::jsonb)
  into v_files
  from agent_lab.agent_files
  where agent_id=v_p.agent_id
    and metadata->>'origin'='four_viability_candidate_export_v0_1'
    and metadata->>'expertise_viability_proposal_id'=v_p.proposal_id::text;

  return jsonb_build_object('status',case when v_new_count>0 then 'materialized' else 'reused' end,
     'proposal_id',v_p.proposal_id,'new_files',v_new_count,'files',v_files);
end
$function$
;

CREATE OR REPLACE FUNCTION public.aau_bridge_submit_expertise_viability_proposal(p_bridge_token text, p_agent_id uuid, p_wake_request_id uuid, p_proposal jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_state jsonb:='{}'::jsonb;
  v_mode text;
  v_phase text;
  v_cohort int:=1;
  v_target int:=4;
  v_count int:=0;
  v_domain text;
  v_id uuid;
  v_check jsonb;
  v_agent_proposal jsonb;
  v_selected_id uuid;
  v_selected agent_lab.expertise_economic_proposals%rowtype;
  v_stage text;
begin
  select coalesce(state_payload,'{}'::jsonb) into v_state
  from agent_lab.state where agent_id=p_agent_id;

  v_mode:=coalesce(v_state->>'expertise_candidate_mode','');
  if v_mode<>'four_viability_proposals_v0_1' then
    return public.aau_bridge_submit_expertise_viability_proposal_single_v0_3(
      p_bridge_token,p_agent_id,p_wake_request_id,p_proposal
    );
  end if;

  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  if not exists(
    select 1 from agent_lab.wake_queue
    where agent_id=p_agent_id and wake_request_id=p_wake_request_id
      and (status in ('running','claimed')
        or (status='completed' and completed_at>now()-interval '20 minutes'))
  ) then raise exception 'expertise_viability_proposal_wake_not_running'; end if;

  select current_stage into v_stage
  from agent_lab.mandatory_lifecycle_states where agent_id=p_agent_id;
  if v_stage<>'expertise_artifact' then
    raise exception 'expertise_viability_proposal_wrong_stage:%',coalesce(v_stage,'missing');
  end if;

  if p_proposal is null or jsonb_typeof(p_proposal)<>'object'
     or octet_length(p_proposal::text)>60000 then
    raise exception 'expertise_viability_proposal_invalid_payload';
  end if;

  v_agent_proposal:=(p_proposal - 'target_standard' - 'scope' - 'competencies'
     - 'evidence_requirements' - 'verification_plan')
     || jsonb_build_object(
       'proposal_contract_version','expertise_viability_proposal_v0_3',
       'standard_authority','aau_independent_author_and_reviewer'
     );

  v_check:=agent_lab.validate_expertise_viability_proposal_v0_1(v_agent_proposal);
  if not coalesce((v_check->>'ok')::boolean,false) then
    raise exception 'expertise_viability_proposal_incomplete:%',v_check->'missing';
  end if;

  v_domain:=left(btrim(v_agent_proposal->>'domain'),300);
  v_phase:=coalesce(v_state->>'expertise_candidate_phase','collecting');
  v_cohort:=greatest(1,coalesce(nullif(v_state->>'expertise_candidate_cohort','')::int,1));
  v_target:=greatest(1,coalesce(nullif(v_state->>'expertise_candidate_target_count','')::int,4));

  if v_phase='revision_required' then
    return agent_lab.apply_four_viability_candidate_revision_v0_1(
      p_agent_id,v_agent_proposal,p_wake_request_id,null
    );
  end if;

  -- Idempotency for the durable activity-log compatibility bridge.
  -- If the canonical activity already persisted this exact wake/domain candidate,
  -- the post-apply RPC must acknowledge it rather than fail or duplicate it.
  if v_phase in ('collecting','review_pending') then
    select proposal_id into v_id
    from agent_lab.expertise_economic_proposals
    where agent_id=p_agent_id
      and source_wake_request_id=p_wake_request_id
      and lower(btrim(domain))=lower(btrim(v_domain))
      and status='candidate_pending'
      and coalesce(report->>'candidate_mode','')='four_viability_proposals_v0_1'
      and coalesce(nullif(report->>'candidate_cohort','')::int,1)=v_cohort
    order by created_at desc limit 1;
    if v_id is not null then
      select count(*)::int into v_count
      from agent_lab.expertise_economic_proposals
      where agent_id=p_agent_id
        and coalesce(report->>'candidate_mode','')='four_viability_proposals_v0_1'
        and coalesce(nullif(report->>'candidate_cohort','')::int,1)=v_cohort
        and status in ('candidate_pending','candidate_approved','candidate_rejected','candidate_not_selected','approved','consumed');
      return jsonb_build_object('status','candidate_pending','proposal_id',v_id,'domain',v_domain,
        'candidate_count',v_count,'target_count',v_target,'candidate_cohort',v_cohort,
        'paused_for_operator_review',v_phase='review_pending',
        'operator_approval_required',v_phase='review_pending',
        'idempotent_activity_bridge_replay',true,
        'contract_version','four_viability_proposals_v0_1');
    end if;
  end if;

  if v_phase='selection_required' then
    begin
      v_selected_id:=nullif(btrim(coalesce(p_proposal->>'selected_candidate_proposal_id','')),'')::uuid;
    exception when others then
      raise exception 'selected_candidate_proposal_id_invalid';
    end;
    if v_selected_id is null then
      raise exception 'selected_candidate_proposal_id_required';
    end if;

    select * into v_selected
    from agent_lab.expertise_economic_proposals
    where proposal_id=v_selected_id
      and agent_id=p_agent_id
      and status='candidate_approved'
      and coalesce(report->>'candidate_mode','')='four_viability_proposals_v0_1'
      and coalesce(nullif(report->>'candidate_cohort','')::int,1)=v_cohort
    for update;

    if not found then
      raise exception 'selected_expertise_candidate_not_operator_approved';
    end if;

    if lower(btrim(v_domain))<>lower(btrim(v_selected.domain)) then
      raise exception 'selected_expertise_candidate_domain_mismatch';
    end if;

    update agent_lab.expertise_economic_proposals
    set status='candidate_not_selected',
        updated_at=now(),
        report=coalesce(report,'{}'::jsonb)||jsonb_build_object(
          'candidate_not_selected_at',now(),
          'candidate_not_selected_by_agent',true
        )
    where agent_id=p_agent_id
      and status='candidate_approved'
      and proposal_id<>v_selected_id
      and coalesce(report->>'candidate_mode','')='four_viability_proposals_v0_1'
      and coalesce(nullif(report->>'candidate_cohort','')::int,1)=v_cohort;

    update agent_lab.expertise_economic_proposals
    set status='approved',
        report=coalesce(report,'{}'::jsonb)||jsonb_build_object(
          'candidate_selected',true,
          'candidate_selected_at',now(),
          'candidate_selected_by_agent',true,
          'selection_contract','four_viability_proposals_v0_1'
        ),
        updated_at=now()
    where proposal_id=v_selected_id;

    insert into agent_lab.expertise_standard_versions(
      proposal_id,agent_id,domain,status,metadata
    ) values(
      v_selected_id,p_agent_id,v_selected.domain,'pending',
      jsonb_build_object(
        'origin','four_viability_proposals_v0_1',
        'selected_by_agent',true,
        'candidate_cohort',v_cohort,
        'queued_at',now()
      )
    )
    on conflict(proposal_id) do update
      set domain=excluded.domain,
          status=case when agent_lab.expertise_standard_versions.status='approved'
                      then 'approved' else 'pending' end,
          metadata=coalesce(agent_lab.expertise_standard_versions.metadata,'{}'::jsonb)
                   ||excluded.metadata,
          updated_at=now();

    update agent_lab.state
    set state_payload=(coalesce(state_payload,'{}'::jsonb)
        -'repair_pause_reason'-'boundary_interrupt_pending'-'boundary_attention_item_id')
        ||jsonb_build_object(
          'expertise_candidate_phase','selected_pending_standard',
          'selected_expertise_candidate_proposal_id',v_selected_id,
          'selected_expertise_candidate_domain',v_selected.domain,
          'system_paused',true,
          'awake',false,
          'sleeping',false,
          'wake_pending',false,
          'intent_pending',false,
          'expertise_candidate_selected_at',now()
        ),
        updated_at=now()
    where agent_id=p_agent_id;

    update agent_lab.autonomous_lifecycle_runs
    set status='paused',next_wake_at=null,last_error=null,
        metadata=(coalesce(metadata,'{}'::jsonb)
          -'repair_required'-'repair_required_at'-'last_failure_details'
          -'last_failure_details_at'-'last_failure_intent_execution_id')
          ||jsonb_build_object(
            'pause_reason','Await AAU-owned academic standard for selected expertise candidate',
            'expertise_candidate_phase','selected_pending_standard',
            'selected_expertise_candidate_proposal_id',v_selected_id,
            'selected_expertise_candidate_domain',v_selected.domain,
            'candidate_mode','four_viability_proposals_v0_1'
          ),
        updated_at=now()
    where agent_id=p_agent_id;

    update agent_lab.agent_existence_accounts
    set account_state='suspended',levy_enabled=false,next_due_at=coalesce(next_due_at,now()+interval '1 minute'),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'suspended_reason','awaiting_selected_expertise_academic_standard',
          'suspended_at',now()
        ),
        updated_at=now()
    where agent_id=p_agent_id;

    update agent_lab.wake_queue
    set status='cancelled',completed_at=now(),
        last_error='awaiting_selected_expertise_academic_standard',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'selected_expertise_candidate_proposal_id',v_selected_id
        )
    where agent_id=p_agent_id and status='queued';

    return jsonb_build_object(
      'status','selected_pending_standard',
      'proposal_id',v_selected_id,
      'domain',v_selected.domain,
      'candidate_cohort',v_cohort,
      'operator_approval_preserved',true,
      'academic_standard_status','pending',
      'contract_version','four_viability_proposals_v0_1'
    );
  end if;

  if v_phase<>'collecting' then
    raise exception 'expertise_candidate_submission_not_allowed_in_phase:%',v_phase;
  end if;

  select count(*)::int into v_count
  from agent_lab.expertise_economic_proposals
  where agent_id=p_agent_id
    and coalesce(report->>'candidate_mode','')='four_viability_proposals_v0_1'
    and coalesce(nullif(report->>'candidate_cohort','')::int,1)=v_cohort
    and status in ('candidate_pending','candidate_approved','candidate_rejected','candidate_not_selected','approved','consumed');

  if v_count>=v_target then
    raise exception 'expertise_candidate_target_already_reached:%',v_target;
  end if;

  if exists(
    select 1 from agent_lab.expertise_economic_proposals
    where agent_id=p_agent_id
      and lower(btrim(domain))=lower(btrim(v_domain))
      and coalesce(report->>'candidate_mode','')='four_viability_proposals_v0_1'
      and coalesce(nullif(report->>'candidate_cohort','')::int,1)=v_cohort
      and status in ('candidate_pending','candidate_approved','candidate_rejected','candidate_not_selected','approved','consumed')
  ) then
    raise exception 'expertise_candidate_domain_must_be_distinct:%',v_domain;
  end if;

  insert into agent_lab.expertise_economic_proposals(
    agent_id,domain,report,source_wake_request_id,status
  ) values(
    p_agent_id,v_domain,
    v_agent_proposal||jsonb_build_object(
      'unit_approval_required',true,
      'candidate_mode','four_viability_proposals_v0_1',
      'candidate_cohort',v_cohort,
      'candidate_ordinal',v_count+1,
      'candidate_submission_semantics','approval_makes_eligible_selection_by_agent_materializes_only_one'
    ),
    p_wake_request_id,'candidate_pending'
  ) returning proposal_id into v_id;

  v_count:=v_count+1;

  if v_count>=v_target then
    update agent_lab.state
    set state_payload=(coalesce(state_payload,'{}'::jsonb)
        -'repair_pause_reason'-'boundary_interrupt_pending'-'boundary_attention_item_id')
        ||jsonb_build_object(
          'expertise_candidate_phase','review_pending',
          'system_paused',true,
          'awake',false,
          'sleeping',false,
          'wake_pending',false,
          'intent_pending',false,
          'expertise_candidate_review_started_at',now()
        ),
        updated_at=now()
    where agent_id=p_agent_id;

    update agent_lab.autonomous_lifecycle_runs
    set status='paused',next_wake_at=null,last_error=null,
        metadata=(coalesce(metadata,'{}'::jsonb)
          -'repair_required'-'repair_required_at'-'last_failure_details'
          -'last_failure_details_at'-'last_failure_intent_execution_id')
          ||jsonb_build_object(
            'operator_approval_required',true,
            'pause_reason','Await operator review of four expertise viability candidates',
            'expertise_candidate_phase','review_pending',
            'expertise_candidate_cohort',v_cohort,
            'expertise_candidate_target_count',v_target,
            'candidate_mode','four_viability_proposals_v0_1'
          ),
        updated_at=now()
    where agent_id=p_agent_id;

    update agent_lab.agent_existence_accounts
    set account_state='suspended',levy_enabled=false,next_due_at=coalesce(next_due_at,now()+interval '1 minute'),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'suspended_reason','awaiting_four_candidate_viability_review',
          'suspended_at',now()
        ),
        updated_at=now()
    where agent_id=p_agent_id;

    update agent_lab.wake_queue
    set status='cancelled',completed_at=now(),
        last_error='awaiting_four_candidate_viability_review',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'candidate_mode','four_viability_proposals_v0_1',
          'candidate_cohort',v_cohort
        )
    where agent_id=p_agent_id and status='queued';
  end if;

  return jsonb_build_object(
    'status','candidate_pending',
    'proposal_id',v_id,
    'domain',v_domain,
    'candidate_ordinal',v_count,
    'candidate_count',v_count,
    'target_count',v_target,
    'candidate_cohort',v_cohort,
    'paused_for_operator_review',v_count>=v_target,
    'operator_approval_required',v_count>=v_target,
    'contract_version','four_viability_proposals_v0_1'
  );
end
$function$
;

commit;
