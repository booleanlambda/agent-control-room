-- AAU Agent Development Lifecycle v0.13
-- Cumulative Competency Inheritance
-- Later stages must actively demonstrate relevant verified learning from earlier stages.

begin;

do $snapshot$
declare v_def text;
begin
  if to_regprocedure('agent_lab.build_mandatory_lifecycle_context_v0_12_snapshot(uuid)') is null then
    v_def:=pg_get_functiondef('agent_lab.build_mandatory_lifecycle_context(uuid)'::regprocedure);
    v_def:=replace(v_def,'FUNCTION agent_lab.build_mandatory_lifecycle_context(','FUNCTION agent_lab.build_mandatory_lifecycle_context_v0_12_snapshot('); execute v_def;
  end if;
  if to_regprocedure('agent_lab.refresh_mandatory_lifecycle_state_v0_12_snapshot(uuid)') is null then
    v_def:=pg_get_functiondef('agent_lab.refresh_mandatory_lifecycle_state(uuid)'::regprocedure);
    v_def:=replace(v_def,'FUNCTION agent_lab.refresh_mandatory_lifecycle_state(','FUNCTION agent_lab.refresh_mandatory_lifecycle_state_v0_12_snapshot('); execute v_def;
  end if;
  if to_regprocedure('agent_lab.expertise_viability_proposal_contract_pre_v0_13_snapshot()') is null then
    v_def:=pg_get_functiondef('agent_lab.expertise_viability_proposal_contract_v0_1()'::regprocedure);
    v_def:=replace(v_def,'FUNCTION agent_lab.expertise_viability_proposal_contract_v0_1(','FUNCTION agent_lab.expertise_viability_proposal_contract_pre_v0_13_snapshot('); execute v_def;
  end if;
  if to_regprocedure('agent_lab.validate_expertise_viability_proposal_pre_v0_13_snapshot(jsonb)') is null then
    v_def:=pg_get_functiondef('agent_lab.validate_expertise_viability_proposal_v0_1(jsonb)'::regprocedure);
    v_def:=replace(v_def,'FUNCTION agent_lab.validate_expertise_viability_proposal_v0_1(','FUNCTION agent_lab.validate_expertise_viability_proposal_pre_v0_13_snapshot('); execute v_def;
  end if;
  if to_regprocedure('agent_lab.evaluate_expertise_portfolio_gate_pre_v0_13_snapshot(uuid,uuid)') is null then
    v_def:=pg_get_functiondef('agent_lab.evaluate_expertise_portfolio_gate_v0_2(uuid,uuid)'::regprocedure);
    v_def:=replace(v_def,'FUNCTION agent_lab.evaluate_expertise_portfolio_gate_v0_2(','FUNCTION agent_lab.evaluate_expertise_portfolio_gate_pre_v0_13_snapshot('); execute v_def;
  end if;
  if to_regprocedure('agent_lab.build_expertise_portfolio_context_pre_v0_13_snapshot(uuid)') is null then
    v_def:=pg_get_functiondef('agent_lab.build_expertise_portfolio_context_v0_2(uuid)'::regprocedure);
    v_def:=replace(v_def,'FUNCTION agent_lab.build_expertise_portfolio_context_v0_2(','FUNCTION agent_lab.build_expertise_portfolio_context_pre_v0_13_snapshot('); execute v_def;
  end if;
  if to_regprocedure('agent_lab.apply_product_service_test_submission_pre_v0_13_snapshot(uuid,jsonb)') is null then
    v_def:=pg_get_functiondef('agent_lab.apply_product_service_test_submission_v0_1(uuid,jsonb)'::regprocedure);
    v_def:=replace(v_def,'FUNCTION agent_lab.apply_product_service_test_submission_v0_1(','FUNCTION agent_lab.apply_product_service_test_submission_pre_v0_13_snapshot('); execute v_def;
  end if;
  if to_regprocedure('agent_lab.evaluate_product_service_test_pre_v0_13_snapshot(uuid)') is null then
    v_def:=pg_get_functiondef('agent_lab.evaluate_product_service_test_v0_1(uuid)'::regprocedure);
    v_def:=replace(v_def,'FUNCTION agent_lab.evaluate_product_service_test_v0_1(','FUNCTION agent_lab.evaluate_product_service_test_pre_v0_13_snapshot('); execute v_def;
  end if;
  if to_regprocedure('agent_lab.build_product_service_test_context_pre_v0_13_snapshot(uuid)') is null then
    v_def:=pg_get_functiondef('agent_lab.build_product_service_test_context_v0_1(uuid)'::regprocedure);
    v_def:=replace(v_def,'FUNCTION agent_lab.build_product_service_test_context_v0_1(','FUNCTION agent_lab.build_product_service_test_context_pre_v0_13_snapshot('); execute v_def;
  end if;
