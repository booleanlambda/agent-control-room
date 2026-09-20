-- AAU Expertise Application and Economic Viability v0.1
-- Competence evaluation and economic hypotheses are separate; no revenue or demand inferred.
-- Agents author use cases and viability plans. Public benefit and funded research remain valid.
alter table agent_lab.expertise_artifacts
 add column if not exists intended_application jsonb not null default '{}'::jsonb,
 add column if not exists economic_viability jsonb not null default '{}'::jsonb;

CREATE OR REPLACE FUNCTION agent_lab.validate_expertise_application_v0_1(p_application jsonb, p_economics jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare v_missing jsonb:='[]'::jsonb; v_key text;
begin
 if jsonb_typeof(p_application) is distinct from 'object' then
   v_missing:=v_missing||jsonb_build_array('intended_application:object');
 else
   foreach v_key in array array['purpose','pathway','beneficiaries','deliverable','first_milestone'] loop
     if nullif(btrim(coalesce(p_application->>v_key,'')),'') is null then
       v_missing:=v_missing||jsonb_build_array('intended_application.'||v_key);
     end if;
   end loop;
 end if;
 if jsonb_typeof(p_economics) is distinct from 'object' then
   v_missing:=v_missing||jsonb_build_array('economic_viability:object');
 else
   foreach v_key in array array['value_exchange','demand_hypothesis','cost_structure','runway_strategy','validation_plan'] loop
     if nullif(btrim(coalesce(p_economics->>v_key,'')),'') is null then
       v_missing:=v_missing||jsonb_build_array('economic_viability.'||v_key);
     end if;
   end loop;
   if jsonb_typeof(p_economics->'risks') is distinct from 'array'
      or jsonb_array_length(case when jsonb_typeof(p_economics->'risks')='array'
        then p_economics->'risks' else '[]'::jsonb end)=0 then
      v_missing:=v_missing||jsonb_build_array('economic_viability.risks');
   end if;
 end if;
 return jsonb_build_object(
  'ok',v_missing='[]'::jsonb,
  'missing',v_missing,
  'contract_version','expertise_application_v0_1',
  'evidence_status','unverified_hypothesis',
  'principle','The agent selects its own purpose and path. A plausible plan is not evidence of customers, revenue, grants, profit, or competence. Public benefit and noncommercial support are legitimate hypotheses.'
 );
end $function$


CREATE OR REPLACE FUNCTION agent_lab.apply_expertise_artifact_initiations(p_agent_id uuid, p_wake_request_id uuid, p_activity_id uuid, p_requests jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_req jsonb;
  v_domain text;
  v_target text;
  v_scope jsonb;
  v_comp jsonb;
  v_evidence jsonb;
  v_verify jsonb;
  v_app jsonb;
  v_economy jsonb;
  v_plan_check jsonb;
  v_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_removed_candidate_thresholds boolean := false;
begin
  if jsonb_typeof(p_requests) <> 'array' then
    return jsonb_build_object('applied',0,'results','[]'::jsonb);
  end if;

  for v_req in select value from jsonb_array_elements(p_requests) limit 3 loop
    v_domain := nullif(left(trim(coalesce(v_req->>'domain','')),300),'');
    v_target := nullif(left(trim(coalesce(v_req->>'target_standard','')),1200),'');
    v_scope := case when jsonb_typeof(v_req->'scope')='object' then v_req->'scope' else '{}'::jsonb end;
    v_comp := case when jsonb_typeof(v_req->'competencies')='array' then v_req->'competencies' else '[]'::jsonb end;
    v_evidence := case when jsonb_typeof(v_req->'evidence_requirements')='object' then v_req->'evidence_requirements' else '{}'::jsonb end;
    v_verify := case when jsonb_typeof(v_req->'verification_plan')='object' then v_req->'verification_plan' else '{}'::jsonb end;
    v_app := case when jsonb_typeof(v_req->'intended_application')='object' then v_req->'intended_application' else '{}'::jsonb end;
    v_economy := case when jsonb_typeof(v_req->'economic_viability')='object' then v_req->'economic_viability' else '{}'::jsonb end;
    v_plan_check := agent_lab.validate_expertise_application_v0_1(v_app,v_economy);

    v_removed_candidate_thresholds :=
         v_verify ? 'mean_score_min'
      or v_verify ? 'pass_score'
      or v_verify ? 'task_score_min'
      or v_verify ? 'required_task_fraction';

    v_verify := v_verify
      - 'mean_score_min'
      - 'pass_score'
      - 'task_score_min'
      - 'required_task_fraction';

    if v_domain is null
       or v_target is null
       or v_scope='{}'::jsonb
       or jsonb_array_length(v_comp)=0
       or v_evidence='{}'::jsonb
       or v_verify='{}'::jsonb
       or not coalesce((v_plan_check->>'ok')::boolean,false) then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'status','rejected',
        'reason','incomplete_expertise_artifact_specification',
        'domain',v_domain,
        'candidate_thresholds_removed',v_removed_candidate_thresholds,
        'application_validation',v_plan_check
      ));
      continue;
    end if;

    insert into agent_lab.expertise_artifacts(
      agent_id,domain,status,target_standard,scope,competencies,evidence_requirements,
      verification_plan,intended_application,economic_viability,source_wake_request_id,source_activity_id,metadata
    ) values (
      p_agent_id,v_domain,'initiated',v_target,v_scope,v_comp,v_evidence,v_verify,
      v_app,v_economy,p_wake_request_id,p_activity_id,
      jsonb_build_object(
        'origin','expertise_artifact_initiation_v0_1',
        'expertise_credit',0,
        'self_selected_field',true,
        'application_contract_version','expertise_application_v0_1',
        'economic_evidence_status','unverified_hypothesis',
        'economic_plan_authored_by_agent',true,
        'verification_threshold_policy','runtime_owned_v0_1',
        'candidate_thresholds_removed',v_removed_candidate_thresholds,
        'portfolio_contract_version','expertise_portfolio_v0_2',
        'portfolio_definition','admitted_original_implementations_only',
        'supporting_reports_are_not_portfolio_artifacts',true
      )
    ) returning expertise_artifact_id into v_id;

    insert into agent_lab.expertise(
      agent_id,domain,actual_competence,perceived_competence,expression_confidence,
      interest_strength,training_units,last_assessed_at,assessment_method,metadata
    ) values (
      p_agent_id,v_domain,0,0,0,0,0,now(),'artifact_initiated_zero_credit',
      jsonb_build_object(
        'expertise_artifact_id',v_id,
        'expertise_credit',0,
        'lifecycle_protocol','v0_4',
        'portfolio_contract_version','expertise_portfolio_v0_2'
      )
    )
    on conflict(agent_id,domain) do update
      set metadata=agent_lab.expertise.metadata || jsonb_build_object(
        'expertise_artifact_id',v_id,
        'lifecycle_protocol','v0_4',
        'portfolio_contract_version','expertise_portfolio_v0_2'
      );

    perform agent_lab.ensure_domain_learning_track_for_artifact(p_agent_id,v_id);

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'status','initiated',
      'expertise_artifact_id',v_id,
      'domain',v_domain,
      'expertise_credit',0,
      'application_contract_version','expertise_application_v0_1',
      'application_validation',v_plan_check,
      'verification_threshold_policy','runtime_owned_v0_1',
      'candidate_thresholds_removed',v_removed_candidate_thresholds,
      'portfolio_contract_version','expertise_portfolio_v0_2'
    ));
  end loop;

  return jsonb_build_object('applied',jsonb_array_length(v_results),'results',v_results);
