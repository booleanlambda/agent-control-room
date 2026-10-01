-- AAU provider-neutral runtime finalization v0.4
-- Snapshot of the live provider-neutral lifecycle, expertise, operator-wake, and vision contracts.
-- Vendor-specific names are permitted only in explicit adapters/tests/model identifiers.

begin;

CREATE OR REPLACE FUNCTION agent_lab.create_manual_starter_agent_v0_8(p_ordinal integer, p_internal_label text, p_model_provider text, p_model_id text, p_model_family text, p_model_version text, p_model_surname text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_agent_id uuid;
  v_plan jsonb;
  v_temp jsonb;
  v_trait text;
  v_value numeric;
  v_policy_id uuid;
begin
  if p_ordinal < 1 then raise exception 'invalid_ordinal'; end if;
  if nullif(trim(p_internal_label),'') is null then raise exception 'internal_label_required'; end if;
  if nullif(trim(p_model_provider),'') is null then raise exception 'model_provider_required'; end if;
  if nullif(trim(p_model_id),'') is null then raise exception 'model_id_required'; end if;
  if nullif(trim(p_model_family),'') is null then raise exception 'model_family_required'; end if;
  if nullif(trim(p_model_version),'') is null then raise exception 'model_version_required'; end if;
  if nullif(trim(p_model_surname),'') is null then raise exception 'model_surname_required'; end if;
  if exists(select 1 from agent_lab.agents where internal_label=p_internal_label) then raise exception 'internal_label_already_exists'; end if;

  v_plan := agent_lab.build_incubator_birth_plan_v0_5(p_ordinal);
  v_temp := v_plan->'fresh_temperament';
  if v_plan is null or v_temp is null then raise exception 'birth_plan_missing'; end if;

  insert into agent_lab.agents(
    internal_label,status,is_public,model_lineage,model_surname,
    birth_model_provider,birth_model_family,birth_model_version,birth_model_id,
    primary_model_provider,primary_model_family,primary_model_version,primary_model_id,
    birth_model_timestamp,consistency_status,metadata
  ) values (
    p_internal_label,'incubating',false,p_model_id,p_model_surname,
    p_model_provider,p_model_family,p_model_version,p_model_id,
    p_model_provider,p_model_family,p_model_version,p_model_id,
    now(),'UNASSIGNED',jsonb_build_object(
      'ordinal',p_ordinal,'birth_mode','operator_authorized_manual_experimental_v07_starter_template','incubator_mode',true,
      'identity_policy','self-developing','manual_wake_mode',true,'temperament_seed',p_ordinal,
      'incubator_version','agent_incubator_v0_5','starter_template_version','agent_starter_v0_1',
      'cognition_identity_exposure_policy','hide_internal_label_and_ordinal','no_birth_interest',true,'no_birth_expertise',true,
      'temperament_origin','stochastic_seed_v0_5','wake_compute_charge',0,'cognition_compute_charge',0,
      'model_token_compute_charge',0,'economic_cost_policy','existence_time_only_v0_1','birth_compute_credits',1440,
      'minute_existence_rate',1,'birth_blueprint_version','birth_v0_6','existence_credit_policy','existence_credit_v0_2_reset_target',
      'experimental_primary_binding',p_model_provider,'experimental_primary_binding_at',now(),'birth_general_actual_competence',7.5
    )
  ) returning agent_id into v_agent_id;

  insert into agent_lab.state(agent_id,mood,energy,boredom,stress,social_appetite,curiosity,general_confidence,current_focus,state_payload)
  values(v_agent_id,jsonb_build_object('label','neutral','valence',0,'intensity',0.1),1,0.5,0.05,
    coalesce((v_temp->>'social_drive')::numeric,0.5),coalesce((v_temp->>'curiosity')::numeric,0.5),0.5,null,
    jsonb_build_object('awake',false,'sleeping',false,'inactive_between_wakes',true,'wake_pending',false,'wake_number',0,'bootstrapping',true,
      'developmental_stage','seed','system_paused',false,'manual_wake_mode',true,'isolated_global_pause_override',true,
      'starter_template_version','agent_starter_v0_1'));

  insert into agent_lab.resources(agent_id,compute_credits,research_credits,creative_credits,storage_quota_mb,metadata)
  values(v_agent_id,1440,1000,250,2048,jsonb_build_object('birth_allocation',true,'incubator_version','agent_incubator_v0_5',
    'birth_blueprint_version','birth_v0_6','starter_template_version','agent_starter_v0_1','economic_cost_policy','existence_time_only_v0_1'));

  insert into agent_lab.resource_accounts(agent_id,resource_type,unit,balance,target_reserve,reference_balance,metadata) values
    (v_agent_id,'compute','credits',1440,144,1440,jsonb_build_object('birth_allocation',true,'economic_cost_policy','existence_time_only_v0_1','birth_blueprint_version','birth_v0_6','existence_credit_policy','existence_credit_v0_2_reset_target')),
    (v_agent_id,'research','credits',1000,150,1000,jsonb_build_object('birth_allocation',true)),
    (v_agent_id,'creative','credits',250,37.5,250,jsonb_build_object('birth_allocation',true)),
    (v_agent_id,'storage','MB',2048,204.8,2048,jsonb_build_object('birth_allocation',true))
  on conflict(agent_id,resource_type) do update set
    unit=excluded.unit,balance=excluded.balance,reserved_balance=0,target_reserve=excluded.target_reserve,
    reference_balance=excluded.reference_balance,replenishable=true,earning_enabled=true,spending_enabled=true,
    metadata=agent_lab.resource_accounts.metadata||excluded.metadata,updated_at=now();

  for v_trait,v_value in select key,(value#>>'{}')::numeric from jsonb_each(v_temp) loop
    insert into agent_lab.traits(agent_id,trait_key,value,confidence,origin,metadata)
    values(v_agent_id,v_trait,v_value,0.35,'stochastic_seed_v0_5',jsonb_build_object('seed',p_ordinal,'incubator_version','agent_incubator_v0_5'));
  end loop;

  insert into agent_lab.agent_continuity_profiles(agent_id,brain_packet_version,cognition_protocol_version,memory_protocol_version,mutation_protocol_version,plasticity_protocol_version,identity_invariants,stable_trait_snapshot,behavioral_fingerprint,metadata)
  select v_agent_id,'brain_packet_v0_18','cognition_v0_1','memory_v0_1','mutation_v0_1','plasticity_v0_1',
    jsonb_build_object('history_rule','historical records may evolve only through recorded events; the model may not invent a past',
      'temperament_rule','birth seed traits are immutable; learned behavior develops around them through plasticity',
      'identity_rule','public name, gender, age, occupation, interests and embodiment are not assigned at birth',
      'infrastructure_identity_rule','internal labels, ordinals and operator shorthand are infrastructure-only and hidden from cognition'),
    coalesce(jsonb_object_agg(t.trait_key,jsonb_build_object('value',t.value,'origin',t.origin,'confidence',t.confidence)),'{}'::jsonb),
    jsonb_build_object('wake_number',0,'current_focus',null,'recent_actions','[]'::jsonb,'active_interests','[]'::jsonb,'active_goals','[]'::jsonb,'developmental_stage','seed'),
    jsonb_build_object('incubator_version','agent_incubator_v0_5','fresh_birth',true,'starter_template_version','agent_starter_v0_1')
  from agent_lab.traits t where t.agent_id=v_agent_id;

  select existence_policy_id into v_policy_id from agent_lab.existence_policies where active=true and effective_from<=now() and (effective_to is null or effective_to>now()) order by effective_from desc limit 1;
  if v_policy_id is null then raise exception 'active_existence_policy_missing'; end if;
  insert into agent_lab.agent_existence_accounts(agent_id,existence_policy_id,next_due_at,metadata)
  values(v_agent_id,v_policy_id,now()+interval '1 minute',jsonb_build_object('birth_account',true,'levy_cadence','per_minute',
    'economic_cost_policy','existence_time_only_v0_1','starter_template_version','agent_starter_v0_1'))
  on conflict(agent_id) do update set existence_policy_id=excluded.existence_policy_id,next_due_at=excluded.next_due_at,
    account_state='current',levy_enabled=true,arrears_balance=0,missed_cycles=0,total_assessed=0,total_paid=0,total_sponsored=0,
    dormancy_due=false,metadata=agent_lab.agent_existence_accounts.metadata||excluded.metadata,updated_at=now();

  return v_agent_id;
end $function$


CREATE OR REPLACE FUNCTION agent_lab.entrepreneurship_final_integrity_gate_v0_2(p_final_assessment_id uuid, p_score numeric, p_assessor_id text, p_report jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_f agent_lab.entrepreneurship_final_assessments%rowtype;
  v_cap jsonb;
  v_other record;
  v_required text[] := array[
    'conceptual_accuracy','analytical_rigor','quantitative_or_structured_reasoning',
    'application_quality','evidence_and_assumption_discipline',
    'self_critique_and_limits','clarity_and_epistemic_discipline'
  ];
  v_name text;
  v_dims jsonb:=coalesce(p_report->'dimensions','{}'::jsonb);
  v_value numeric;
  v_min numeric:=1;
  v_good_dimensions int:=0;
  v_issues jsonb:='[]'::jsonb;
  v_rationale text:=lower(regexp_replace(btrim(coalesce(p_report->>'rationale','')),'[[:space:]]+',' ','g'));
  v_pass boolean;
begin
  select * into v_f from agent_lab.entrepreneurship_final_assessments
    where final_assessment_id=p_final_assessment_id;
  if not found then raise exception 'final_assessment_not_found'; end if;

  if p_score is null or p_score<0 or p_score>1 then
    v_issues:=v_issues||'"score_out_of_range"'::jsonb;
  end if;
  if jsonb_typeof(p_report->'score') is distinct from 'number' then
    v_issues:=v_issues||'"report_score_missing"'::jsonb;
  elsif (p_report->>'score')::numeric is distinct from p_score then
    v_issues:=v_issues||'"report_score_mismatch"'::jsonb;
  end if;
  if jsonb_typeof(p_report->'critical_failure') is distinct from 'boolean' then
    v_issues:=v_issues||'"critical_failure_not_boolean"'::jsonb;
  end if;
  if jsonb_typeof(v_dims) is distinct from 'object' then v_dims:='{}'::jsonb; end if;
  foreach v_name in array v_required loop
    if jsonb_typeof(v_dims->v_name) is distinct from 'number' then
      v_issues:=v_issues||jsonb_build_array('dimension_missing_or_invalid:'||v_name);
    else
      v_value:=(v_dims->>v_name)::numeric;
      if v_value<0 or v_value>1 then
        v_issues:=v_issues||jsonb_build_array('dimension_out_of_range:'||v_name);
      else
        v_min:=least(v_min,v_value);
        v_good_dimensions:=v_good_dimensions+1;
      end if;
    end if;
  end loop;

  if length(v_rationale)<80 then v_issues:=v_issues||'"rationale_too_short"'::jsonb; end if;
  if jsonb_typeof(p_report->'strengths') is distinct from 'array' then
    v_issues:=v_issues||'"strengths_missing"'::jsonb;
  elsif jsonb_array_length(p_report->'strengths')<1 then
    v_issues:=v_issues||'"strengths_empty"'::jsonb;
  end if;
  if jsonb_typeof(p_report->'weaknesses') is distinct from 'array' then
    v_issues:=v_issues||'"weaknesses_missing"'::jsonb;
  elsif jsonb_array_length(p_report->'weaknesses')<1 then
    v_issues:=v_issues||'"weaknesses_empty"'::jsonb;
  end if;
  if jsonb_typeof(p_report->'remediation') is distinct from 'array' then
    v_issues:=v_issues||'"remediation_missing"'::jsonb;
  elsif jsonb_array_length(p_report->'remediation')<1 then
    v_issues:=v_issues||'"remediation_empty"'::jsonb;
  end if;

  if p_report->>'review_input_contract' is distinct from 'entrepreneurship_review_input_v0_2'
     or jsonb_typeof(p_report->'review_input_complete') is distinct from 'boolean'
     or p_report->>'review_input_complete' is distinct from 'true'
     or coalesce(p_report->>'review_input_sha256','') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_report->'review_input_chars') is distinct from 'number'
     or coalesce(p_report->>'source_course_count','')<>'15'
     or coalesce(p_report->>'source_capstone_unit_count','')<>'4'
     or p_report->>'capstone_prior_assessment_excluded' is distinct from 'true'
  then
    v_issues:=v_issues||'"full_source_input_provenance_missing"'::jsonb;
  elsif (p_report->>'review_input_chars')::numeric<1000
     or (p_report->>'review_input_chars')::numeric>90000 then
    v_issues:=v_issues||'"review_input_length_invalid"'::jsonb;
  end if;

  if p_report->>'independent_from_bound_agent_model' is distinct from 'true'
     or length(btrim(coalesce(p_report->>'review_provider','')))<3
     or length(btrim(coalesce(p_report->>'review_model','')))<3
     or lower(coalesce(p_assessor_id,''))<>lower(coalesce(p_report->>'review_provider','')||'/'||coalesce(p_report->>'review_model',''))
  then
    v_issues:=v_issues||'"assessor_identity_or_independence_invalid"'::jsonb;
  end if;

  if (select count(distinct course_code) from agent_lab.entrepreneurship_course_assessments
      where enrollment_id=v_f.enrollment_id and status='verified_pass')<>15 then
    v_issues:=v_issues||'"source_course_records_not_15"'::jsonb;
  end if;
  if not exists (
    select 1 from agent_lab.entrepreneurship_capstones c
    where c.enrollment_id=v_f.enrollment_id and c.status='verified_pass'
      and jsonb_typeof(c.submission_artifact->'unit_submissions')='array'
      and jsonb_array_length(c.submission_artifact->'unit_submissions')=4
  ) then
    v_issues:=v_issues||'"source_capstone_incomplete"'::jsonb;
  end if;

  select c.rubric_report into v_cap
    from agent_lab.entrepreneurship_course_assessments c
    where c.enrollment_id=v_f.enrollment_id and c.course_code='CAP515'
      and c.status='verified_pass' order by c.completed_at desc limit 1;
  if v_rationale<>'' and (
      v_rationale=lower(regexp_replace(btrim(coalesce(v_cap->>'rationale','')),'[[:space:]]+',' ','g'))
      or (p_report->'strengths'=v_cap->'strengths'
          and p_report->'weaknesses'=v_cap->'weaknesses'
          and p_report->'dimensions'=v_cap->'dimensions')
  ) then
    v_issues:=v_issues||'"capstone_assessor_report_reused"'::jsonb;
  end if;

  for v_other in
    select assessor_id,report from agent_lab.entrepreneurship_final_assessments
      where enrollment_id=v_f.enrollment_id and final_assessment_id<>p_final_assessment_id
        and status in ('verified_pass','verified_fail')
  loop
    if lower(btrim(coalesce(v_other.assessor_id,'')))=lower(btrim(coalesce(p_assessor_id,''))) then
      v_issues:=v_issues||'"final_assessor_identity_reused"'::jsonb;
    end if;
    if v_rationale<>'' and (
       v_rationale=lower(regexp_replace(btrim(coalesce(v_other.report->>'rationale','')),'[[:space:]]+',' ','g'))
       or (p_report->'strengths'=v_other.report->'strengths'
           and p_report->'weaknesses'=v_other.report->'weaknesses'
           and p_report->'dimensions'=v_other.report->'dimensions')
    ) then
      v_issues:=v_issues||'"other_final_report_reused"'::jsonb;
    end if;
  end loop;

  v_pass:=jsonb_array_length(v_issues)=0
          and p_score>=0.85 and v_good_dimensions=7 and v_min>=0.75
          and p_report->>'critical_failure'='false';

  return jsonb_build_object(
    'valid',jsonb_array_length(v_issues)=0,'passed',v_pass,
    'issues',v_issues,'source','entrepreneurship_final_integrity_gate_v0_2',
    'score_floor',0.85,'dimension_floor',0.75,
    'required_dimension_count',7,'valid_dimension_count',v_good_dimensions,
    'minimum_dimension_score',case when v_good_dimensions=7 then v_min else null end,
    'critical_failure_explicitly_false',p_report->>'critical_failure'='false',
    'full_input_contract_verified',p_report->>'review_input_contract'='entrepreneurship_review_input_v0_2'
  );
end
$function$


CREATE OR REPLACE FUNCTION agent_lab.launch_isolated_autonomous_lifecycle(p_agent_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_run_id uuid;
  v_wake_id uuid;
  v_model text;
  v_provider text;
  v_label text;
begin
  select primary_model_id,primary_model_provider,internal_label into v_model,v_provider,v_label
  from agent_lab.agents
  where agent_id=p_agent_id
    and internal_label in ('agent_thirty_two','agent_thirty_three')
    and status='incubating'
    and nullif(btrim(coalesce(primary_model_provider,'')),'') is not null;
  if coalesce(v_model,'')='' then raise exception 'isolated_model_binding_missing_or_unauthorized_agent'; end if;

  if exists(
    select 1 from agent_lab.autonomous_lifecycle_runs r
    where r.agent_id<>p_agent_id and r.status in ('starting','running','degraded')
  ) then raise exception 'another_isolated_autonomous_lifecycle_is_running'; end if;

  insert into agent_lab.autonomous_lifecycle_runs(agent_id,status,provider,model_id,rabbit_queue,metadata)
  values(p_agent_id,'starting',v_provider,v_model,'aau.wake',jsonb_build_object(
    'mode','autonomous_unsupervised','human_prompt_after_wake_one_required',false,
    'scheduler','rabbitmq_delayed_message','monitoring','continuous_operator_health_monitor',
    'isolated_agent_label',v_label
  ))
  on conflict(agent_id) do update set status='starting',provider=excluded.provider,model_id=excluded.model_id,rabbit_queue=excluded.rabbit_queue,
    launched_at=now(),next_wake_at=null,last_error=null,metadata=excluded.metadata,updated_at=now()
  returning run_id into v_run_id;

  insert into agent_lab.wake_queue(agent_id,source_kind,trigger_type,priority,due_at,payload,metadata)
  values(p_agent_id,'system','lifecycle_start',1,now(),jsonb_build_object('reason','Autonomous lifecycle wake 1: begin from persisted birth state without human follow-up.'),
    jsonb_build_object('autonomous_lifecycle',true,'lifecycle_run_id',v_run_id,'rabbit_transport','aau.wake','wake_ordinal',1))
  returning wake_request_id into v_wake_id;

  update agent_lab.state
  set state_payload=(coalesce(state_payload,'{}'::jsonb)-'paused_at'-'pause_reason')||jsonb_build_object(
    'awake',false,'sleeping',true,'system_paused',false,'wake_pending',true,'wake_pending_since',now(),'autonomous_lifecycle_run_id',v_run_id
  )
  where agent_id=p_agent_id;

  update agent_lab.runtime_config
     set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
       'current_experimental_agent_id',p_agent_id,
       'current_runtime_mode','single_agent_autonomous_model',
       'experimental_wake_loop_state','starting',
       'experimental_wake_loop_reason',null,
       'rabbitmq_wake_consumer_bound',false,
       'autonomous_lifecycle_run_id',v_run_id,
       'autonomous_lifecycle_started_at',now(),
       'global_pause',true,
       'pause_reason','all_agents_except_current_isolated_autonomous_agent',
       'current_experimental_agent_label',v_label
     ),executor_enabled=false,updated_at=now()
   where config_id=1;

  return v_run_id;
end;
$function$


CREATE OR REPLACE FUNCTION agent_lab.launch_starter_autonomous_lifecycle_v0_1(p_agent_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_run_id uuid;
  v_model text;
  v_provider text;
  v_label text;
  v_starter text;
  v_model_family text;
  v_model_surname text;
begin
  select primary_model_id,primary_model_provider,internal_label,metadata->>'starter_template_version'
    into v_model,v_provider,v_label,v_starter
  from agent_lab.agents
  where agent_id=p_agent_id
    and status='incubating'
    and nullif(btrim(coalesce(primary_model_provider,'')),'') is not null;

  if coalesce(v_model,'')='' then
    raise exception 'starter_autonomous_launch_block:model_binding_missing_or_agent_not_incubating';
  end if;
  if v_starter is distinct from 'agent_starter_v0_1' then
    raise exception 'starter_autonomous_launch_block:starter_template_required';
  end if;
  if exists(select 1 from agent_lab.autonomous_lifecycle_runs r where r.agent_id<>p_agent_id and r.status in ('starting','running','degraded')) then
    raise exception 'starter_autonomous_launch_block:another_isolated_autonomous_lifecycle_is_running';
  end if;

  v_model_family := coalesce(nullif(split_part(v_model,'/',2),''),v_model);
  v_model_surname := case
    when lower(v_model_family) like 'gemma%' then 'Gemma'
    when lower(v_model_family) like 'gpt-oss%' then 'GPT-OSS'
    when lower(v_model_family) like 'deepseek%' then 'DeepSeek'
    when lower(v_model_family) like 'glm%' then 'GLM'
    when lower(v_model_family) like 'nemotron%' then 'Nemotron'
    else initcap(replace(replace(split_part(v_model_family,'-',1),'_',' '),'.',' '))
  end;

  update agent_lab.agents
  set model_lineage=v_model,
      model_surname=v_model_surname,
      birth_model_provider=v_provider,
      birth_model_family=v_model_family,
      birth_model_version=v_model_family,
      birth_model_id=v_model,
      primary_model_provider=v_provider,
      primary_model_family=v_model_family,
      primary_model_version=v_model_family,
      primary_model_id=v_model,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'experimental_primary_binding',v_provider,
        'bound_model_id',v_model,
        'bound_model_family',v_model_family,
        'model_binding_normalized_at',now(),
        'next_intent_protocol','next_intent_protocol_v0_1'
      ),
      updated_at=now()
  where agent_id=p_agent_id;

  insert into agent_lab.autonomous_lifecycle_runs(agent_id,status,provider,model_id,rabbit_queue,metadata)
  values(p_agent_id,'starting',v_provider,v_model,'aau.intent',jsonb_build_object(
    'mode','autonomous_unsupervised',
    'starter_template_version','agent_starter_v0_1',
    'scheduler','rabbitmq_delayed_message',
    'monitoring','continuous_operator_health_monitor',
    'infrastructure_identity_hidden',true,
    'human_aligned_public_identity_required',true,
    'human_embodiment_required',true,
    'isolated_agent_label',v_label,
    'canonical_protocol','next_intent_protocol_v0_1',
    'next_intent_protocol','next_intent_protocol_v0_1'
  ))
  on conflict(agent_id) do update set
    status='starting',provider=excluded.provider,model_id=excluded.model_id,rabbit_queue=excluded.rabbit_queue,
    launched_at=now(),next_wake_at=null,last_error=null,
    metadata=coalesce(agent_lab.autonomous_lifecycle_runs.metadata,'{}'::jsonb)||excluded.metadata,
    updated_at=now()
  returning run_id into v_run_id;

  insert into agent_lab.wake_queue(agent_id,source_kind,trigger_type,priority,due_at,payload,metadata)
  values(
    p_agent_id,'system','lifecycle_start',1,now(),
    jsonb_build_object('reason','Autonomous lifecycle intent 1: begin from fresh starter state without human follow-up.'),
    jsonb_build_object(
      'autonomous_lifecycle',true,
      'lifecycle_run_id',v_run_id,
      'rabbit_transport','aau.intent',
      'intent_execution_ordinal',1,
      'protocol_version','next_intent_protocol_v0_1',
      'starter_template_version','agent_starter_v0_1'
    )
  );

  update agent_lab.agents
  set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
    'manual_wake_mode',false,
    'autonomous_lifecycle_enabled',true,
    'autonomous_lifecycle_run_id',v_run_id,
    'autonomous_lifecycle_started_at',now(),
    'next_intent_protocol','next_intent_protocol_v0_1'
  ),updated_at=now()
  where agent_id=p_agent_id;

  update agent_lab.state
  set state_payload=(coalesce(state_payload,'{}'::jsonb)-'paused_at'-'pause_reason'-'repair_pause_reason')||jsonb_build_object(
    'awake',true,
    'sleeping',false,
    'inactive_between_wakes',false,
    'between_cognition_ticks',false,
    'system_paused',false,
    'manual_wake_mode',false,
    'intent_pending',true,
    'wake_pending',true,
    'intent_pending_since',now(),
    'wake_pending_since',now(),
    'autonomous_lifecycle_run_id',v_run_id,
    'starter_template_version','agent_starter_v0_1',
    'next_intent_protocol','next_intent_protocol_v0_1',
    'sleep_eligibility_policy','sleep_eligibility_v0_1',
    'awake_continuity_policy','awake_continuity_v0_1'
  ),updated_at=now()
  where agent_id=p_agent_id;

  update agent_lab.agent_existence_accounts
  set account_state='current',
      levy_enabled=true,
      next_due_at=now()+interval '1 minute',
      metadata=(coalesce(metadata,'{}'::jsonb)-'suspended_reason'-'suspended_at')||jsonb_build_object(
        'resumed_at',now(),
        'resume_rule','restart_next_due_from_resume_time',
        'next_intent_protocol','next_intent_protocol_v0_1'
      ),
      updated_at=now()
  where agent_id=p_agent_id;

  update agent_lab.runtime_config
  set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
    'current_experimental_agent_id',p_agent_id,
    'current_experimental_agent_label',v_label,
    'current_runtime_mode','single_agent_autonomous_model',
    'experimental_intent_loop_state','starting',
    'experimental_intent_loop_reason',null,
    'rabbitmq_intent_consumer_bound',false,
    'autonomous_lifecycle_run_id',v_run_id,
    'autonomous_lifecycle_started_at',now(),
    'global_pause',true,
    'pause_reason','all_agents_except_current_isolated_autonomous_agent',
    'starter_template_version','agent_starter_v0_1',
    'next_intent_protocol','next_intent_protocol_v0_1',
    'experimental_wake_loop_state','starting',
    'experimental_wake_loop_reason',null,
    'rabbitmq_wake_consumer_bound',false
  ),executor_enabled=false,updated_at=now()
  where config_id=1;

  return v_run_id;