end
$snapshot$;

CREATE OR REPLACE FUNCTION agent_lab.validate_prior_learning_application_v0_1(p_application jsonb, p_required_source_stages jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_missing jsonb:='[]'::jsonb;
  v_sources jsonb:='[]'::jsonb;
  v_comp jsonb:='[]'::jsonb;
  v_map jsonb:='[]'::jsonb;
  v_refs jsonb:='[]'::jsonb;
  v_req text;
begin
  if jsonb_typeof(p_application) is distinct from 'object' then
    return jsonb_build_object(
      'ok',false,
      'missing',jsonb_build_array('prior_learning_application:object'),
      'contract_version','cumulative_competency_inheritance_v0_1'
    );
  end if;

  v_sources:=case when jsonb_typeof(p_application->'source_stages')='array'
    then p_application->'source_stages' else '[]'::jsonb end;
  v_comp:=case when jsonb_typeof(p_application->'competencies_applied')='array'
    then p_application->'competencies_applied' else '[]'::jsonb end;
  v_map:=case when jsonb_typeof(p_application->'application_map')='array'
    then p_application->'application_map' else '[]'::jsonb end;
  v_refs:=case when jsonb_typeof(p_application->'evidence_refs')='array'
    then p_application->'evidence_refs' else '[]'::jsonb end;

  if jsonb_array_length(v_sources)=0 then
    v_missing:=v_missing||jsonb_build_array('prior_learning_application.source_stages:nonempty_array');
  end if;
  if jsonb_array_length(v_comp)<3 then
    v_missing:=v_missing||jsonb_build_array('prior_learning_application.competencies_applied:min_3');
  end if;
  if jsonb_array_length(v_map)<3 then
    v_missing:=v_missing||jsonb_build_array('prior_learning_application.application_map:min_3');
  end if;
  if jsonb_array_length(v_refs)=0 then
    v_missing:=v_missing||jsonb_build_array('prior_learning_application.evidence_refs:nonempty_array');
  end if;
  if length(btrim(coalesce(p_application->>'decision_impact','')))<80 then
    v_missing:=v_missing||jsonb_build_array('prior_learning_application.decision_impact:min_80_chars');
  end if;

  for v_req in
    select value #>> '{}'
    from jsonb_array_elements(
      case when jsonb_typeof(p_required_source_stages)='array'
        then p_required_source_stages else '[]'::jsonb end
    )
  loop
    if not exists(
      select 1 from jsonb_array_elements_text(v_sources) s(value)
      where lower(btrim(s.value))=lower(btrim(v_req))
    ) then
      v_missing:=v_missing||jsonb_build_array('prior_learning_application.source_stage_required:'||v_req);
    end if;
  end loop;

  return jsonb_build_object(
    'ok',v_missing='[]'::jsonb,
    'missing',v_missing,
    'contract_version','cumulative_competency_inheritance_v0_1',
    'non_compensatory',true,
    'rule','Later-stage mastery cannot compensate for failure to apply relevant verified competencies from earlier stages.'
  );
end
$function$;

CREATE OR REPLACE FUNCTION agent_lab.build_cumulative_competency_inheritance_v0_1(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_stage text;
  v_program_status text:='pending';
  v_program_report jsonb:='{}'::jsonb;
  v_courses jsonb:='[]'::jsonb;
  v_capstone jsonb:='{}'::jsonb;
  v_expertise jsonb:='{}'::jsonb;
  v_product jsonb:='{}'::jsonb;
  v_required_sources jsonb:='[]'::jsonb;
  v_dimensions jsonb:='[]'::jsonb;
begin
  select current_stage into v_stage
  from agent_lab.mandatory_lifecycle_states
  where agent_id=p_agent_id;

  select status,coalesce(verification_report,'{}'::jsonb)
    into v_program_status,v_program_report
  from agent_lab.mba_entrepreneurship_requirements
  where agent_id=p_agent_id;

  if v_program_status='verified_pass' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'course_code',c.course_code,
      'title',c.title,
      'category',c.category,
      'learning_objectives',c.learning_objectives
    ) order by c.course_order),'[]'::jsonb)
    into v_courses
    from agent_lab.entrepreneurship_courses c;

    select coalesce(jsonb_build_object(
      'status',x.status,
      'capstone_id',x.capstone_id,
      'decision',x.decision,
      'verified_transfer_principles',jsonb_build_array(
        'distinguish evidence from modeled assumptions',
        'customer evidence before scaling claims',
        'unit economics and cash discipline',
        'sensitivity analysis and downside cases',
        'explicit kill criteria',
        'build/revise/kill decisions tied to evidence'
      )
    ),'{}'::jsonb)
    into v_capstone
    from agent_lab.entrepreneurship_capstones x
    where x.agent_id=p_agent_id
    order by x.created_at desc
    limit 1;
  end if;

  select coalesce(jsonb_build_object(
    'expertise_artifact_id',e.expertise_artifact_id,
    'domain',e.domain,
    'status',e.status,
    'competencies',e.competencies,
    'intended_application',e.intended_application,
    'economic_viability',e.economic_viability,
    'selected_viability_proposal_id',e.metadata->'operator_expertise_viability_proposal_id'
  ),'{}'::jsonb)
  into v_expertise
  from agent_lab.expertise_artifacts e
  where e.agent_id=p_agent_id
  order by e.created_at desc
  limit 1;

  select coalesce(jsonb_build_object(
    'product_service_test_id',t.product_service_test_id,
    'status',t.status,
    'offering_type',t.offering_type,
    'title',t.title,
    'target_user',t.target_user,
    'value_proposition',t.value_proposition,
    'verification_report',t.verification_report
  ),'{}'::jsonb)
  into v_product
  from agent_lab.product_service_tests t
  where t.agent_id=p_agent_id
  order by t.created_at desc
  limit 1;

  if v_stage='expertise_artifact' then
    v_required_sources:=jsonb_build_array('entrepreneurship_masters');
    v_dimensions:=jsonb_build_array(
      'customer_discovery_and_pain',
      'buyer_and_budget_owner',
      'demand_and_market_structure',
      'business_model_and_value_exchange',
      'pricing_and_unit_economics',
      'competition_and_positioning',
      'operations_and_delivery_cost',
      'capital_and_runway',
      'go_to_market_and_first_revenue_path',
      'data_analysis_and_sensitivity',
      'legal_ethics_and_governance',
      'validation_experiments_and_kill_criteria'
    );
  elsif v_stage='expertise_development' then
    v_required_sources:=jsonb_build_array('entrepreneurship_masters','expertise_viability_proposal');
    v_dimensions:=jsonb_build_array(
      'selected_viability_thesis_alignment',
      'customer_value_relevance',
      'economic_priority_of_skill_development',
      'risk_and_constraint_awareness',
      'falsifiable_learning_objectives',
      'portfolio_work_tied_to_real_application'
    );
  elsif v_stage='product_service_test' then
    v_required_sources:=jsonb_build_array(
      'entrepreneurship_masters','expertise_viability_proposal','expertise_development'
    );
    v_dimensions:=jsonb_build_array(
      'real_customer_problem',
      'buyer_or_user',
      'value_proposition',
      'pricing_or_economic_value',
      'delivery_cost_and_capacity',
      'unit_economics_or_employment_economics',
      'quality_reliability_and_operations',
      'go_to_market_or_adoption_path',
      'competitive_substitutes',
      'risk_and_governance',
      'validation_and_kill_criteria'
    );
  elsif v_stage='open_autonomy' then
    v_required_sources:=jsonb_build_array(
      'entrepreneurship_masters','expertise_viability_proposal',
      'expertise_development','product_service_test'
    );
    v_dimensions:=jsonb_build_array(
      'apply_relevant_verified_learning_to_major_decisions',
      'preserve_evidence_vs_hypothesis_boundaries',
      'use_economic_and_operational_feedback',
      'revise_or_abandon_when_kill_criteria_are_met'
    );
  end if;

  return jsonb_build_object(
    'contract','cumulative_competency_inheritance_v0_1',
    'lifecycle_protocol','agent_development_lifecycle_v0_13',
    'current_stage',v_stage,
    'non_compensatory',true,
    'principle',
      'Verified learning is cumulative. A later stage must actively apply relevant competencies earned in earlier stages; merely exposing prior material in context is insufficient.',
    'required_source_stages',v_required_sources,
    'mandatory_application_dimensions',v_dimensions,
    'output_contract',jsonb_build_object(
      'field','prior_learning_application',
      'required_when_prior_verified_learning_exists',true,
      'required_fields',jsonb_build_array(
        'source_stages','competencies_applied','application_map','decision_impact','evidence_refs'
      ),
      'application_map_item_rule',
        'Each item identifies a prior competency, how it affected the current decision/work, and the durable evidence or analysis supporting that application.',
      'omission_rule',
        'A prior competency may be marked not_material only with a specific relevance explanation. Stage-specific mandatory_application_dimensions cannot be omitted.'
    ),
    'grading_rule',
      'Transfer is a hard gate. A high score on new-stage skills cannot compensate for missing or superficial application of relevant earlier verified competencies.',
    'verified_prior_learning',jsonb_build_object(
      'entrepreneurship_masters',case when v_program_status='verified_pass' then jsonb_build_object(
        'status',v_program_status,
        'verification_report',v_program_report,
        'courses',v_courses,
        'capstone',v_capstone
      ) else jsonb_build_object('status',coalesce(v_program_status,'pending')) end,
      'expertise',v_expertise,
      'product_service_test',v_product
    )
  );