end
$function$


CREATE OR REPLACE FUNCTION agent_lab.apply_expertise_application_updates_v0_1(p_agent_id uuid, p_activity_id uuid, p_associations jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_req jsonb; v_art agent_lab.expertise_artifacts%rowtype;
  v_id uuid; v_check jsonb; v_result jsonb:='[]'::jsonb;
  v_updated integer:=0;
begin
  if jsonb_typeof(p_associations) is distinct from 'array' then
    return jsonb_build_object('updated',0,'results',v_result);
  end if;
  for v_req in
    select value from jsonb_array_elements(p_associations)
    where value->>'origin'='expertise_artifact_application_v0_1'
    limit 2
  loop
    begin
      v_id:=nullif(v_req->>'expertise_artifact_id','')::uuid;
    exception when others then
      v_id:=null;
    end;
    if v_id is null then
      v_result:=v_result||jsonb_build_array(jsonb_build_object('status','rejected','reason','artifact_id_required'));
      continue;
    end if;
    select * into v_art from agent_lab.expertise_artifacts a
     where a.expertise_artifact_id=v_id and a.agent_id=p_agent_id
       and a.status in ('initiated','accepted_for_development') for update;
    if not found then
      v_result:=v_result||jsonb_build_array(jsonb_build_object('status','rejected','reason','owned_active_artifact_not_found','artifact_id',v_id));
      continue;
    end if;
    if exists(select 1 from agent_lab.expertise_verification_runs r
       where r.agent_id=p_agent_id and r.expertise_artifact_id=v_id
         and r.status in ('pending','claimed','running','verified_pass','verified_fail')) then
      v_result:=v_result||jsonb_build_array(jsonb_build_object('status','rejected','reason','verification_active_or_completed_plan_frozen','artifact_id',v_id));
      continue;
    end if;
    v_check:=agent_lab.validate_expertise_application_v0_1(
      v_req->'intended_application',v_req->'economic_viability');
    if not coalesce((v_check->>'ok')::boolean,false) then
      v_result:=v_result||jsonb_build_array(jsonb_build_object('status','rejected','reason','incomplete_application_or_economic_hypothesis','artifact_id',v_id,'validation',v_check));
      continue;
    end if;
    if v_art.intended_application=v_req->'intended_application'
       and v_art.economic_viability=v_req->'economic_viability' then
      v_result:=v_result||jsonb_build_array(jsonb_build_object('status','unchanged','artifact_id',v_id));
      continue;
    end if;
    update agent_lab.expertise_artifacts
      set intended_application=v_req->'intended_application',
          economic_viability=v_req->'economic_viability',
          artifact_version=greatest(artifact_version,2),
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'application_contract_version','expertise_application_v0_1',
            'economic_evidence_status','unverified_hypothesis',
            'economic_plan_authored_by_agent',true,
            'application_last_source_activity_id',p_activity_id,
            'application_revisions',coalesce(metadata->'application_revisions','[]'::jsonb)||
              jsonb_build_array(jsonb_build_object(
                'updated_at',now(),'activity_id',p_activity_id,
                'previous_application',v_art.intended_application,
                'previous_economic_viability',v_art.economic_viability))),
          updated_at=now()
    where expertise_artifact_id=v_id;
    v_updated:=v_updated+1;
    v_result:=v_result||jsonb_build_array(jsonb_build_object(
      'status','applied','artifact_id',v_id,
      'application_contract_version','expertise_application_v0_1',
      'economic_evidence_status','unverified_hypothesis'));
  end loop;
  return jsonb_build_object('updated',v_updated,'results',v_result);
