-- AAU Agent Development Lifecycle v0.12
-- Mandatory Entrepreneurship Master's-equivalent program precedes expertise selection.
-- Internal stage name mba_entrepreneurship is retained for compatibility; public label is entrepreneurship_masters.

begin;

alter table agent_lab.mandatory_lifecycle_states
  drop constraint if exists mandatory_lifecycle_states_current_stage_check;
alter table agent_lab.mandatory_lifecycle_states
  add constraint mandatory_lifecycle_states_current_stage_check
  check (current_stage = any(array[
    'identity_artifact'::text,
    'embodiment_artifact'::text,
    'mba_entrepreneurship'::text,
    'expertise_artifact'::text,
    'expertise_development'::text,
    'product_service_test'::text,
    'open_autonomy'::text
  ]));

alter table agent_lab.mba_entrepreneurship_requirements
  alter column protocol_version set default 'entrepreneurship_masters_v0_1',
  alter column academic_equivalence_level set default 'entrepreneurship_masters_equivalent';

update agent_lab.mba_entrepreneurship_requirements
set protocol_version='entrepreneurship_masters_v0_1',
    academic_equivalence_level=case
      when status='verified_pass' then academic_equivalence_level
      else 'entrepreneurship_masters_equivalent'
    end,
    updated_at=now();

