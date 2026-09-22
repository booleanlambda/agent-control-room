create or replace function agent_lab.build_owned_expertise_standard_context_v0_3(p_agent_id uuid)
returns jsonb language plpgsql stable set search_path to 'pg_catalog','agent_lab'
as $$
declare v_art agent_lab.expertise_artifacts%rowtype;v_std agent_lab.expertise_standard_versions%rowtype;
begin
 select * into v_art from agent_lab.expertise_artifacts where agent_id=p_agent_id
  order by created_at desc limit 1;
 if not found then
   return jsonb_build_object('version','aau_owned_master_us_v0_3','active',false,
      'academic_target','leading_us_university_masters_level_demonstrated_competence',
      'standard_authority','AAU_only');
 end if;
 select * into v_std from agent_lab.expertise_standard_versions
  where agent_id=p_agent_id and (artifact_id=v_art.expertise_artifact_id
     or (proposal_id::text=v_art.metadata->>'operator_expertise_viability_proposal_id'))
  order by created_at desc limit 1;
 if not found then
   return jsonb_build_object('version','aau_owned_master_us_v0_3',
       'active',coalesce((v_art.metadata->>'standards_required')::boolean,false),
       'status','not_yet_authored',
       'academic_target','leading_us_university_masters_level_demonstrated_competence',
       'instruction','AAU owns competence standards. The agent chooses the field and may author its application and original work; it must not author or amend its academic rubric.');
 end if;
 return jsonb_build_object('version','aau_owned_master_us_v0_3',
    'active',true,'standard_id',v_std.standard_id,'status',v_std.status,
    'academic_target','leading_us_university_masters_level_demonstrated_competence',
    'public_spec',case when v_std.status='approved' then v_std.public_spec else '{}'::jsonb end,
    'standard_sha256',case when v_std.status='approved' then v_std.specification_sha256 else null end,
    'reviewed_by_independent_model',v_std.status='approved' and v_std.author_model<>v_std.reviewer_model,
    'private_assessment_hidden',true,
    'instruction',case when v_std.status='approved' then
      'This AAU-authored public standard is binding. Submit original work and practice for independent assessment. Private tasks and answer keys remain unseen.'
      else 'Academic standard awaits independent AAU authoring/review. Do not invent its competencies, exam state or certification.' end);
end;
$$;
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
     'knowledge_pool_version','knowledge_pool_v0_1',
     'knowledge_pool_output_contract',
       'On this successful cognition, review both General Knowledge and Peripheral Knowledge. Return knowledge_pool_update.general and knowledge_pool_update.peripheral with status (added, revised, revalidated, unchanged, stale, deferred), event_ids from offered source-backed candidate_events, seed_item_ids from offered dated source-backed seed_candidates, and an optional short note. When an offered dated item is genuinely reviewed and accepted, use status added and its exact seed_item_ids; do not claim new knowledge without valid IDs. Unchanged is valid when no new evidence is offered or a justified review identifies no new uptake. Preserve publisher, publication date, observation period and forecast-versus-observation distinctions. A verified source is not expertise verification.');
 end if;
 if exists(select 1 from agent_lab.complex_work_pilots w where w.agent_id=p_agent_id and w.status in ('draft','in_progress','blocked','submitted')) then
   v_packet:=v_packet||jsonb_build_object('complex_work_context',agent_lab.build_complex_work_context_v0_1(p_agent_id));
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