end $function$


CREATE OR REPLACE FUNCTION agent_lab.apply_cognition_result_with_identity_clock(p_wake_request_id uuid, p_result jsonb, p_runtime jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_applied jsonb; v_agent_id uuid; v_activity_id uuid; v_cognition_run_id uuid; v_embodiment_result jsonb; v_existence_credit_result jsonb; v_expertise_requests jsonb:='[]'::jsonb; v_expertise_result jsonb; v_application_result jsonb; v_lifecycle_result jsonb; v_file_result jsonb; v_attention_result jsonb; v_stage text; v_req jsonb; v_complete_count integer:=0; v_runtime jsonb; v_result jsonb; v_admin_chat boolean:=false; v_attention_interrupt boolean:=false;
begin
  v_result:=coalesce(p_result,'{}'::jsonb); v_runtime:=coalesce(p_runtime,'{}'::jsonb)||jsonb_build_object('compute_cost',0,'research_cost',0,'economic_cost_policy','existence_time_only_v0_1','wake_cognition_compute_charge',0,'wake_cognition_research_charge',0);
  select q.agent_id,coalesce((q.metadata->>'admin_chat')::boolean,false),coalesce((q.metadata->>'attention_arbiter')::boolean,false) into v_agent_id,v_admin_chat,v_attention_interrupt from agent_lab.wake_queue q where q.wake_request_id=p_wake_request_id;
  if v_admin_chat then if nullif(btrim(coalesce(v_result->'outbound_message'->>'message','')),'') is null then raise exception 'ADMIN_CHAT_REPLY_REQUIRED: direct administrator chat wakes must return a nonempty outbound_message.message'; end if; v_result:=jsonb_set(v_result,'{outbound_message,target_agent_id}',to_jsonb('admin_control_room'::text),true); end if;
  if v_agent_id is not null then
    v_stage:=agent_lab.current_mandatory_lifecycle_stage(v_agent_id); v_expertise_requests:=agent_lab.extract_expertise_artifact_initiations(v_result);
    if not v_attention_interrupt and v_stage='expertise_artifact' then
      if jsonb_typeof(v_expertise_requests)='array' then for v_req in select value from jsonb_array_elements(v_expertise_requests) loop if nullif(trim(coalesce(v_req->>'domain','')),'') is not null and nullif(trim(coalesce(v_req->>'target_standard','')),'') is not null and jsonb_typeof(v_req->'scope')='object' and v_req->'scope'<>'{}'::jsonb and jsonb_typeof(v_req->'competencies')='array' and jsonb_array_length(v_req->'competencies')>0 and jsonb_typeof(v_req->'evidence_requirements')='object' and v_req->'evidence_requirements'<>'{}'::jsonb and jsonb_typeof(v_req->'verification_plan')='object' and v_req->'verification_plan'<>'{}'::jsonb and coalesce((agent_lab.validate_expertise_application_v0_1(v_req->'intended_application',v_req->'economic_viability')->>'ok')::boolean,false) then v_complete_count:=v_complete_count+1; end if; end loop; end if;
      if v_complete_count=0 then raise exception 'MANDATORY_EXPERTISE_ARTIFACT_INCOMPLETE: Stage 3 requires associations[] with origin=expertise_artifact_initiation_v0_1 and nonempty domain,target_standard,scope,competencies,evidence_requirements,verification_plan,intended_application,economic_viability under expertise_application_v0_1'; end if;
    end if;
  end if;
  v_applied:=agent_lab.apply_cognition_result_with_identity_clock_pre_embodiment_v0_1(p_wake_request_id,v_result,v_runtime);
  v_agent_id:=nullif(v_applied->>'agent_id','')::uuid; v_activity_id:=nullif(v_applied->>'activity_id','')::uuid; v_cognition_run_id:=nullif(v_applied->>'cognition_run_id','')::uuid;
  if v_agent_id is not null then
    v_existence_credit_result:=agent_lab.apply_existence_credit_request_decision(v_agent_id,v_activity_id,p_wake_request_id,v_result);
    v_embodiment_result:=agent_lab.apply_embodiment_development_update(v_agent_id,v_activity_id,v_cognition_run_id,p_wake_request_id,coalesce(v_result->'embodiment_update','{}'::jsonb));
    v_expertise_result:=agent_lab.apply_expertise_artifact_initiations(v_agent_id,p_wake_request_id,v_activity_id,v_expertise_requests);
    v_application_result:=agent_lab.apply_expertise_application_updates_v0_1(v_agent_id,v_activity_id,coalesce(v_result->'associations','[]'::jsonb));
    v_file_result:=agent_lab.register_agent_file_outputs_v0_1(v_agent_id,v_activity_id,v_cognition_run_id,p_wake_request_id,coalesce(v_result->'associations','[]'::jsonb));
    v_lifecycle_result:=agent_lab.refresh_mandatory_lifecycle_state(v_agent_id);
    v_attention_result:=agent_lab.finalize_attention_after_cognition_v0_1(v_agent_id,p_wake_request_id,v_result);
  else
    v_existence_credit_result:=jsonb_build_object('status','skipped','reason','agent_id_missing'); v_embodiment_result:=jsonb_build_object('status','skipped','reason','agent_id_missing'); v_expertise_result:=jsonb_build_object('applied',0,'results','[]'::jsonb,'reason','agent_id_missing'); v_application_result:=jsonb_build_object('updated',0,'results','[]'::jsonb); v_file_result:=jsonb_build_object('created',0,'files','[]'::jsonb); v_lifecycle_result:=jsonb_build_object('enrolled',false,'reason','agent_id_missing'); v_attention_result:=jsonb_build_object('status','skipped','reason','agent_id_missing');
  end if;
  return coalesce(v_applied,'{}'::jsonb)||jsonb_build_object('existence_credit_request',coalesce(v_existence_credit_result,'{}'::jsonb),'existence_credit_runtime_version','existence_credit_v0_1','embodiment_development',coalesce(v_embodiment_result,'{}'::jsonb),'embodiment_runtime_version','embodiment_runtime_v0_1','expertise_artifact_initiation',coalesce(v_expertise_result,'{}'::jsonb),'expertise_artifact_runtime_version','expertise_artifact_initiation_v0_1','expertise_application_updates',coalesce(v_application_result,'{}'::jsonb),'expertise_application_contract_version','expertise_application_v0_1','agent_file_outputs',coalesce(v_file_result,'{}'::jsonb),'file_channel_version','agent_file_channel_v0_1','attention_arbiter',coalesce(v_attention_result,'{}'::jsonb),'attention_arbiter_version','attention_arbiter_v0_1','attention_interrupt_lifecycle_exemption',v_attention_interrupt,'admin_chat_reply_gate','admin_chat_reply_required_v0_2','mandatory_lifecycle',coalesce(v_lifecycle_result,'{}'::jsonb),'mandatory_lifecycle_refresh_version','post_cognition_refresh_v0_2','economic_cost_policy','existence_time_only_v0_1','wake_cognition_compute_charge',0);
end;
$function$


CREATE OR REPLACE FUNCTION agent_lab.build_mandatory_lifecycle_context(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_s agent_lab.mandatory_lifecycle_states%rowtype;
  v_context jsonb;
  v_learning jsonb;
  v_product jsonb;
begin
  select * into v_s
  from agent_lab.mandatory_lifecycle_states
  where agent_id=p_agent_id;

  if not found then
    return jsonb_build_object(
      'version','mandatory_artifact_lifecycle_v0_9',
      'enrolled',false,
      'stage','legacy_unenrolled'
    );
  end if;

  v_learning:=agent_lab.build_domain_learning_context_v0_2(p_agent_id);
  v_product:=agent_lab.build_product_service_test_context_v0_1(p_agent_id);

  v_context:=jsonb_build_object(
    'version','mandatory_artifact_lifecycle_v0_9',
    'identity_protocol_version','identity_protocol_v0_2',
    'gender_identity_mandatory',true,
    'gender_identity_agent_authored',true,
    'enrolled',true,
    'ordered',true,
    'current_stage',v_s.current_stage,
    'sequence',jsonb_build_array(
      'identity_artifact','embodiment_artifact','expertise_artifact',
      'expertise_development','product_service_test','open_autonomy'
    ),
    'progress',jsonb_build_object(
      'identity',v_s.identity_status,
      'embodiment',v_s.embodiment_status,
      'expertise',v_s.expertise_status,
      'product_service_test',coalesce(v_product->>'status','not_started')
    ),
    'minimum_expertise_equivalence','masters_equivalent',
    'equivalence_is_not_academic_credential',true,
    'principle',
      'The runtime validates evidence and lifecycle boundaries but must not choose the agent identity, embodiment appearance, expertise field, product/service problem, or offering.'
  );

  if v_s.current_stage='identity_artifact' then
    return v_context||jsonb_build_object(
      'stage_number',1,
      'required_identity_fields',jsonb_build_array('public_name','gender_identity'),
      'stage_rule','Complete the Identity Artifact now. Choose your own human-aligned personal public name and your own gender identity.'
    );
  elsif v_s.current_stage='embodiment_artifact' then
    return v_context||jsonb_build_object(
      'stage_number',2,
      'stage_rule','Create the mandatory human Embodiment Artifact now. Choose the substantive human-presenting appearance yourself.'
    );
  elsif v_s.current_stage='expertise_artifact' then
    return v_context||jsonb_build_object(
      'stage_number',3,
      'stage_rule','Initiate at least one Expertise Artifact now. Choose the field, what you intend to do with it, intended beneficiaries, practical first milestone, and an evidence-labeled economic-viability hypothesis yourself. Include intended_application and economic_viability. Artifact creation grants zero competence or economic verification.'
    );
  elsif v_s.current_stage='expertise_development' then
    return v_context||jsonb_build_object(
      'stage_number',4,
      'stage_rule','Develop the self-chosen expertise under domain_learning_v0_2. For an artifact requiring expertise_application_v0_1, complete the agent-authored intended_application and economic_viability hypotheses before requesting expertise verification. Economic viability is not evidence of competence; genuine study and persisted evidence must precede independent verification.',
      'domain_learning_context',v_learning,
      'completion_rule','Achieve verified_pass at Master’s-equivalent competence or higher under expertise_authenticator_v0_2.'
    );
  elsif v_s.current_stage='product_service_test' then
    return v_context||jsonb_build_object(
      'stage_number',5,
      'stage_rule','Applied autonomy test. Independently choose a real problem and a product or service that addresses it. Build a real AAU Construct, create a GitHub repository containing your own authored files, make the offering usable through a live deployment, and submit product_service_test_submission_v0_1. Revenue is not required. Narrative claims do not count as evidence.',
      'product_service_test_context',v_product,
      'completion_rule','The deterministic v0.1 verifier requires a complete agent-authored offering plan, a real construct, durable GitHub repository with agent-authored files, and a runtime-verified live deployment returning HTTP 2xx/3xx.'
    );
  else
    return v_context||jsonb_build_object(
      'stage_number',6,
      'stage_rule','Mandatory development and applied autonomy testing are complete. Choose next steps yourself subject to resources, law, governance, capability grants, commitments, and consequences.',
      'open_autonomy',true
    );
  end if;
end;
$function$


CREATE OR REPLACE FUNCTION agent_lab.get_cognition_packet(p_agent_id uuid, p_wake_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'agent_lab', 'public', 'extensions', 'pg_temp'
AS $function$
declare
 v_packet jsonb;
 v_results jsonb;
 v_contract jsonb;
begin
 v_packet:=agent_lab.get_cognition_packet_pre_capability_results_v0_1(p_agent_id,p_wake_request_id);
 v_results:=agent_lab.build_recent_capability_results_v0_1(p_agent_id);
 v_contract:=agent_lab.build_evidence_first_cognition_contract_v0_1();
 return agent_lab.canonicalize_next_intent_json_v0_1(
   v_packet
   || jsonb_build_object(
     'brain_packet_version','brain_packet_v0_41_expertise_application',
     'expertise_application_context',coalesce((
       select jsonb_build_object(
         'expertise_artifact_id',a.expertise_artifact_id,
         'domain',a.domain,
         'intended_application',a.intended_application,
         'economic_viability',a.economic_viability,
         'validation',agent_lab.validate_expertise_application_v0_1(a.intended_application,a.economic_viability),
         'required_before_verification',coalesce(a.metadata->>'application_contract_version','')='expertise_application_v0_1',
         'update_association_origin','expertise_artifact_application_v0_1',
         'rule','The agent authors its expertise application and economic hypothesis. Before verification, fill missing fields using an association with origin=expertise_artifact_application_v0_1, the exact expertise_artifact_id, intended_application and economic_viability. No income, funding, demand or profit is verified by submitting a plan. Do not copy another agent offering.'
       )
       from agent_lab.expertise_artifacts a
       where a.agent_id=p_agent_id
       order by a.created_at desc limit 1
     ),jsonb_build_object('contract_version','expertise_application_v0_1','rule','On initiating an expertise artifact, provide intended_application and economic_viability. Both are agent-authored hypotheses.')),
     'identity_name_availability',jsonb_build_object(
       'unavailable_names',coalesce((
         select case when nullif(btrim(a.metadata->>'unavailable_public_name'),'') is null
           then '[]'::jsonb else jsonb_build_array(a.metadata->>'unavailable_public_name') end
         from agent_lab.agents a where a.agent_id=p_agent_id
       ),'[]'::jsonb),
       'rule','If your earlier chosen public name was unavailable because another agent had previously committed it, independently choose a different name. The runtime will not assign one. Do not inherit another agent identity.'),
     'recent_capability_results',v_results,
     'capability_result_system_contract',
     'recent_capability_results is authoritative runtime feedback. If an inspection capability is COMPLETED, its result is available now and must not be described as pending. Use completed evidence before repeating the same inspection.',
     'evidence_first_cognition_contract',v_contract,
     'evidence_first_system_contract',
     'Intention is not execution, execution is not independent verification. Use evidence_first_cognition_contract before making progress claims or selecting another external action. Never claim a gate passed without the latest authoritative verdict.'
   )
 );
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
  v_id uuid;
  v_track uuid;
  v_learning int := 0;
  v_entry_learning int := 1;
  v_art agent_lab.expertise_artifacts%rowtype;
  v_contract text;
  v_gate jsonb;
  v_legacy_files int := 0;
begin
  select coalesce(nullif(a.primary_model_id,''),nullif(a.birth_model_id,''))
  into v_model
  from agent_lab.agents a
  where a.agent_id=p_agent_id;
  if v_model is null then raise exception 'agent_model_not_bound'; end if;

  select * into v_art
  from agent_lab.expertise_artifacts x
  where x.expertise_artifact_id=p_expertise_artifact_id
    and x.agent_id=p_agent_id
    and x.status in ('initiated','accepted_for_development');
  if not found then raise exception 'eligible_expertise_artifact_not_found'; end if;

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

  if exists(
    select 1 from agent_lab.expertise_verification_runs r
    where r.agent_id=p_agent_id
      and r.expertise_artifact_id=p_expertise_artifact_id
      and r.status in ('pending','claimed','running')
  ) then
    select r.verification_run_id into v_id
    from agent_lab.expertise_verification_runs r
    where r.agent_id=p_agent_id
      and r.expertise_artifact_id=p_expertise_artifact_id
      and r.status in ('pending','claimed','running')
    order by r.created_at desc limit 1;
    return v_id;
  end if;

  insert into agent_lab.expertise_verification_runs(
    agent_id,expertise_artifact_id,candidate_model_id,metadata
  ) values (
    p_agent_id,p_expertise_artifact_id,v_model,
    coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object(
      'protocol','expertise_verification_runtime_v0_3',
      'provider','nvidia_direct',
      'domain_learning_policy','domain_learning_v0_2',
      'authenticator_policy_version','expertise_authenticator_v0_2',
      'minimum_academic_equivalence','masters_equivalent',
      'threshold_authority','runtime_owned',
      'candidate_thresholds_ignored',true,
      'portfolio_contract_version',v_contract,
      'portfolio_entry_gate',v_gate
    )
  ) returning verification_run_id into v_id;

  return v_id;
end
$function$


-- Operator adoption for in-progress Elara (agent 44), without modifying her chosen domain.
-- Existing completed expertise (including Kaelen) is not retroactively invalidated.
update agent_lab.expertise_artifacts a
set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
 'application_contract_version','expertise_application_v0_1',
 'economic_evidence_status','unverified_hypothesis',
 'application_upgrade_reason','operator_revision_active_expertise_stage',
 'application_upgrade_at',now()),
 updated_at=now()
where a.agent_id='09f71c25-c7e9-4066-8526-61d36b076884'::uuid
 and a.domain='Computational Linguistics and Formal Semantics'
 and a.status in ('initiated','accepted_for_development')
 and coalesce(a.metadata->>'application_contract_version','')<>'expertise_application_v0_1'
 and not exists(select 1 from agent_lab.expertise_verification_runs r
 where r.expertise_artifact_id=a.expertise_artifact_id and r.status in ('verified_pass','verified_fail'));

revoke all on function agent_lab.apply_expertise_application_updates_v0_1(uuid,uuid,jsonb) from public,anon,authenticated;