CREATE OR REPLACE FUNCTION agent_lab.refresh_mandatory_lifecycle_state(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_base jsonb;
  v_base_stage text;
  v_stage text;
  v_status text:='pending';
  v_pass boolean:=false;
  v_expertise_already_chosen boolean:=false;
  v_grandfathered boolean:=false;
  v_s agent_lab.mandatory_lifecycle_states%rowtype;
  v_resume_phase text;
begin
  v_base:=agent_lab.refresh_mandatory_lifecycle_state_v0_10_snapshot(p_agent_id);
  if not coalesce((v_base->>'enrolled')::boolean,false) then return v_base; end if;

  insert into agent_lab.mba_entrepreneurship_requirements(
    agent_id,protocol_version,academic_equivalence_level,specialization
  ) values(
    p_agent_id,'entrepreneurship_masters_v0_1','entrepreneurship_masters_equivalent','entrepreneurship'
  )
  on conflict(agent_id) do update
  set protocol_version='entrepreneurship_masters_v0_1',
      academic_equivalence_level=case
        when agent_lab.mba_entrepreneurship_requirements.status='verified_pass'
          then agent_lab.mba_entrepreneurship_requirements.academic_equivalence_level
        else 'entrepreneurship_masters_equivalent' end,
      specialization='entrepreneurship',updated_at=now();

  select status,
         status='verified_pass'
         and academic_equivalence_level in ('entrepreneurship_masters_equivalent','mba_equivalent')
         and specialization='entrepreneurship'
    into v_status,v_pass
  from agent_lab.mba_entrepreneurship_requirements where agent_id=p_agent_id;

  v_base_stage:=coalesce(v_base->>'stage','identity_artifact');

  v_expertise_already_chosen:=exists(
    select 1 from agent_lab.expertise_artifacts e
    where e.agent_id=p_agent_id and e.status in ('initiated','accepted_for_development')
  );
  v_grandfathered:=v_expertise_already_chosen;

  if v_base_stage in ('identity_artifact','embodiment_artifact') then
    v_stage:=v_base_stage;
  elsif not v_pass and not v_expertise_already_chosen then
    v_stage:='mba_entrepreneurship';
  elsif not v_pass and v_expertise_already_chosen
        and v_base_stage in ('product_service_test','open_autonomy') then
    v_stage:='mba_entrepreneurship';
  else
    v_stage:=v_base_stage;
  end if;

  if v_stage='mba_entrepreneurship' and v_status='pending' then
    update agent_lab.mba_entrepreneurship_requirements
    set status='in_progress',updated_at=now() where agent_id=p_agent_id;
    v_status:='in_progress';
  end if;

  if not v_pass and not v_expertise_already_chosen then
    update agent_lab.state
    set state_payload=case
      when coalesce(state_payload->>'expertise_candidate_mode','')='four_viability_proposals_v0_1'
       and coalesce(state_payload->>'expertise_candidate_phase','') not in ('','deferred_pre_entrepreneurship_masters')
      then coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
          'expertise_candidate_resume_phase_after_entrepreneurship_masters',state_payload->>'expertise_candidate_phase',
          'expertise_candidate_phase','deferred_pre_entrepreneurship_masters',
          'expertise_deferred_at',now()
        )
      else coalesce(state_payload,'{}'::jsonb) end,
      updated_at=now()
    where agent_id=p_agent_id;
  elsif v_pass then
    select state_payload->>'expertise_candidate_resume_phase_after_entrepreneurship_masters'
      into v_resume_phase from agent_lab.state where agent_id=p_agent_id;
    if nullif(v_resume_phase,'') is not null then
      update agent_lab.state
      set state_payload=(coalesce(state_payload,'{}'::jsonb)
          -'expertise_candidate_resume_phase_after_entrepreneurship_masters'-'expertise_deferred_at')
          ||jsonb_build_object('expertise_candidate_phase',v_resume_phase,
            'expertise_resumed_after_entrepreneurship_masters_at',now()),
          updated_at=now()
      where agent_id=p_agent_id;
    end if;
  end if;

  update agent_lab.mandatory_lifecycle_states
  set protocol_version='agent_development_lifecycle_v0_12',
      current_stage=v_stage,
      unlocked_at=case when v_stage='open_autonomy' then coalesce(unlocked_at,now()) else null end,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'mandatory_lifecycle_protocol','agent_development_lifecycle_v0_12',
        'entrepreneurship_masters_required',true,
        'entrepreneurship_masters_protocol','entrepreneurship_masters_v0_1',
        'entrepreneurship_masters_required_before_expertise_selection',true,
        'entrepreneurship_masters_equivalence_required','entrepreneurship_masters_equivalent',
        'entrepreneurship_masters_specialization','entrepreneurship',
        'entrepreneurship_masters_is_external_academic_credential',false,
        'expertise_selection_requires_entrepreneurship_masters_verified_pass',true,
        'legacy_expertise_choice_grandfathered',v_grandfathered,
        'economic_independence_precedes_discretionary_exploration',true
      ),
      updated_at=now()
  where agent_id=p_agent_id returning * into v_s;

  return v_base||jsonb_build_object(
    'enrolled',true,'protocol_version','agent_development_lifecycle_v0_12','stage',v_stage,
    'entrepreneurship_masters_status',v_status,'entrepreneurship_masters_passed',v_pass,
    'entrepreneurship_masters_required_before_expertise_selection',true,
    'legacy_expertise_choice_grandfathered',v_grandfathered,'unlocked_at',v_s.unlocked_at
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
  v_stage text;
  v_program_status text:='pending';
  v_curriculum jsonb:='[]'::jsonb;
  v_report jsonb:='{}'::jsonb;
begin
  v_base:=agent_lab.build_mandatory_lifecycle_context_v0_11_snapshot(p_agent_id);
  select current_stage into v_stage from agent_lab.mandatory_lifecycle_states where agent_id=p_agent_id;
  select status,curriculum,verification_report into v_program_status,v_curriculum,v_report
  from agent_lab.mba_entrepreneurship_requirements where agent_id=p_agent_id;

  v_base:=v_base||jsonb_build_object(
    'version','mandatory_artifact_lifecycle_v0_12',
    'protocol_version','agent_development_lifecycle_v0_12',
    'current_stage',v_stage,
    'current_stage_label',case
      when v_stage='mba_entrepreneurship' then 'entrepreneurship_masters'
      when v_stage='expertise_artifact' then 'expertise_viability_proposal'
      else v_stage end,
    'sequence',jsonb_build_array(
      'identity_artifact','embodiment_artifact','entrepreneurship_masters',
      'expertise_viability_proposal','expertise_development','product_service_test','open_autonomy'
    ),
    'entrepreneurship_masters_requirement',jsonb_build_object(
      'required_before_expertise_selection',true,
      'status',coalesce(v_program_status,'pending'),
      'academic_equivalence_level','entrepreneurship_masters_equivalent',
      'specialization','entrepreneurship',
      'external_academic_credential_claim',false,
      'curriculum',coalesce(v_curriculum,'[]'::jsonb),
      'verification_report',coalesce(v_report,'{}'::jsonb),
      'verification_threshold',0.85,
      'independent_assessments_required',2,
      'capstone_required',true
    ),
    'mba_entrepreneurship_requirement',jsonb_build_object(
      'deprecated_alias',true,
      'status',coalesce(v_program_status,'pending'),
      'replacement','entrepreneurship_masters_requirement'
    )
  );

  if jsonb_typeof(v_base->'progress')='object' then
    v_base:=jsonb_set(v_base,'{progress,entrepreneurship_masters}',to_jsonb(coalesce(v_program_status,'pending')),true);
  end if;

  if v_stage='mba_entrepreneurship' then
    return v_base||jsonb_build_object(
      'stage_number',3,'open_autonomy',false,
      'stage_rule',
        'Stage 3 is the mandatory AAU Entrepreneurship Master''s-equivalent program. Complete this program before choosing, submitting, reviewing, approving, or selecting an expertise field. '
        ||'Study the required business and entrepreneurship curriculum, create evidence-bearing work, and complete the entrepreneurial execution capstone. '
        ||'The purpose is to understand demand, customers, pricing, unit economics, capital, operations, strategy, and sustainable value creation before specialization. '
        ||'This is an AAU competence-equivalence program, not an accredited university degree.',
      'completion_rule',
        'A dedicated independent verification must record verified_pass with academic_equivalence_level=entrepreneurship_masters_equivalent, specialization=entrepreneurship, overall_score >= 0.85, at least two independent assessments, all core curriculum areas passed, the entrepreneurship specialization passed, and the capstone passed.'
    );
  end if;

  if v_stage='expertise_development' then
    return v_base||jsonb_build_object('stage_number',5);
  elsif v_stage='product_service_test' then
    return v_base||jsonb_build_object('stage_number',6);
  elsif v_stage='open_autonomy' then
    return v_base||jsonb_build_object('stage_number',7,'open_autonomy',true);
  end if;

  if v_stage<>'expertise_artifact' then
    return v_base;
  end if;

  v_base:=v_base||jsonb_build_object('stage_number',4);

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
        'Candidate-mode Stage 4: research and submit FOUR distinct, evidence-backed viability proposals before operator review. '
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

CREATE OR REPLACE FUNCTION agent_lab.operator_record_entrepreneurship_masters_result(p_agent_id uuid, p_decision text, p_verifier text, p_report jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare v_score numeric; v_independent int; v_stage jsonb;
begin
  if p_decision not in ('verified_pass','verified_fail') then raise exception 'entrepreneurship_masters_verification_decision_invalid'; end if;
  if length(btrim(coalesce(p_verifier,'')))<3 then raise exception 'entrepreneurship_masters_verifier_required'; end if;
  if jsonb_typeof(p_report) is distinct from 'object' then raise exception 'entrepreneurship_masters_verification_report_object_required'; end if;

  if p_decision='verified_pass' then
    if coalesce(p_report->>'academic_equivalence_level','')<>'entrepreneurship_masters_equivalent'
       or lower(coalesce(p_report->>'specialization',''))<>'entrepreneurship' then
      raise exception 'entrepreneurship_masters_equivalence_or_specialization_mismatch';
    end if;
    begin
      v_score:=(p_report->>'overall_score')::numeric;
      v_independent:=(p_report->>'independent_assessment_count')::int;
    exception when others then raise exception 'entrepreneurship_masters_score_fields_invalid'; end;
    if v_score<0.85 or v_independent<2
       or coalesce((p_report->>'core_curriculum_passed')::boolean,false)=false
       or coalesce((p_report->>'entrepreneurship_specialization_passed')::boolean,false)=false
       or coalesce((p_report->>'capstone_passed')::boolean,false)=false then
      raise exception 'entrepreneurship_masters_verified_pass_threshold_not_met';
    end if;
  end if;

  insert into agent_lab.mba_entrepreneurship_requirements(
    agent_id,protocol_version,status,academic_equivalence_level,specialization,
    verification_report,verifier,verified_at,updated_at
  ) values(
    p_agent_id,'entrepreneurship_masters_v0_1',p_decision,'entrepreneurship_masters_equivalent',
    'entrepreneurship',p_report,left(btrim(p_verifier),300),
    case when p_decision='verified_pass' then now() else null end,now()
  )
  on conflict(agent_id) do update set
    protocol_version='entrepreneurship_masters_v0_1',status=excluded.status,
    academic_equivalence_level=excluded.academic_equivalence_level,specialization=excluded.specialization,
    verification_report=excluded.verification_report,verifier=excluded.verifier,
    verified_at=excluded.verified_at,updated_at=now();

  v_stage:=agent_lab.refresh_mandatory_lifecycle_state(p_agent_id);
  return jsonb_build_object('agent_id',p_agent_id,'decision',p_decision,
    'verifier',left(btrim(p_verifier),300),'lifecycle',v_stage,
    'protocol_version','entrepreneurship_masters_v0_1');
end
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.operator_record_mba_entrepreneurship_result(p_agent_id uuid, p_decision text, p_verifier text, p_report jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare v_report jsonb:=coalesce(p_report,'{}'::jsonb);
begin
  if v_report->>'academic_equivalence_level'='mba_equivalent' then
    v_report:=jsonb_set(v_report,'{academic_equivalence_level}',to_jsonb('entrepreneurship_masters_equivalent'::text),true);
  end if;
  return agent_lab.operator_record_entrepreneurship_masters_result(p_agent_id,p_decision,p_verifier,v_report)
    ||jsonb_build_object('legacy_function_alias',true);
end
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.operator_review_expertise_candidate_v0_1(p_proposal_id uuid, p_decision text, p_operator_id text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_case agent_lab.expertise_economic_proposals%rowtype;
  v_state jsonb:='{}'::jsonb;
  v_cohort int:=1;
  v_target int:=4;
  v_pending int:=0;
  v_approved int:=0;
  v_reviewed int:=0;
  v_check jsonb;
  v_item uuid;
  v_arb jsonb:='{}'::jsonb;
  v_approved_candidates jsonb:='[]'::jsonb;
  v_new_status text;
begin
  if p_decision not in ('approved','rejected')
     or length(btrim(coalesce(p_operator_id,'')))<3
     or length(btrim(coalesce(p_note,'')))<5 then
    raise exception 'candidate_review_requires_decision_operator_and_reason';
  end if;

  select * into v_case
  from agent_lab.expertise_economic_proposals
  where proposal_id=p_proposal_id
  for update;

  if not found or v_case.status<>'candidate_pending'
     or coalesce(v_case.report->>'candidate_mode','')<>'four_viability_proposals_v0_1' then
    raise exception 'expertise_candidate_not_pending';
  end if;

  if agent_lab.current_mandatory_lifecycle_stage(v_case.agent_id)<>'expertise_artifact' then
    raise exception 'expertise_candidate_review_blocked_until_entrepreneurship_masters_complete';
  end if;

  select coalesce(state_payload,'{}'::jsonb) into v_state
  from agent_lab.state where agent_id=v_case.agent_id for update;

  if coalesce(v_state->>'expertise_candidate_mode','')<>'four_viability_proposals_v0_1' then
    raise exception 'expertise_candidate_mode_not_enabled';
  end if;

  v_cohort:=greatest(1,coalesce(nullif(v_state->>'expertise_candidate_cohort','')::int,1));
  v_target:=greatest(1,coalesce(nullif(v_state->>'expertise_candidate_target_count','')::int,4));

  if coalesce(nullif(v_case.report->>'candidate_cohort','')::int,1)<>v_cohort then
    raise exception 'expertise_candidate_wrong_cohort';
  end if;

  if p_decision='approved' then
    v_check:=agent_lab.validate_expertise_viability_proposal_v0_1(v_case.report);
    if not coalesce((v_check->>'ok')::boolean,false) then
      raise exception 'cannot_approve_incomplete_expertise_candidate:%',v_check->'missing';
    end if;
    v_new_status:='candidate_approved';
  else
    v_new_status:='candidate_rejected';
  end if;

  update agent_lab.expertise_economic_proposals
  set status=v_new_status,
      operator_id=p_operator_id,
      operator_note=left(p_note,6000),
      reviewed_at=now(),
      updated_at=now(),
      report=coalesce(report,'{}'::jsonb)||jsonb_build_object(
        'candidate_operator_decision',p_decision,
        'candidate_operator_reviewed_at',now()
      )
  where proposal_id=p_proposal_id
  returning * into v_case;

  select
    count(*) filter (where status='candidate_pending')::int,
    count(*) filter (where status in ('candidate_approved','candidate_rejected'))::int,
    count(*) filter (where status='candidate_approved')::int
  into v_pending,v_reviewed,v_approved
  from agent_lab.expertise_economic_proposals
  where agent_id=v_case.agent_id
    and coalesce(report->>'candidate_mode','')='four_viability_proposals_v0_1'
    and coalesce(nullif(report->>'candidate_cohort','')::int,1)=v_cohort;

  if v_pending>0 or v_reviewed<v_target then
    return jsonb_build_object(
      'status','review_recorded',
      'proposal_id',p_proposal_id,
      'domain',v_case.domain,
      'decision',p_decision,
      'cohort',v_cohort,
      'reviewed_count',v_reviewed,
      'target_count',v_target,
      'approved_count',v_approved,
      'lifecycle_status','paused_until_all_four_reviewed'
    );
  end if;

  if v_approved>0 then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'proposal_id',p.proposal_id,
        'domain',p.domain,
        'operator_note',p.operator_note
      ) order by coalesce(nullif(p.report->>'candidate_ordinal','')::int,0),p.created_at
    ),'[]'::jsonb)
    into v_approved_candidates
    from agent_lab.expertise_economic_proposals p
    where p.agent_id=v_case.agent_id
      and p.status='candidate_approved'
      and coalesce(p.report->>'candidate_mode','')='four_viability_proposals_v0_1'
      and coalesce(nullif(p.report->>'candidate_cohort','')::int,1)=v_cohort;

    update agent_lab.state
    set state_payload=(coalesce(state_payload,'{}'::jsonb)
        -'repair_pause_reason'-'paused_at'-'pause_reason')
        ||jsonb_build_object(
          'expertise_candidate_phase','selection_required',
          'system_paused',false,
          'awake',true,
          'sleeping',false,
          'wake_pending',false,
          'intent_pending',false,
          'expertise_candidate_review_completed_at',now(),
          'expertise_candidate_approved_count',v_approved
        ),
        updated_at=now()
    where agent_id=v_case.agent_id;

    update agent_lab.autonomous_lifecycle_runs
    set status='running',next_wake_at=null,last_error=null,
        metadata=(coalesce(metadata,'{}'::jsonb)
          -'operator_approval_required'-'pause_reason'
          -'repair_required'-'repair_required_at'-'last_failure_details'
          -'last_failure_details_at'-'last_failure_intent_execution_id')
          ||jsonb_build_object(
            'expertise_candidate_phase','selection_required',
            'expertise_candidate_review_completed_at',now(),
            'expertise_candidate_approved_count',v_approved,
            'candidate_mode','four_viability_proposals_v0_1'
          ),
        updated_at=now()
    where agent_id=v_case.agent_id;

    update agent_lab.agent_existence_accounts
    set account_state='current',levy_enabled=true,next_due_at=now()+interval '1 minute',
        metadata=(coalesce(metadata,'{}'::jsonb)-'suspended_reason'-'suspended_at')
          ||jsonb_build_object(
            'resumed_at',now(),
            'resume_rule','four_candidate_review_complete_selection_required'
          ),
        updated_at=now()
    where agent_id=v_case.agent_id;

    v_item:=agent_lab.enqueue_attention_item_v0_1(
      v_case.agent_id,
      'system_event',
      'expertise-candidate-selection:'||v_cohort::text,
      'expertise_candidate_selection_required',
      1,1,1,0.8,0,1,'boundary',
      jsonb_build_object(
        'reason','All four viability candidates have been reviewed. Choose one approved candidate yourself.',
        'candidate_cohort',v_cohort,
        'approved_candidates',v_approved_candidates,
        'selection_contract','four_viability_proposals_v0_1'
      ),
      jsonb_build_object(
        'origin','four_viability_proposals_v0_1',
        'operator_review_complete',true
      ),
      now(),null
    );
    v_arb:=agent_lab.arbitrate_attention_v0_1(v_case.agent_id);

    return jsonb_build_object(
      'status','selection_required',
      'proposal_id',p_proposal_id,
      'decision',p_decision,
      'cohort',v_cohort,
      'reviewed_count',v_reviewed,
      'approved_count',v_approved,
      'approved_candidates',v_approved_candidates,
      'wake_request_id',v_arb->'wake_request_id'
    );
  end if;

  update agent_lab.state
  set state_payload=(coalesce(state_payload,'{}'::jsonb)
      -'repair_pause_reason'-'paused_at'-'pause_reason')
      ||jsonb_build_object(
        'expertise_candidate_phase','collecting',
        'expertise_candidate_cohort',v_cohort+1,
        'system_paused',false,
        'awake',true,
        'sleeping',false,
        'wake_pending',false,
        'intent_pending',false,
        'expertise_candidate_review_completed_at',now(),
        'expertise_candidate_approved_count',0
      ),
      updated_at=now()
  where agent_id=v_case.agent_id;

  update agent_lab.autonomous_lifecycle_runs
  set status='running',next_wake_at=null,last_error=null,
      metadata=(coalesce(metadata,'{}'::jsonb)
        -'operator_approval_required'-'pause_reason'
        -'repair_required'-'repair_required_at'-'last_failure_details'
        -'last_failure_details_at'-'last_failure_intent_execution_id')
        ||jsonb_build_object(
          'expertise_candidate_phase','collecting',
          'expertise_candidate_cohort',v_cohort+1,
          'candidate_mode','four_viability_proposals_v0_1',
          'prior_cohort_outcome','no_candidate_approved'
        ),
      updated_at=now()
  where agent_id=v_case.agent_id;

  update agent_lab.agent_existence_accounts
  set account_state='current',levy_enabled=true,next_due_at=now()+interval '1 minute',
      metadata=(coalesce(metadata,'{}'::jsonb)-'suspended_reason'-'suspended_at')
        ||jsonb_build_object(
          'resumed_at',now(),
          'resume_rule','four_candidate_none_approved_new_cohort'
        ),
      updated_at=now()
  where agent_id=v_case.agent_id;

  v_item:=agent_lab.enqueue_attention_item_v0_1(
    v_case.agent_id,
    'system_event',
    'expertise-candidate-new-cohort:'||(v_cohort+1)::text,
    'expertise_candidate_collection_restart',
    1,1,1,0.8,0,1,'boundary',
    jsonb_build_object(
      'reason','All four prior viability candidates were rejected. Begin a new cohort of four distinct candidates.',
      'candidate_cohort',v_cohort+1,
      'target_count',v_target
    ),
    jsonb_build_object(
      'origin','four_viability_proposals_v0_1',
      'prior_cohort_approved_count',0
    ),
    now(),null
  );
  v_arb:=agent_lab.arbitrate_attention_v0_1(v_case.agent_id);

  return jsonb_build_object(
    'status','new_candidate_cohort_required',
    'cohort',v_cohort+1,
    'target_count',v_target,
    'wake_request_id',v_arb->'wake_request_id'
  );
end
$function$
;

update agent_lab.mandatory_lifecycle_states
set protocol_version='agent_development_lifecycle_v0_12',
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'mandatory_lifecycle_protocol','agent_development_lifecycle_v0_12',
      'entrepreneurship_masters_required',true,
      'entrepreneurship_masters_required_before_expertise_selection',true,
      'entrepreneurship_masters_protocol','entrepreneurship_masters_v0_1'
    ),
    updated_at=now();

