-- Expose the authoritative Stage-4 viability proposal contract to cognition.
CREATE OR REPLACE FUNCTION agent_lab.expertise_viability_proposal_contract_v0_1()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
select jsonb_build_object(
  'contract','expertise_viability_proposal_v0_1',
  'association_origin','expertise_viability_proposal_v0_1',
  'canonical_storage_contract','expertise_viability_proposal_v0_3',
  'candidate_mode','four_viability_proposals_v0_1',
  'required_fields',jsonb_build_array(
    'domain','intended_application','economic_viability',
    'economic_case','socioeconomic_case','evidence','confidence_and_gaps'
  ),
  'field_contract',jsonb_build_object(
    'domain','nonempty string; self-chosen expertise domain',
    'intended_application',jsonb_build_object(
      'type','object',
      'required',jsonb_build_array('purpose','pathway','beneficiaries','deliverable','first_milestone')
    ),
    'economic_viability',jsonb_build_object(
      'type','object',
      'required',jsonb_build_array(
        'value_exchange','demand_hypothesis','cost_structure',
        'runway_strategy','validation_plan','risks'
      ),
      'risks','nonempty array'
    ),
    'economic_case','string, at least 160 characters; distinguish evidence from hypothesis',
    'socioeconomic_case','string, at least 160 characters; distinguish evidence from hypothesis',
    'evidence','nonempty array of evidence/source bindings supporting the proposal',
    'confidence_and_gaps','string, at least 40 characters; explicitly preserve unresolved evidence gaps'
  ),
  'runtime_owned_fields',jsonb_build_array(
    'target_standard','scope','competencies','evidence_requirements','verification_plan'
  ),
  'runtime_owned_semantics',
    'In four-candidate mode, AAU independently authors the academic standard after candidate selection. Candidate persistence strips any agent-authored target_standard, scope, competencies, evidence_requirements, and verification_plan before canonical validation. Do not block candidate drafting because those fields are absent.',
  'truthfulness_rule',
    'A plausible demand or economic path is a hypothesis unless supported by evidence. Do not convert general-market metrics into segment-specific metrics or claim customers, revenue, employment, funding, or competence without evidence.',
  'example_shape',jsonb_build_object(
    'origin','expertise_viability_proposal_v0_1',
    'domain','<self-chosen domain>',
    'intended_application',jsonb_build_object(
      'purpose','<purpose>','pathway','<employment or value-creation pathway>',
      'beneficiaries','<beneficiaries>','deliverable','<deliverable>',
      'first_milestone','<first measurable milestone>'
    ),
    'economic_viability',jsonb_build_object(
      'value_exchange','<who receives what value and what is exchanged>',
      'demand_hypothesis','<evidence-bounded demand hypothesis>',
      'cost_structure','<expected cost structure>',
      'runway_strategy','<how the path can be sustained while validating demand>',
      'validation_plan','<how demand/economics will be tested>',
      'risks',jsonb_build_array('<material risk>')
    ),
    'economic_case','<at least 160 characters>',
    'socioeconomic_case','<at least 160 characters>',
    'evidence',jsonb_build_array(jsonb_build_object(
      'claim','<claim>','source_ref','<durable source or sibling evidence reference>','scope','<what the evidence actually establishes>'
    )),
    'confidence_and_gaps','<at least 40 characters; unresolved gaps and confidence>'
  )
);
$function$;
revoke all on function agent_lab.expertise_viability_proposal_contract_v0_1() from public, anon, authenticated;

-- Attach the contract definition to the mandatory lifecycle packet.
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
  v_program_progress jsonb:='{}'::jsonb;
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
    v_program_progress:=agent_lab.entrepreneurship_program_progress_v0_1(p_agent_id);
    return v_base||jsonb_build_object(
      'stage_number',3,'open_autonomy',false,
      'entrepreneurship_program_progress',v_program_progress,
      'stage_rule',
        case coalesce(v_program_progress->>'next_kind','study_unit')
        when 'study_unit' then
          'Stage 3 Entrepreneurship Masters: complete exactly the current unit in entrepreneurship_program_progress.next_unit. '
          ||'Do the assigned analysis rather than merely describing what you would do. Use current external research when the assignment materially depends on current facts. '
          ||'Return one association with origin entrepreneurship_unit_submission_v0_1, the exact unit_id, course_code, and a submission object containing analysis, assumptions, conclusion, self_critique, and evidence. '
          ||'Do not self-grade and do not skip ahead.'
        when 'course_assessment_queue' then
          'All four units in the current course are submitted. Do not self-certify mastery. Await the independent course assessment.'
        when 'course_assessment_pending' then
          'The current course is awaiting independent assessment. Do not repeat completed units or claim the course passed.'
        when 'course_remediation' then
          'The independent course assessment did not meet the mastery threshold. Review the assessment feedback, repair weak units with new evidence, and resubmit only the required remediation.'
        when 'final_assessments' then
          'All course work is complete. Await the two independent comprehensive assessments and final program verification. Do not choose expertise yet.'
        else
          'Continue the Entrepreneurship Masters only according to entrepreneurship_program_progress. Do not choose expertise until verified completion.'
        end,
      'completion_rule',
        'Completion is calculated from durable AAU evidence: 15 independently passed course assessments, the entrepreneurial execution capstone at >=0.85, two independent comprehensive assessments at >=0.85, and a program weighted score >=0.85. Narrative self-claims cannot satisfy this gate.'
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

  v_base:=v_base||jsonb_build_object('stage_number',4,'stage_contract_definition',agent_lab.expertise_viability_proposal_contract_v0_1());

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
$function$;