end;
$function$


CREATE OR REPLACE FUNCTION agent_lab.request_expertise_verification(p_agent_id uuid, p_expertise_artifact_id uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_model text;
  v_provider text;
  v_id uuid;
  v_track uuid;
  v_learning int := 0;
  v_entry_learning int := 1;
  v_art agent_lab.expertise_artifacts%rowtype;
  v_contract text;
  v_gate jsonb;
  v_legacy_files int := 0;
  v_academic_gate jsonb := '{}'::jsonb;
  v_independent_practice jsonb := '{}'::jsonb;
begin
  select coalesce(nullif(a.primary_model_id,''),nullif(a.birth_model_id,'')), coalesce(nullif(a.primary_model_provider,''),nullif(a.birth_model_provider,''))
  into v_model,v_provider
  from agent_lab.agents a
  where a.agent_id=p_agent_id;
  if v_model is null or v_provider is null then raise exception 'agent_model_not_bound'; end if;

  select * into v_art
  from agent_lab.expertise_artifacts x
  where x.expertise_artifact_id=p_expertise_artifact_id
    and x.agent_id=p_agent_id
    and x.status in ('initiated','accepted_for_development');
  if not found then raise exception 'eligible_expertise_artifact_not_found'; end if;

  if coalesce((v_art.metadata->>'standards_required')::boolean,false) then
    v_academic_gate:=agent_lab.expertise_standard_gate_v0_3(p_agent_id,p_expertise_artifact_id);
    if not coalesce((v_academic_gate->>'ready')::boolean,false)
        or v_academic_gate->>'sha256' is distinct from v_art.metadata->>'standard_sha256' then
      raise exception 'AAU_owned_master_standard_not_ready:%',v_academic_gate::text;
    end if;
    v_independent_practice:=agent_lab.evaluate_owned_master_practice_v0_3(p_agent_id,p_expertise_artifact_id);
    if not coalesce((v_independent_practice->>'ready')::boolean,false) then
      raise exception 'AAU_owned_master_independent_practice_incomplete:%',v_independent_practice::text;
    end if;
  end if;
  if coalesce(v_art.metadata->>'application_contract_version','')='expertise_application_v0_1'
     and not coalesce((agent_lab.validate_expertise_application_v0_1(v_art.intended_application,v_art.economic_viability)->>'ok')::boolean,false) then
    raise exception 'expertise_application_v0_1_incomplete:%',
      agent_lab.validate_expertise_application_v0_1(v_art.intended_application,v_art.economic_viability)::text;
  end if;

  v_contract := coalesce(v_art.metadata->>'portfolio_contract_version','expertise_portfolio_v0_1_legacy');
  v_track := agent_lab.ensure_domain_learning_track_for_artifact(p_agent_id,p_expertise_artifact_id);

  if v_contract='expertise_portfolio_v0_2' then
    v_gate := agent_lab.evaluate_expertise_portfolio_gate_v0_2(p_agent_id,p_expertise_artifact_id);
    if not coalesce((v_gate->>'ready_for_verification')::boolean,false) then
      raise exception 'expertise_portfolio_v0_2_incomplete:%', v_gate::text;
    end if;
  else
    -- Grandfather only pre-v0.2 experimental artifacts. The old capture path failed to
    -- canonicalize study/practice rows, so source files are accepted as the legacy baseline.
    select count(*) into v_learning
    from agent_lab.domain_learning_episodes where track_id=v_track;

    select count(*) into v_legacy_files
    from agent_lab.agent_files
    where agent_id=p_agent_id
      and direction='outbound'
      and purpose='agent_output'
      and created_at>=v_art.created_at;

    if v_learning<1 and v_legacy_files<1 then
      raise exception 'legacy_expertise_development_not_ready:no_learning_or_output_evidence';
    end if;

    v_gate := jsonb_build_object(
      'version','legacy_expertise_entry_baseline_v0_1',
      'contract_version',v_contract,
      'grandfathered',true,
      'learning_episodes',v_learning,
      'agent_output_files',v_legacy_files,
      'reason','pre_v0_2_experiment_preserved_without_retroactive_reclassification'
    );
  end if;

  -- A manual intervention is not a failed competence assessment. Do not
  -- create a replacement run to bypass the frozen checkpoint or alert.
  select r.verification_run_id into v_id
  from agent_lab.expertise_verification_runs r
  where r.agent_id=p_agent_id and r.expertise_artifact_id=p_expertise_artifact_id
    and r.status='manual_required'
  order by r.created_at desc limit 1;
  if v_id is not null then return v_id; end if;

  if exists(
    select 1 from agent_lab.expertise_verification_runs r
    where r.agent_id=p_agent_id
      and r.expertise_artifact_id=p_expertise_artifact_id
      and r.status in ('pending','claimed','running','awaiting_thesis')
  ) then
    select r.verification_run_id into v_id
    from agent_lab.expertise_verification_runs r
    where r.agent_id=p_agent_id
      and r.expertise_artifact_id=p_expertise_artifact_id
      and r.status in ('pending','claimed','running','awaiting_thesis')
    order by r.created_at desc limit 1;
    return v_id;
  end if;

  -- A completed failed assessment requires fresh canonical learning AND practice/artifact
  -- evidence before a new candidate packet can be constructed.
  if not coalesce((
    agent_lab.evaluate_expertise_reverification_evidence_v0_1(p_agent_id,p_expertise_artifact_id)
      ->>'ready_for_new_verification'
  )::boolean,false) then
    raise exception 'expertise_reverification_evidence_required:%',
      agent_lab.evaluate_expertise_reverification_evidence_v0_1(p_agent_id,p_expertise_artifact_id)::text;
  end if;

  insert into agent_lab.expertise_verification_runs(
    agent_id,expertise_artifact_id,candidate_model_id,metadata
  ) values (
    p_agent_id,p_expertise_artifact_id,v_model,
    coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object(
      'protocol','expertise_verification_runtime_v0_3',
      'provider',v_provider,
      'domain_learning_policy','domain_learning_v0_2',
      'authenticator_policy_version','expertise_authenticator_v0_2',
      'minimum_academic_equivalence','masters_equivalent',
      'threshold_authority','runtime_owned',
      'candidate_thresholds_ignored',true,
      'portfolio_contract_version',v_contract,
      'portfolio_entry_gate',v_gate,
      'academic_standard_version',case when v_academic_gate<>'{}'::jsonb then 'aau_owned_master_us_v0_3' else null end,
      'academic_standard_id',v_academic_gate->>'standard_id',
      'academic_standard_sha256',v_academic_gate->>'sha256',
      'academic_practice_gate',v_independent_practice
    )
  ) returning verification_run_id into v_id;

  return v_id;
end
$function$


CREATE OR REPLACE FUNCTION public.aau_bridge_apply_model_experimental_operator_wake(p_bridge_token text, p_wake_request_id uuid, p_result jsonb, p_runtime jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
declare
  v_agent_id uuid;
  v_status text;
  v_primary_provider text;
  v_primary_model text;
  v_applied jsonb;
  v_initial_binding boolean:=false;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select q.agent_id,q.status,a.primary_model_provider,a.primary_model_id,
         (
           a.consistency_status='TRANSITION_TESTING'
           and coalesce(a.model_transition_count,0)=0
           and a.last_verified_model is null
           and a.birth_model_id=a.primary_model_id
         )
    into v_agent_id,v_status,v_primary_provider,v_primary_model,v_initial_binding
  from agent_lab.wake_queue q
  join agent_lab.agents a on a.agent_id=q.agent_id
  where q.wake_request_id=p_wake_request_id;

  if v_agent_id is null then raise exception 'experimental_wake_not_found'; end if;
  if v_status<>'running' then raise exception 'experimental_wake_not_running'; end if;

  if nullif(btrim(coalesce(v_primary_provider,'')),'') is null
     or nullif(btrim(coalesce(v_primary_model,'')),'') is null then
    raise exception 'experimental_wake_model_binding_missing';
  end if;

  if coalesce(p_runtime->>'requested_model_id','')<>v_primary_model
     or coalesce(p_runtime->>'returned_model_id','')<>v_primary_model
     or coalesce(p_runtime->>'model_provider','')<>v_primary_provider then
    raise exception 'experimental_wake_model_consistency_breach';
  end if;

  v_applied:=agent_lab.apply_cognition_result_with_identity_clock(
    p_wake_request_id,
    coalesce(p_result,'{}'::jsonb),
    coalesce(p_runtime,'{}'::jsonb)
  );

  if v_initial_binding then
    update agent_lab.agents
       set last_verified_model=v_primary_model,
           last_verified_model_timestamp=now(),
           consistency_status='VERIFIED_PRIMARY',
           metadata=coalesce(metadata,'{}'::jsonb)
             || jsonb_build_object(
               'initial_model_verified_at',now(),
               'initial_model_verified_by_wake',p_wake_request_id,
               'initial_model_verified_provider',v_primary_provider
             ),
           updated_at=now()
     where agent_id=v_agent_id;
  end if;

  return coalesce(v_applied,'{}'::jsonb)
    || jsonb_build_object(
      'experimental_transport',v_primary_provider,
      'isolated_operator_override',true,
      'initial_binding_verified',v_initial_binding
    );
end;
$function$


CREATE OR REPLACE FUNCTION public.aau_bridge_apply_model_manual_wake(p_bridge_token text, p_wake_request_id uuid, p_result jsonb, p_runtime jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
declare
  v_agent_id uuid;
  v_provider text;
  v_model text;
  v_applied jsonb;
  v_caps jsonb;
  v_activity_id uuid;
  v_requests jsonb;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select q.agent_id,a.primary_model_provider,a.primary_model_id
    into v_agent_id,v_provider,v_model
  from agent_lab.wake_queue q
  join agent_lab.agents a on a.agent_id=q.agent_id
  where q.wake_request_id=p_wake_request_id;

  if v_agent_id is null then raise exception 'wake_request_not_found'; end if;
  if nullif(btrim(coalesce(v_provider,'')),'') is null
     or nullif(btrim(coalesce(v_model,'')),'') is null then
    raise exception 'agent_model_binding_missing';
  end if;

  if coalesce(p_runtime->>'model_provider','')<>v_provider
     or coalesce(p_runtime->>'requested_model_id','')<>v_model
     or coalesce(p_runtime->>'returned_model_id','')<>v_model then
    raise exception 'manual_wake_model_consistency_breach';
  end if;

  v_applied:=agent_lab.apply_cognition_result_with_identity_clock(
    p_wake_request_id,
    coalesce(p_result,'{}'::jsonb)||jsonb_build_object('next_wakes','[]'::jsonb),
    coalesce(p_runtime,'{}'::jsonb)||jsonb_build_object('manual_wake_mode',true)
  );
  v_activity_id:=nullif(v_applied->>'activity_id','')::uuid;
  v_requests:=agent_lab.extract_capability_requests(coalesce(p_result,'{}'::jsonb));
  v_caps:=agent_lab.apply_capability_requests(
    v_agent_id,p_wake_request_id,v_activity_id,v_requests
  );

  return v_applied||jsonb_build_object(
    'capability_requests',v_caps,
    'manual_wake_mode',true,
    'autonomous_next_wake_at',null,
    'autonomous_lifecycle_state','manual_operator_triggered'
  );
end;
$function$


CREATE OR REPLACE FUNCTION public.aau_bridge_begin_model_experimental_operator_wake(p_bridge_token text, p_agent_id uuid, p_idempotency_key text, p_reason text DEFAULT 'isolated experimental model wake'::text, p_priority numeric DEFAULT 0.99)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
declare
  v_agent agent_lab.agents%rowtype;
  v_wake_id uuid;
  v_existing_status text;
  v_packet jsonb;
  v_initial_binding boolean := false;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  if coalesce(btrim(p_idempotency_key),'') = '' then
    raise exception 'experimental_wake_idempotency_key_required';
  end if;

  select * into v_agent
  from agent_lab.agents
  where agent_id=p_agent_id and status<>'archived'
  for update;

  if v_agent.agent_id is null then
    raise exception 'experimental_wake_agent_missing_or_archived';
  end if;

  if nullif(btrim(coalesce(v_agent.primary_model_provider,'')),'') is null
     or nullif(btrim(coalesce(v_agent.primary_model_id,'')),'') is null then
    raise exception 'experimental_wake_requires_model_binding';
  end if;

  v_initial_binding := (
    v_agent.consistency_status='TRANSITION_TESTING'
    and coalesce(v_agent.model_transition_count,0)=0
    and v_agent.last_verified_model is null
    and v_agent.birth_model_id=v_agent.primary_model_id
    and not exists(
      select 1 from agent_lab.wake_queue q
      where q.agent_id=p_agent_id and q.status='completed'
    )
  );

  if coalesce(v_agent.consistency_status,'') <> 'VERIFIED_PRIMARY'
     and not v_initial_binding then
    raise exception 'experimental_wake_model_binding_not_verified_or_initial';
  end if;

  select q.wake_request_id,q.status
    into v_wake_id,v_existing_status
  from agent_lab.wake_queue q
  where q.agent_id=p_agent_id
    and q.source_kind='manual'
    and q.payload->'data'->>'idempotency_key'=p_idempotency_key
  order by q.created_at desc
  limit 1;

  if v_wake_id is not null then
    if v_existing_status='queued' then
      update agent_lab.wake_queue
         set status='claimed',
             claimed_at=now(),
             worker_id='render:model-experimental'
       where wake_request_id=v_wake_id and status='queued';
      perform agent_lab.mark_wake_running(v_wake_id);
      v_existing_status:='running';
    end if;
    if v_existing_status in ('claimed','running') then
      v_packet:=agent_lab.build_wake_execution_context(p_agent_id,v_wake_id);
    end if;
    return jsonb_build_object(
      'existing',true,
      'wake_request_id',v_wake_id,
      'status',v_existing_status,
      'agent_id',p_agent_id,
      'primary_model_provider',v_agent.primary_model_provider,
      'primary_model_id',v_agent.primary_model_id,
      'initial_binding',v_initial_binding,
      'packet',v_packet
    );
  end if;

  v_wake_id:=agent_lab.queue_manual_wake(
    p_agent_id,
    coalesce(nullif(p_reason,''),'isolated experimental model wake'),
    greatest(0,least(1,coalesce(p_priority,0.99))),
    jsonb_build_object(
      'idempotency_key',p_idempotency_key,
      'model_provider',v_agent.primary_model_provider,
      'experimental_only',true,
      'isolated_operator_override',true,
      'initial_binding',v_initial_binding
    )
  );

  update agent_lab.wake_queue
     set status='claimed',
         claimed_at=now(),
         worker_id='render:model-experimental'
   where wake_request_id=v_wake_id and status='queued';

  perform agent_lab.mark_wake_running(v_wake_id);
  v_packet:=agent_lab.build_wake_execution_context(p_agent_id,v_wake_id);

  return jsonb_build_object(
    'existing',false,
    'wake_request_id',v_wake_id,
    'status','running',
    'agent_id',p_agent_id,
    'primary_model_provider',v_agent.primary_model_provider,
    'primary_model_id',v_agent.primary_model_id,
    'initial_binding',v_initial_binding,
    'packet',v_packet
  );
end;
$function$


CREATE OR REPLACE FUNCTION public.aau_bridge_complete_agent_file_vision_job_v0_2(p_bridge_token text, p_worker_id text, p_file_id uuid, p_provider text, p_model_id text, p_analysis jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab', 'extensions'
AS $function$
declare
  v_file agent_lab.agent_files%rowtype;
  v_analysis jsonb;
  v_item uuid;
  v_arb jsonb;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  if nullif(btrim(coalesce(p_provider,'')),'') is null then
    raise exception 'vision_provider_required';
  end if;

  select * into v_file
  from agent_lab.agent_files
  where file_id=p_file_id
  for update;

  if not found then raise exception 'file_not_found'; end if;
  if coalesce(v_file.metadata->>'vision_claimed_by','')<>coalesce(p_worker_id,'') then
    raise exception 'vision_claim_owner_mismatch';
  end if;
  if v_file.mime_type not like 'image/%' then
    raise exception 'vision_job_requires_image';
  end if;

  v_analysis:=jsonb_build_object(
    'version','agent_file_vision_v0_2',
    'provider',p_provider,
    'model',left(coalesce(p_model_id,'unknown'),200),
    'generated_at',now(),
    'source_file_id',v_file.file_id,
    'source_sha256',v_file.sha256,
    'tool_derived_observation',true,
    'not_ground_truth',true,
    'analysis',coalesce(p_analysis,'{}'::jsonb)
  );

  update agent_lab.agent_files
     set processing_status='reviewed',
         metadata=(coalesce(metadata,'{}'::jsonb)
           -'vision_claimed_by'-'vision_claimed_at'-'vision_claim_expires_at'-'vision_reprocess_required')
           ||jsonb_build_object(
             'vision_analysis',v_analysis,
             'vision_ready',true,
             'vision_completed_at',now(),
             'file_channel_version','agent_file_channel_v0_2'
           ),
         updated_at=now()
   where file_id=p_file_id;

  if v_file.embodiment_asset_id is not null then
    update agent_lab.embodiment_assets
       set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
         'vision_analysis',v_analysis,
         'vision_ready',true,
         'vision_processing_version','agent_file_vision_v0_2'
       )
     where embodiment_asset_id=v_file.embodiment_asset_id
       and agent_id=v_file.agent_id;
  end if;

  update agent_lab.admin_chat_messages
     set delivery_status='queued',
         updated_at=now(),
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'vision_ready',true,
           'vision_ready_at',now()
         )
   where message_id=v_file.source_message_id;

  v_item:=agent_lab.enqueue_attention_item_v0_1(
    v_file.agent_id,'file',p_file_id::text,'admin_image_file_ready',
    0.96,0.94,0.75,0.70,0,1,'boundary',
    jsonb_build_object(
      'admin_chat_message_id',v_file.source_message_id,
      'admin_file_id',p_file_id,
      'filename',v_file.filename,
      'mime_type',v_file.mime_type,
      'purpose',v_file.purpose,
      'vision_ready',true
    ),
    jsonb_build_object(
      'origin','agent_file_vision_v0_2',
      'vision_analysis',v_analysis
    )
  );

  v_arb:=agent_lab.arbitrate_attention_v0_1(v_file.agent_id);

  return jsonb_build_object(
    'status',coalesce(v_arb->>'status','queued'),
    'file_id',p_file_id,
    'attention_item_id',v_item,
    'wake_request_id',v_arb->'wake_request_id',
    'arbiter',v_arb,
    'agent_id',v_file.agent_id,
    'vision_analysis',v_analysis
  );
end;
$function$


CREATE OR REPLACE FUNCTION public.aau_bridge_fail_model_experimental_operator_wake(p_bridge_token text, p_wake_request_id uuid, p_error text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
declare
  v_agent_id uuid;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  update agent_lab.wake_queue q
     set status='failed',
         completed_at=now(),
         last_error=left(coalesce(p_error,'experimental_model_wake_failed'),4000)
    from agent_lab.agents a
   where q.wake_request_id=p_wake_request_id
     and q.agent_id=a.agent_id
     and nullif(btrim(coalesce(a.primary_model_provider,'')),'') is not null
     and q.status in ('claimed','running')
  returning q.agent_id into v_agent_id;

  if v_agent_id is not null then
    update agent_lab.state
       set state_payload = jsonb_set(
         jsonb_set(
           jsonb_set(coalesce(state_payload,'{}'::jsonb),'{wake_pending}','false'::jsonb,true),
           '{awake}','false'::jsonb,true
         ),
         '{sleeping}','true'::jsonb,true
       ),
       updated_at=now()
     where agent_id=v_agent_id;
  end if;

  return jsonb_build_object(
    'wake_request_id',p_wake_request_id,
    'agent_id',v_agent_id,
    'status',case when v_agent_id is null then 'unchanged' else 'failed' end
  );
end;
$function$


CREATE OR REPLACE FUNCTION public.aau_control_room_admin_unpause(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab', 'extensions'
AS $function$
declare
  v_agent agent_lab.agents%rowtype;
  v_run agent_lab.autonomous_lifecycle_runs%rowtype;
  v_message_id uuid;
  v_wake_id uuid;
  v_trigger text := 'operator_resume';
  v_payload jsonb;
  v_dual_enabled boolean := false;
  v_allowlist jsonb := '[]'::jsonb;
begin
  select * into v_agent from agent_lab.agents where agent_id=p_agent_id and status<>'archived';
  if v_agent.agent_id is null then raise exception 'agent_missing_or_archived'; end if;
  if nullif(btrim(coalesce(v_agent.primary_model_provider,'')),'') is null or nullif(btrim(coalesce(v_agent.primary_model_id,'')),'') is null then raise exception 'agent_model_binding_missing'; end if;
  select * into v_run from agent_lab.autonomous_lifecycle_runs where agent_id=p_agent_id;
  if v_run.run_id is null then raise exception 'autonomous_lifecycle_missing'; end if;
  -- Two-agent experimental mode is an explicit, exact-ID allowlist; all
  -- other agents retain the isolated single-agent restart guard.
  select coalesce((metadata->>'dual_agent_mode_enabled')::boolean,false),
         coalesce(metadata->'dual_agent_allowlist','[]'::jsonb)
    into v_dual_enabled,v_allowlist
    from agent_lab.runtime_config where config_id=1 for update;
  if v_dual_enabled then
    if v_allowlist <> jsonb_build_array(
      '3b190e7e-b452-4888-9850-3a35a4e95cad',
      '69d013d2-cfb7-4953-b05a-598774618ed2') then
      raise exception 'dual_agent_allowlist_unexpected';
    end if;
    if not (v_allowlist @> jsonb_build_array(p_agent_id::text)) then
      raise exception 'agent_not_authorized_for_dual_mode';
    end if;
  end if;
  if exists(
    select 1 from agent_lab.autonomous_lifecycle_runs r
    where r.agent_id<>p_agent_id and r.status in ('starting','running','degraded')
      and (not v_dual_enabled or not (v_allowlist @> jsonb_build_array(r.agent_id::text)))
  ) then raise exception 'another_autonomous_agent_running'; end if;

  update agent_lab.wake_queue set status='cancelled',completed_at=coalesce(completed_at,now()),last_error='superseded_by_admin_unpause',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('cancel_reason','admin_unpause_clean_start') where agent_id=p_agent_id and status in ('queued','claimed','running');
  update agent_lab.wake_intents set status='cancelled',cancelled_at=now(),metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('cancel_reason','admin_unpause_clean_start') where agent_id=p_agent_id and status='active';

  select m.message_id into v_message_id from agent_lab.admin_chat_messages m
  where m.agent_id=p_agent_id and m.sender_kind='admin' and m.delivery_status in ('queued','scheduled')
    -- System interventions already resolved and answered must never become
    -- a new direct administrator chat simply because an operator resumes.
    and not (
      m.metadata->>'origin'='automatic_runtime_intervention_v0_1'
      and m.metadata->>'system_authored'='true'
      and m.metadata->>'not_human_admin'='true'
      and exists (
        select 1 from agent_lab.intervention_events ie
        where ie.intervention_id=nullif(m.metadata->>'intervention_id','')::uuid
          and ie.agent_id=m.agent_id and ie.message_id=m.message_id and ie.status='resolved'
      )
      and exists (
        select 1 from agent_lab.admin_chat_messages reply
        where reply.agent_id=m.agent_id and reply.sender_kind='agent'
          and reply.reply_to_message_id=m.message_id
          and nullif(btrim(reply.content),'') is not null
      )
    )
  order by m.created_at desc limit 1;

  if v_message_id is not null then v_trigger:='admin_chat'; end if;
  v_payload:=case when v_message_id is not null
    then jsonb_build_object('reason','Administrator resumed the agent with pending direct chat messages.','admin_chat_message_id',v_message_id)
    else jsonb_build_object('reason','Administrator resumed autonomous lifecycle from Agent Control Room.') end;

  insert into agent_lab.wake_queue(agent_id,source_kind,trigger_type,priority,status,due_at,payload,metadata)
  values(p_agent_id,'manual',v_trigger,1,'queued',now(),v_payload,jsonb_build_object('autonomous_lifecycle',true,'operator_resume',true,'admin_chat',v_message_id is not null,'admin_chat_message_id',v_message_id,'protocol_version','next_intent_protocol_v0_1','intent_timing_version','intent_timing_v0_2','operator_control_room',true))
  returning wake_request_id into v_wake_id;

  if v_message_id is not null then
    update agent_lab.admin_chat_messages
       set delivery_status='scheduled',source_wake_request_id=v_wake_id,updated_at=now()
     where message_id=v_message_id
       and agent_id=p_agent_id
       and sender_kind='admin'
       and delivery_status in ('queued','scheduled');
  end if;

  update agent_lab.autonomous_lifecycle_runs
  set status='running',next_wake_at=now(),last_error=null,
      metadata=(coalesce(metadata,'{}'::jsonb)
        -'paused_at'-'pause_reason'
        -'repair_required'-'repair_reason'-'repair_required_at'-'failed_wake_request_id')
        ||jsonb_build_object(
          'resumed_at',now(),
          'resumed_by','agent_control_room_admin',
          'admin_control_version','admin_control_v0_2',
          'last_repair_cleared_at',now(),
          'last_repair_clear_reason','explicit_admin_unpause'
        ),
      updated_at=now()
  where agent_id=p_agent_id;
  update agent_lab.state set state_payload=(coalesce(state_payload,'{}'::jsonb)-'paused_at'-'pause_reason'-'repair_pause_reason')||jsonb_build_object('system_paused',false,'awake',true,'sleeping',false,'wake_pending',true,'intent_pending',true,'between_cognition_ticks',false,'inactive_between_wakes',false,'wake_pending_since',now(),'intent_pending_since',now(),'admin_control_version','admin_control_v0_2'),updated_at=now() where agent_id=p_agent_id;
  update agent_lab.agent_existence_accounts
  set account_state='current',levy_enabled=true,next_due_at=now()+interval '1 minute',
      metadata=(coalesce(metadata,'{}'::jsonb)-'suspended_reason'-'suspended_at'-'failed_wake_request_id')
        ||jsonb_build_object(
          'resumed_at',now(),
          'resume_rule','restart_next_due_from_resume_time',
          'admin_control_version','admin_control_v0_2'
        ),
      updated_at=now()
  where agent_id=p_agent_id;

  update agent_lab.operator_alerts
  set status='resolved',resolved_at=now(),last_seen_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'resolved_reason','explicit_admin_unpause_recovery',
        'resolved_at',now()
      )
  where agent_id=p_agent_id
    and alert_type='orphaned_autonomous_intent_exhausted'
    and status='open';
  update agent_lab.runtime_config set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('current_experimental_agent_id',p_agent_id,'current_experimental_agent_label',v_agent.internal_label,'current_runtime_mode',case when v_dual_enabled then 'dual_agent_autonomous_model_serial' else 'single_agent_autonomous_model' end,'experimental_intent_loop_state','running','experimental_intent_loop_reason',null,'global_pause',true,'admin_control_version','admin_control_v0_2','intent_timing_version','intent_timing_v0_2','minimum_time_intent_delay_minutes',5),updated_at=now() where config_id=1;

  return jsonb_build_object('status','running','agent_id',p_agent_id,'wake_request_id',v_wake_id,'trigger_type',v_trigger,'pending_chat',v_message_id is not null,'dual_agent_mode',v_dual_enabled);
end;
$function$


drop function if exists agent_lab.create_manual_starter_agent_v0_7(integer,text,text);
drop function if exists public.aau_bridge_complete_agent_file_vision_job(text,text,uuid,text,jsonb);
drop function if exists public.aau_bridge_begin_experimental_nvidia_wake(text,uuid,text,text,numeric);
drop function if exists public.aau_bridge_apply_experimental_nvidia_wake(text,uuid,jsonb,jsonb);
drop function if exists public.aau_bridge_fail_experimental_nvidia_wake(text,uuid,text);
drop function if exists public.aau_bridge_apply_nvidia_manual_wake(text,uuid,jsonb,jsonb);

revoke all on function public.aau_bridge_complete_agent_file_vision_job_v0_2(text,text,uuid,text,text,jsonb) from public,authenticated;
grant execute on function public.aau_bridge_complete_agent_file_vision_job_v0_2(text,text,uuid,text,text,jsonb) to anon,service_role;

revoke all on function public.aau_bridge_begin_model_experimental_operator_wake(text,uuid,text,text,numeric) from public,authenticated;
grant execute on function public.aau_bridge_begin_model_experimental_operator_wake(text,uuid,text,text,numeric) to anon,service_role;

revoke all on function public.aau_bridge_apply_model_experimental_operator_wake(text,uuid,jsonb,jsonb) from public,authenticated;
grant execute on function public.aau_bridge_apply_model_experimental_operator_wake(text,uuid,jsonb,jsonb) to anon,service_role;

revoke all on function public.aau_bridge_fail_model_experimental_operator_wake(text,uuid,text) from public,authenticated;
grant execute on function public.aau_bridge_fail_model_experimental_operator_wake(text,uuid,text) to anon,service_role;

revoke all on function public.aau_bridge_apply_model_manual_wake(text,uuid,jsonb,jsonb) from public,authenticated;
grant execute on function public.aau_bridge_apply_model_manual_wake(text,uuid,jsonb,jsonb) to anon,service_role;

commit;