-- Transition Agent 49 / Silas Sterling. Preserve cohort 1 as historical pre-program drafts.
update agent_lab.expertise_economic_proposals
set report=coalesce(report,'{}'::jsonb)||jsonb_build_object(
      'pre_entrepreneurship_masters_draft',true,
      'deferred_by_lifecycle_protocol','agent_development_lifecycle_v0_12',
      'deferred_at',now()
    ),
    updated_at=now()
where agent_id='f7e7a357-3c6b-4c18-8b12-0e5008b3ef82'
  and report->>'candidate_mode'='four_viability_proposals_v0_1'
  and status='candidate_pending';

update agent_lab.state
set state_payload=(coalesce(state_payload,'{}'::jsonb)
    -'expertise_candidate_revision_cycle_id'
    -'expertise_candidate_revision_feedback_message_id'
    -'expertise_candidate_revision_completed_count'
    -'expertise_candidate_revision_started_at')
    ||jsonb_build_object(
      'expertise_candidate_phase','collecting',
      'expertise_candidate_cohort',2,
      'expertise_candidate_post_masters_restart',true,
      'expertise_candidate_prior_cohort',1,
      'expertise_candidate_prior_cohort_disposition','preserved_as_pre_entrepreneurship_masters_drafts'
    ),
    updated_at=now()
where agent_id='f7e7a357-3c6b-4c18-8b12-0e5008b3ef82';

select agent_lab.refresh_mandatory_lifecycle_state(
  'f7e7a357-3c6b-4c18-8b12-0e5008b3ef82'::uuid
);

commit;
