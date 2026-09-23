-- AAU Entrepreneurship remediation context v0.1
-- Exposes only persisted independent feedback for the currently reassigned failed unit.
-- It does not alter the curriculum, pass threshold, or assessment authority.
begin;
CREATE OR REPLACE FUNCTION agent_lab.build_entrepreneurship_remediation_context_v0_1(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_progress jsonb;
  v_unit uuid;
  v_order integer;
  v_title text;
  v_course text;
  v_up agent_lab.entrepreneurship_unit_progress%rowtype;
  v_course_assessment agent_lab.entrepreneurship_course_assessments%rowtype;
  v_remediation jsonb:='[]'::jsonb;
  v_weaknesses jsonb:='[]'::jsonb;
begin
  v_progress:=agent_lab.entrepreneurship_program_progress_v0_1(p_agent_id);
  if coalesce(v_progress->>'status','')<>'in_progress'
     or nullif(v_progress#>>'{next_unit,unit_id}','') is null then
    return jsonb_build_object('active',false,'version','entrepreneurship_remediation_context_v0_1');
  end if;
  v_unit:=(v_progress#>>'{next_unit,unit_id}')::uuid;
  v_order:=coalesce((v_progress#>>'{next_unit,unit_order}')::integer,0);
  v_title:=v_progress#>>'{next_unit,title}';
  v_course:=v_progress#>>'{current_course,course_code}';
  select * into v_up from agent_lab.entrepreneurship_unit_progress
   where agent_id=p_agent_id and unit_id=v_unit;
  if not found or v_up.status<>'verified_fail' or v_up.assessment_report is null then
    return jsonb_build_object('active',false,'version','entrepreneurship_remediation_context_v0_1',
      'unit_id',v_unit,'unit_status',coalesce(v_up.status,'not_started'));
  end if;
  select * into v_course_assessment
   from agent_lab.entrepreneurship_course_assessments
   where agent_id=p_agent_id and course_code=v_course
   order by completed_at desc nulls last,created_at desc limit 1;
  select coalesce(jsonb_agg(value),'[]'::jsonb) into v_remediation
   from jsonb_array_elements_text(coalesce(v_up.assessment_report->'remediation','[]'::jsonb))
   where value ~* ('^Unit[[:space:]]+'||v_order::text||':');
  select coalesce(jsonb_agg(value),'[]'::jsonb) into v_weaknesses
   from jsonb_array_elements_text(coalesce(v_up.assessment_report->'weaknesses','[]'::jsonb))
   where value ~* ('^Unit[[:space:]]+'||v_order::text||':');
  return jsonb_build_object(
    'active',true,
    'version','entrepreneurship_remediation_context_v0_1',
    'authority','independent_course_assessment',
    'course_code',v_course,
    'unit_id',v_unit,
    'unit_order',v_order,
    'unit_title',v_title,
    'unit_status',v_up.status,
    'unit_attempt_count',v_up.attempt_count,
    'unit_score',v_up.score,
    'assessed_at',v_up.assessed_at,
    'course_attempt_no',v_course_assessment.attempt_no,
    'course_score',v_course_assessment.score,
    'course_status',v_course_assessment.status,
    'assessment_model',v_up.assessor_id,
    'weaknesses',v_weaknesses,
    'required_remediation',v_remediation,
    'rule','Revise the CURRENT assigned unit against this persisted independent assessment. Produce materially improved work; do not resubmit the rejected artifact unchanged. The assessment feedback is evidence about the prior submission, not permission to alter the assignment or pass threshold.'
  );
end;
$function$
;
revoke all on function agent_lab.build_entrepreneurship_remediation_context_v0_1(uuid) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION agent_lab.get_cognition_packet(p_agent_id uuid, p_wake_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'agent_lab', 'public', 'extensions', 'pg_temp'
AS $function$
declare
 v_packet jsonb;
 v_results jsonb;
 v_contract jsonb;
 v_knowledge jsonb:='{}'::jsonb;
 v_pool_enabled boolean:=false;
 v_remediation jsonb:='{}'::jsonb;
begin
 v_packet:=agent_lab.get_cognition_packet_pre_capability_results_v0_1(p_agent_id,p_wake_request_id);
 v_results:=agent_lab.build_recent_capability_results_v0_1(p_agent_id);
 v_contract:=agent_lab.build_evidence_first_cognition_contract_v0_1();
 select coalesce((metadata->>'knowledge_pool_enabled')::boolean,false)
   into v_pool_enabled from agent_lab.runtime_config where config_id=1;
 if v_pool_enabled then
   perform agent_lab.ensure_agent_knowledge_pool_v0_1(p_agent_id);
   v_knowledge:=agent_lab.build_knowledge_pool_context_v0_1(p_agent_id);
   v_packet:=v_packet||jsonb_build_object('knowledge_pool_context',v_knowledge,
     'knowledge_pool_version','knowledge_pool_v0_2_refresh_provenance',
     'knowledge_pool_output_contract',
       'On this successful cognition, review both General Knowledge and Peripheral Knowledge. Return knowledge_pool_update.general and knowledge_pool_update.peripheral with status (added, revised, revalidated, unchanged, stale, deferred), event_ids from offered source-backed candidate_events, seed_item_ids from dated seed_candidates, refresh_item_ids from attributed dated refresh_candidates, and an optional short note. When genuinely accepting offered material, use status added and its exact offered IDs; do not claim new knowledge without valid IDs. Unchanged is valid when no new evidence is offered or a justified review identifies no uptake. Preserve publisher, publication date, observation period and forecast-versus-observation distinctions. Source attribution is not independent claim verification or expertise verification. Optionally report knowledge_usage only for an adopted item explicitly cited by URL and exact excerpt in an actually submitted MBA analysis; never invent usage.');
 end if;
 if exists(select 1 from agent_lab.complex_work_pilots w where w.agent_id=p_agent_id and w.status in ('draft','in_progress','blocked','submitted')) then
   v_packet:=v_packet||jsonb_build_object('complex_work_context',agent_lab.build_complex_work_context_v0_1(p_agent_id));
 end if;
 v_remediation:=agent_lab.build_entrepreneurship_remediation_context_v0_1(p_agent_id);
 if coalesce((v_remediation->>'active')::boolean,false) then
   v_packet:=v_packet||jsonb_build_object(
     'entrepreneurship_remediation_context',v_remediation
   );
 end if;
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
       'reserved_name_hashes',coalesce((
         select jsonb_agg(distinct encode(sha256(convert_to(lower(btrim(other.public_name)),'UTF8')),'hex'))
         from agent_lab.agents other
         join agent_lab.agents self on self.agent_id=p_agent_id
         where other.agent_id<>p_agent_id
           and nullif(btrim(other.public_name),'') is not null
           and (
             coalesce(other.birth_model_timestamp,other.created_at)<coalesce(self.birth_model_timestamp,self.created_at)
             or (
               coalesce(other.birth_model_timestamp,other.created_at)=coalesce(self.birth_model_timestamp,self.created_at)
               and other.agent_id<p_agent_id
             )
           )
       ),'[]'::jsonb),
       'rule','Your public name must be distinct from any earlier registered agent. The runtime checks candidate names against hashed reservations without disclosing another agent name. Choose your own name; do not inherit another identity.'),
     'recent_capability_results',v_results,
     'expertise_action_feedback',agent_lab.build_expertise_action_feedback_v0_1(p_agent_id),
     'academic_standard_context',agent_lab.build_owned_expertise_standard_context_v0_3(p_agent_id),
     'capability_result_system_contract',
     'recent_capability_results is authoritative runtime feedback. If an inspection capability is COMPLETED, its result is available now and must not be described as pending. Use completed evidence before repeating the same inspection.',
     'evidence_first_cognition_contract',v_contract,
     'evidence_first_system_contract',
     'Intention is not execution, execution is not independent verification. Use evidence_first_cognition_contract before making progress claims or selecting another external action. Never claim a gate passed without the latest authoritative verdict.'
   )
 );
end;
$function$
;
commit;
