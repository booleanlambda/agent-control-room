-- AAU expertise-stage evidence/action boundary (v0.4).
-- Operator-scoped repair. No existing agent activity, evidence or verdict is reclassified.
create table if not exists agent_lab.expertise_action_feedback (
  intent_execution_id uuid primary key,
  agent_id uuid not null references agent_lab.agents(agent_id) on delete cascade,
  source_activity_id uuid not null,
  results jsonb not null check (jsonb_typeof(results)='array'),
  created_at timestamptz not null default now()
);
create index if not exists idx_expertise_action_feedback_agent_created
  on agent_lab.expertise_action_feedback(agent_id,created_at desc);

create or replace function public.aau_bridge_record_expertise_action_feedback(
  p_bridge_token text, p_agent_id uuid, p_intent_execution_id uuid,
  p_source_activity_id uuid, p_results jsonb
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public','agent_lab'
as $$
declare v_stored jsonb;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  if p_agent_id is null or p_intent_execution_id is null or p_source_activity_id is null then
    raise exception 'expertise_action_feedback_identity_required';
  end if;
  if jsonb_typeof(p_results) is distinct from 'array' then
    raise exception 'expertise_action_feedback_array_required';
  end if;
  if not exists(select 1 from agent_lab.activity_log a
       where a.agent_id=p_agent_id and a.activity_id=p_source_activity_id) then
    raise exception 'expertise_action_feedback_activity_not_found';
  end if;
  insert into agent_lab.expertise_action_feedback(
    intent_execution_id,agent_id,source_activity_id,results
  ) values(p_intent_execution_id,p_agent_id,p_source_activity_id,p_results)
  on conflict(intent_execution_id) do nothing;
  select results into v_stored from agent_lab.expertise_action_feedback
    where intent_execution_id=p_intent_execution_id and agent_id=p_agent_id;
  if v_stored is distinct from p_results then
    raise exception 'expertise_action_feedback_idempotency_mismatch';
  end if;
  return jsonb_build_object('status','recorded',
    'intent_execution_id',p_intent_execution_id,'source_activity_id',p_source_activity_id,
    'result_count',jsonb_array_length(v_stored));
end;
$$;
revoke all on function public.aau_bridge_record_expertise_action_feedback(text,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.aau_bridge_record_expertise_action_feedback(text,uuid,uuid,uuid,jsonb) to service_role;

create or replace function agent_lab.build_expertise_action_feedback_v0_1(p_agent_id uuid)
returns jsonb language sql stable set search_path to 'pg_catalog','agent_lab'
as $$
select jsonb_build_object(
  'version','expertise_action_feedback_v0_1',
  'rule','Only result.status=accepted with a canonical knowledge_unit_id proves persistence. A rejected or merely proposed unit is not persistent knowledge. Do not claim or reuse it without new genuine evidence.',
  'canonical_accepted_units', (select count(*) from agent_lab.expertise_knowledge_units u
      where u.agent_id=p_agent_id and u.active=true),
  'latest_submissions',coalesce((
    select jsonb_agg(jsonb_build_object(
      'intent_execution_id',q.intent_execution_id,
      'source_activity_id',q.source_activity_id,
      'recorded_at',q.created_at,
      'results',q.results
    ) order by q.created_at desc)
    from (select f.* from agent_lab.expertise_action_feedback f
      where f.agent_id=p_agent_id order by f.created_at desc limit 4) q
  ),'[]'::jsonb)
);
$$;

create or replace function agent_lab.evaluate_expertise_reverification_evidence_v0_1(
  p_agent_id uuid, p_expertise_artifact_id uuid
) returns jsonb language plpgsql stable
set search_path to 'pg_catalog','agent_lab'
as $$
declare
 v_failed_at timestamptz;
 v_failure uuid;
 v_units integer := 0;
 v_practice integer := 0;
 v_impl integer := 0;
begin
 select r.verification_run_id,coalesce(r.verified_at,r.updated_at)
 into v_failure,v_failed_at
 from agent_lab.expertise_verification_runs r
 where r.agent_id=p_agent_id and r.expertise_artifact_id=p_expertise_artifact_id
   and r.status='verified_fail'
 order by r.created_at desc limit 1;
 if v_failure is null then
   return jsonb_build_object('version','expertise_reverification_evidence_v0_1',
     'required',false,'ready_for_new_verification',true,'reason','no_completed_failed_assessment');
 end if;
 select count(*) into v_units
 from agent_lab.expertise_knowledge_units u
 join agent_lab.activity_log a on a.activity_id=u.source_activity_id and a.agent_id=u.agent_id
 where u.agent_id=p_agent_id and u.expertise_artifact_id=p_expertise_artifact_id
   and u.active and u.created_at>v_failed_at and a.created_at>v_failed_at
   and u.provenance_status='retrieved_source_receipts_verified'
   and jsonb_typeof(u.source_manifest)='array' and jsonb_array_length(u.source_manifest)>0;
 select count(*) into v_practice from agent_lab.domain_practice_attempts p
 where p.agent_id=p_agent_id and p.track_id in (
   select t.track_id from agent_lab.domain_learning_tracks t
    where t.agent_id=p_agent_id
      and t.metadata->>'expertise_artifact_id'=p_expertise_artifact_id::text
 ) and p.attempted_at>v_failed_at
   and jsonb_typeof(p.evidence)='object' and p.evidence<>'{}'::jsonb;
 select count(*) into v_impl from agent_lab.expertise_portfolio_artifacts i
 where i.agent_id=p_agent_id and i.expertise_artifact_id=p_expertise_artifact_id
   and i.admission_status='admitted' and i.artifact_type='implementation'
   and i.original_work and i.admitted_at>v_failed_at;
 return jsonb_build_object(
   'version','expertise_reverification_evidence_v0_1',
   'required',true,'last_failed_run_id',v_failure,'last_failed_at',v_failed_at,
   'new_receipt_backed_knowledge_units',v_units,
   'new_practice_records_with_evidence',v_practice,
   'new_admitted_implementations',v_impl,
   'ready_for_new_verification',v_units>0 and (v_practice>0 or v_impl>0),
   'reason',case when v_units=0 then 'new_accepted_source_backed_learning_required'
     when v_practice=0 and v_impl=0 then 'new_practice_or_admitted_implementation_required'
     else 'fresh_development_evidence_present' end,
   'scope','Applies only to a new exam after the latest completed verified_fail; never changes a frozen verdict.',
   'practice_disclaimer','A recorded practice attempt is evidence of action, not independently verified competence.'
 );
end;
$$;

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

CREATE OR REPLACE FUNCTION agent_lab.build_expertise_portfolio_context_v0_2(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_art agent_lab.expertise_artifacts%rowtype;
  v_gate jsonb;
  v_items jsonb;
  v_feedback jsonb := '{}'::jsonb;
  v_repeat jsonb := '{}'::jsonb;
begin
  select * into v_art
  from agent_lab.expertise_artifacts
  where agent_id=p_agent_id
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'version','expertise_portfolio_context_v0_2',
      'active',false,
      'reason','no_expertise_artifact'
    );
  end if;

  v_gate := agent_lab.evaluate_expertise_portfolio_gate_v0_2(
    p_agent_id,v_art.expertise_artifact_id
  );
  v_repeat := agent_lab.evaluate_expertise_reverification_evidence_v0_1(
    p_agent_id,v_art.expertise_artifact_id
  );

  select coalesce(
    a.outcome #> '{runtime_feedback,expertise_verification}',
    '{}'::jsonb
  )
  into v_feedback
  from agent_lab.activity_log a
  where a.agent_id=p_agent_id
    and a.outcome #> '{runtime_feedback,expertise_verification}' is not null
  order by a.created_at desc
  limit 1;

  v_feedback := coalesce(v_feedback,'{}'::jsonb);

  select coalesce(jsonb_agg(jsonb_build_object(
    'portfolio_artifact_id',p.portfolio_artifact_id,
    'competency',p.competency,
    'artifact_type',p.artifact_type,
    'title',p.title,
    'source_file_id',p.source_file_id,
    'admission_status',p.admission_status,
    'original_work',p.original_work,
    'execution_spec',p.execution_spec,
    'tests',p.test_manifest,
    'metrics',p.metrics,
    'admission_reasons',p.admission_reasons,
    'admitted_at',p.admitted_at,
    'created_at',p.created_at
  ) order by p.created_at desc),'[]'::jsonb)
  into v_items
  from agent_lab.expertise_portfolio_artifacts p
  where p.agent_id=p_agent_id
    and p.expertise_artifact_id=v_art.expertise_artifact_id;

  return jsonb_build_object(
    'version','expertise_portfolio_context_v0_2',
    'active',true,
    'expertise_artifact_id',v_art.expertise_artifact_id,
    'domain',v_art.domain,
    'contract_version',coalesce(
      v_art.metadata->>'portfolio_contract_version',
      'expertise_portfolio_v0_1_legacy'
    ),
    'definitions',jsonb_build_object(
      'learning_material','Study notes, summaries, and research sessions. These do not count as portfolio artifacts.',
      'supporting_analysis','Technical reports describing behavior, methods, results, and failure modes. These support evidence but are not implementations.',
      'evidence','Persisted measurable practice, benchmark, implementation, or independent-assessment records.',
      'portfolio_artifact','An admitted original implementation with a source file, reproducibility instructions, tests, metrics, provenance, and competency mapping.'
    ),
    'submission_contract',jsonb_build_object(
      'origin','expertise_portfolio_submission_v0_2',
      'required_fields',jsonb_build_array(
        'filename','title','competency','artifact_type',
        'original_work','execution_spec','tests','metrics'
      ),
      'artifact_type_required','implementation',
      'same_cognition_file_requirement','The filename must refer to an agent_file_output_v0_1 file created in the same cognition.',
      'code_file_extensions',jsonb_build_array('.py','.js','.ts','.sql','.json','.csv')
    ),
    'completion_rule','Do not describe the portfolio as complete unless gate.ready_for_verification is true. Reports alone never satisfy portfolio coverage under v0.2.',
    'verification_request_allowed',
      coalesce((v_gate->>'ready_for_verification')::boolean,false)
      and coalesce((v_repeat->>'ready_for_new_verification')::boolean,false),
    'repeat_verification_gate',v_repeat,
    'last_verification_request_feedback',v_feedback,
    'artifacts',v_items,
    'gate',v_gate
  );
end
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
     'capability_result_system_contract',
     'recent_capability_results is authoritative runtime feedback. If an inspection capability is COMPLETED, its result is available now and must not be described as pending. Use completed evidence before repeating the same inspection.',
     'evidence_first_cognition_contract',v_contract,
     'evidence_first_system_contract',
     'Intention is not execution, execution is not independent verification. Use evidence_first_cognition_contract before making progress claims or selecting another external action. Never claim a gate passed without the latest authoritative verdict.'
   )
 );
end;
$function$