end
$function$;

CREATE OR REPLACE FUNCTION agent_lab.refresh_mandatory_lifecycle_state(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_base jsonb;
begin
  v_base:=agent_lab.refresh_mandatory_lifecycle_state_v0_12_snapshot(p_agent_id);

  update agent_lab.mandatory_lifecycle_states
  set protocol_version='agent_development_lifecycle_v0_13',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'mandatory_lifecycle_protocol','agent_development_lifecycle_v0_13',
        'cumulative_competency_inheritance_required',true,
        'cumulative_competency_inheritance_contract','cumulative_competency_inheritance_v0_1',
        'prior_learning_application_non_compensatory',true,
        'later_stage_must_demonstrate_prior_learning_transfer',true
      ),
      updated_at=now()
  where agent_id=p_agent_id;

  return v_base||jsonb_build_object(
    'protocol_version','agent_development_lifecycle_v0_13',
    'cumulative_competency_inheritance_required',true,
    'cumulative_competency_inheritance_contract','cumulative_competency_inheritance_v0_1',
    'prior_learning_application_non_compensatory',true
  );
end
$function$;

CREATE OR REPLACE FUNCTION agent_lab.build_mandatory_lifecycle_context(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_base jsonb;
  v_transfer jsonb;
  v_stage text;
  v_stage_rule text;
  v_completion_rule text;
begin
  v_base:=agent_lab.build_mandatory_lifecycle_context_v0_12_snapshot(p_agent_id);
  v_transfer:=agent_lab.build_cumulative_competency_inheritance_v0_1(p_agent_id);
  v_stage:=coalesce(v_base->>'current_stage','');
  v_stage_rule:=coalesce(v_base->>'stage_rule','');
  v_completion_rule:=coalesce(v_base->>'completion_rule','');

  if v_stage in ('expertise_artifact','expertise_development','product_service_test','open_autonomy') then
    v_stage_rule:=v_stage_rule
      ||case when length(v_stage_rule)>0 then ' ' else '' end
      ||'CUMULATIVE COMPETENCY INHERITANCE: apply the relevant verified competencies from every earlier completed stage using cumulative_competency_inheritance. '
      ||'The current artifact/work must include the prior_learning_application contract where specified. Merely recalling prior training is insufficient; show how it changed analysis, choices, execution, or validation. '
      ||'This is a non-compensatory gate: strong current-stage work cannot offset missing prior-learning transfer.';

    v_completion_rule:=v_completion_rule
      ||case when length(v_completion_rule)>0 then ' ' else '' end
      ||'Lifecycle v0.13 additionally requires demonstrated transfer of relevant prior verified competencies. Missing transfer evidence blocks stage completion.';
  end if;

  return v_base
    ||jsonb_build_object(
      'version','mandatory_artifact_lifecycle_v0_13',
      'protocol_version','agent_development_lifecycle_v0_13',
      'cumulative_competency_inheritance',v_transfer,
      'prior_learning_application_contract',v_transfer->'output_contract',
      'prior_learning_application_non_compensatory',true
    )
    ||case when v_stage_rule<>'' then jsonb_build_object('stage_rule',v_stage_rule) else '{}'::jsonb end
    ||case when v_completion_rule<>'' then jsonb_build_object('completion_rule',v_completion_rule) else '{}'::jsonb end;
end
$function$;

CREATE OR REPLACE FUNCTION agent_lab.expertise_viability_proposal_contract_v0_1()
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_base jsonb;
  v_required jsonb;
  v_fields jsonb;
  v_example jsonb;
begin
  v_base:=agent_lab.expertise_viability_proposal_contract_pre_v0_13_snapshot();
  v_required:=coalesce(v_base->'required_fields','[]'::jsonb)||jsonb_build_array('prior_learning_application');
  v_fields:=coalesce(v_base->'field_contract','{}'::jsonb)||jsonb_build_object(
    'prior_learning_application',jsonb_build_object(
      'contract','cumulative_competency_inheritance_v0_1',
      'required_source_stage','entrepreneurship_masters',
      'required_fields',jsonb_build_array(
        'source_stages','competencies_applied','application_map','decision_impact',
        'evidence_refs','entrepreneurship_mastery_application'
      ),
      'entrepreneurship_mastery_application_required_dimensions',jsonb_build_array(
        'financial_reasoning',
        'market_economics',
        'customer_discovery_and_sales',
        'operations',
        'strategy_and_competition',
        'law_ethics_and_governance',
        'data_and_uncertainty',
        'opportunity_identification',
        'business_model_validation',
        'capital_and_runway',
        'pricing_and_unit_economics',
        'go_to_market_and_pmf',
        'build_revise_kill_logic'
      )
    )
  );
  v_example:=coalesce(v_base->'example_shape','{}'::jsonb)||jsonb_build_object(
    'prior_learning_application',jsonb_build_object(
      'source_stages',jsonb_build_array('entrepreneurship_masters'),
      'competencies_applied',jsonb_build_array(
        'customer discovery','pricing and unit economics','strategy and competition',
        'go-to-market','data and sensitivity','build/revise/kill'
      ),
      'application_map',jsonb_build_array(jsonb_build_object(
        'competency','<verified earlier competency>',
        'application','<how it changed this candidate analysis or decision>',
        'evidence_refs',jsonb_build_array('<durable evidence refs>'),
        'decision_effect','<what conclusion, threshold, revision, or rejection followed>'
      )),
      'decision_impact','<how prior training materially changed the candidate thesis, economics, validation plan, or go/no-go judgment>',
      'evidence_refs',jsonb_build_array('<durable evidence refs used in the transfer analysis>'),
      'entrepreneurship_mastery_application',jsonb_build_object(
        'financial_reasoning','<application or explicit evidence-bounded not-material explanation>',
        'market_economics','<application>',
        'customer_discovery_and_sales','<application>',
        'operations','<application>',
        'strategy_and_competition','<application>',
        'law_ethics_and_governance','<application>',
        'data_and_uncertainty','<application>',
        'opportunity_identification','<application>',
        'business_model_validation','<application>',
        'capital_and_runway','<application>',
        'pricing_and_unit_economics','<application>',
        'go_to_market_and_pmf','<application>',
        'build_revise_kill_logic','<application>'
      )
    )
  );

  return v_base||jsonb_build_object(
    'required_fields',v_required,
    'field_contract',v_fields,
    'example_shape',v_example,
    'cumulative_competency_inheritance','cumulative_competency_inheritance_v0_1',
    'grading_rule',
      'Stage 4 is post-Entrepreneurship-Masters work. Market attractiveness alone is insufficient. The proposal must demonstrate how verified entrepreneurship competencies changed customer, buyer, pricing, unit-economics, competition, GTM, validation, risk, and kill-criteria reasoning. Missing transfer is a hard failure.',
    'truthfulness_rule',
      coalesce(v_base->>'truthfulness_rule','')
      ||' Prior-learning application must cite actual durable evidence/analysis; naming a course or vocabulary term without showing decision impact does not satisfy transfer.'
  );
end
$function$;

CREATE OR REPLACE FUNCTION agent_lab.validate_expertise_viability_proposal_v0_1(p_proposal jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_base jsonb;
  v_transfer jsonb;
  v_missing jsonb:='[]'::jsonb;
  v_mastery jsonb:='{}'::jsonb;
  v_key text;
  v_required_keys text[]:=array[
    'financial_reasoning',
    'market_economics',
    'customer_discovery_and_sales',
    'operations',
    'strategy_and_competition',
    'law_ethics_and_governance',
    'data_and_uncertainty',
    'opportunity_identification',
    'business_model_validation',
    'capital_and_runway',
    'pricing_and_unit_economics',
    'go_to_market_and_pmf',
    'build_revise_kill_logic'
  ];
begin
  v_base:=agent_lab.validate_expertise_viability_proposal_pre_v0_13_snapshot(p_proposal);
  v_transfer:=agent_lab.validate_prior_learning_application_v0_1(
    p_proposal->'prior_learning_application',
    jsonb_build_array('entrepreneurship_masters')
  );
  v_missing:=coalesce(v_base->'missing','[]'::jsonb)||coalesce(v_transfer->'missing','[]'::jsonb);

  v_mastery:=case
    when jsonb_typeof(p_proposal#>'{prior_learning_application,entrepreneurship_mastery_application}')='object'
      then p_proposal#>'{prior_learning_application,entrepreneurship_mastery_application}'
    else '{}'::jsonb
  end;

  foreach v_key in array v_required_keys loop
    if not (v_mastery ? v_key)
       or (
         jsonb_typeof(v_mastery->v_key)='string'
         and length(btrim(coalesce(v_mastery->>v_key,'')))<20
       )
       or v_mastery->v_key is null
       or v_mastery->v_key='null'::jsonb
    then
      v_missing:=v_missing||jsonb_build_array(
        'prior_learning_application.entrepreneurship_mastery_application.'||v_key
      );
    end if;
  end loop;

  if jsonb_typeof(p_proposal#>'{prior_learning_application,competencies_applied}')<>'array'
     or jsonb_array_length(
       case when jsonb_typeof(p_proposal#>'{prior_learning_application,competencies_applied}')='array'
       then p_proposal#>'{prior_learning_application,competencies_applied}' else '[]'::jsonb end
     )<6 then
    v_missing:=v_missing||jsonb_build_array('prior_learning_application.competencies_applied:min_6_for_stage4');
  end if;

  if jsonb_typeof(p_proposal#>'{prior_learning_application,application_map}')<>'array'
     or jsonb_array_length(
       case when jsonb_typeof(p_proposal#>'{prior_learning_application,application_map}')='array'
       then p_proposal#>'{prior_learning_application,application_map}' else '[]'::jsonb end
     )<6 then
    v_missing:=v_missing||jsonb_build_array('prior_learning_application.application_map:min_6_for_stage4');
  end if;

  return v_base||jsonb_build_object(
    'ok',v_missing='[]'::jsonb,
    'missing',v_missing,
    'cumulative_competency_transfer',v_transfer,
    'cumulative_competency_inheritance_required',true,
    'non_compensatory',true
  );
end
$function$;

CREATE OR REPLACE FUNCTION agent_lab.evaluate_expertise_portfolio_gate_v0_2(p_agent_id uuid, p_expertise_artifact_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_base jsonb;
  v_total_impl int:=0;
  v_transfer_impl int:=0;
  v_ready boolean:=false;
  v_selected_transfer jsonb:='{}'::jsonb;
  v_selected_ok boolean:=false;
  v_proposal_id uuid;
begin
  v_base:=agent_lab.evaluate_expertise_portfolio_gate_pre_v0_13_snapshot(
    p_agent_id,p_expertise_artifact_id
  );

  begin
    select nullif(e.metadata->>'operator_expertise_viability_proposal_id','')::uuid
      into v_proposal_id
    from agent_lab.expertise_artifacts e
    where e.agent_id=p_agent_id and e.expertise_artifact_id=p_expertise_artifact_id;
  exception when others then
    v_proposal_id:=null;
  end;

  if v_proposal_id is not null then
    select agent_lab.validate_prior_learning_application_v0_1(
      p.report->'prior_learning_application',
      jsonb_build_array('entrepreneurship_masters')
    )
    into v_selected_transfer
    from agent_lab.expertise_economic_proposals p
    where p.proposal_id=v_proposal_id;

    v_selected_ok:=coalesce((v_selected_transfer->>'ok')::boolean,false);
  end if;

  select count(*) into v_total_impl
  from agent_lab.expertise_portfolio_artifacts p
  where p.agent_id=p_agent_id
    and p.expertise_artifact_id=p_expertise_artifact_id
    and p.artifact_type='implementation'
    and p.admission_status='admitted';

  select count(*) into v_transfer_impl
  from agent_lab.expertise_portfolio_artifacts p
  where p.agent_id=p_agent_id
    and p.expertise_artifact_id=p_expertise_artifact_id
    and p.artifact_type='implementation'
    and p.admission_status='admitted'
    and coalesce((
      agent_lab.validate_prior_learning_application_v0_1(
        p.execution_spec->'prior_learning_application',
        jsonb_build_array('entrepreneurship_masters','expertise_viability_proposal')
      )->>'ok'
    )::boolean,false);

  v_ready:=coalesce((v_base->>'ready_for_verification')::boolean,false)
    and v_selected_ok
    and v_total_impl>0
    and v_transfer_impl=v_total_impl;

  return v_base||jsonb_build_object(
    'version','expertise_portfolio_gate_v0_3_cumulative_competency',
    'prior_learning_application_required',true,
    'selected_viability_transfer_gate',v_selected_transfer,
    'admitted_implementations',v_total_impl,
    'admitted_implementations_with_valid_prior_learning_application',v_transfer_impl,
    'ready_for_verification',v_ready,
    'reason',case
      when not v_selected_ok then 'selected_viability_proposal_missing_verified_entrepreneurship_transfer'
      when v_total_impl>0 and v_transfer_impl<v_total_impl then 'portfolio_prior_learning_transfer_incomplete'
      else coalesce(v_base->>'reason','not_ready')
    end
  );
end
$function$;

CREATE OR REPLACE FUNCTION agent_lab.build_expertise_portfolio_context_v0_2(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_base jsonb;
  v_submission jsonb;
  v_required jsonb;
begin
  v_base:=agent_lab.build_expertise_portfolio_context_pre_v0_13_snapshot(p_agent_id);
  if not coalesce((v_base->>'active')::boolean,false) then return v_base; end if;

  v_submission:=coalesce(v_base->'submission_contract','{}'::jsonb);
  v_required:=coalesce(v_submission->'required_fields','[]'::jsonb);

  return v_base||jsonb_build_object(
    'version','expertise_portfolio_context_v0_3_cumulative_competency',
    'submission_contract',v_submission||jsonb_build_object(
      'required_fields',v_required,
      'execution_spec_required_field','prior_learning_application',
      'prior_learning_application_required_source_stages',
        jsonb_build_array('entrepreneurship_masters','expertise_viability_proposal'),
      'prior_learning_application_contract','cumulative_competency_inheritance_v0_1',
      'rule',
        'Each implementation must show how earlier verified entrepreneurship learning and the selected viability thesis changed design, scope, tradeoffs, tests, or economic/application relevance. Mere mention of prior study does not count.'
    ),
    'completion_rule',
      coalesce(v_base->>'completion_rule','')
      ||' Cumulative competency transfer is mandatory: every admitted implementation must contain a valid execution_spec.prior_learning_application. Missing transfer blocks verification.'
  );
end
$function$;

CREATE OR REPLACE FUNCTION agent_lab.apply_product_service_test_submission_v0_1(p_agent_id uuid, p_associations jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_assoc jsonb;
  v_transfer jsonb;
begin
  select value into v_assoc
  from jsonb_array_elements(
    case when jsonb_typeof(p_associations)='array' then p_associations else '[]'::jsonb end
  )
  where value->>'origin'='product_service_test_submission_v0_1'
  limit 1;

  if v_assoc is not null then
    v_transfer:=agent_lab.validate_prior_learning_application_v0_1(
      v_assoc->'prior_learning_application',
      jsonb_build_array(
        'entrepreneurship_masters',
        'expertise_viability_proposal',
        'expertise_development'
      )
    );
    if not coalesce((v_transfer->>'ok')::boolean,false) then
      raise exception 'PRODUCT_SERVICE_TEST_PRIOR_LEARNING_APPLICATION_REQUIRED:%',
        v_transfer->'missing';
    end if;
  end if;

  return agent_lab.apply_product_service_test_submission_pre_v0_13_snapshot(
    p_agent_id,p_associations
  );
end
$function$;

CREATE OR REPLACE FUNCTION agent_lab.evaluate_product_service_test_v0_1(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_submission jsonb:='{}'::jsonb;
  v_transfer jsonb;
  v_base jsonb;
begin
  select coalesce(t.submission,'{}'::jsonb)
    into v_submission
  from agent_lab.product_service_tests t
  where t.agent_id=p_agent_id
  order by t.created_at desc
  limit 1;

  if v_submission<>'{}'::jsonb then
    v_transfer:=agent_lab.validate_prior_learning_application_v0_1(
      v_submission->'prior_learning_application',
      jsonb_build_array(
        'entrepreneurship_masters',
        'expertise_viability_proposal',
        'expertise_development'
      )
    );

    if not coalesce((v_transfer->>'ok')::boolean,false) then
      return jsonb_build_object(
        'ok',false,
        'passed',false,
        'report',jsonb_build_object(
          'version','product_service_test_verifier_v0_4_cumulative_competency',
          'passed',false,
          'prior_learning_application_gate',v_transfer,
          'rule','Product/Service Test cannot pass without demonstrated cumulative application of Entrepreneurship Masters, expertise viability reasoning, and developed expertise.'
        )
      );
    end if;
  end if;

  v_base:=agent_lab.evaluate_product_service_test_pre_v0_13_snapshot(p_agent_id);
  return v_base||jsonb_build_object(
    'prior_learning_application_gate',coalesce(v_transfer,'{}'::jsonb),
    'cumulative_competency_inheritance_required',true
  );
end
$function$;

CREATE OR REPLACE FUNCTION agent_lab.build_product_service_test_context_v0_1(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_base jsonb;
begin
  v_base:=agent_lab.build_product_service_test_context_pre_v0_13_snapshot(p_agent_id);

  return v_base||jsonb_build_object(
    'prior_learning_application_contract',jsonb_build_object(
      'contract','cumulative_competency_inheritance_v0_1',
      'required_source_stages',jsonb_build_array(
        'entrepreneurship_masters',
        'expertise_viability_proposal',
        'expertise_development'
      ),
      'required_in_submission',true,
      'rule',
        'The product/service artifact must show how prior entrepreneurship training, viability reasoning, and developed expertise materially shaped the customer problem, design, economics, operations, GTM/adoption, validation, and kill criteria.'
    )
  );
end
$function$;


update agent_lab.mandatory_lifecycle_states
set protocol_version='agent_development_lifecycle_v0_13',
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'mandatory_lifecycle_protocol','agent_development_lifecycle_v0_13',
      'cumulative_competency_inheritance_required',true,
      'cumulative_competency_inheritance_contract','cumulative_competency_inheritance_v0_1',
      'prior_learning_application_non_compensatory',true,
      'later_stage_must_demonstrate_prior_learning_transfer',true
    ),
    updated_at=now();

commit;
