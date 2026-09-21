-- AAU Persistent Expertise Memory v0.1
-- Applied live 2026-09-21.
-- Future verification runs freeze a competence packet before unseen tasks.
-- Existing/running verification rows are not retroactively flagged.

begin;

create table if not exists agent_lab.expertise_knowledge_units (
  knowledge_unit_id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agent_lab.agents(agent_id) on delete cascade,
  expertise_artifact_id uuid not null references agent_lab.expertise_artifacts(expertise_artifact_id) on delete cascade,
  track_id uuid references agent_lab.domain_learning_tracks(track_id) on delete set null,
  competency text not null,
  title text not null,
  claim text not null,
  assumptions jsonb not null default '[]'::jsonb,
  invalidation_conditions jsonb not null default '[]'::jsonb,
  source_manifest jsonb not null default '[]'::jsonb,
  evidence_status text not null check (evidence_status in ('supported','qualified')),
  confidence numeric not null default 0.5 check (confidence >= 0 and confidence <= 1),
  provenance_status text not null default 'retrieved_source_receipts_verified',
  source_activity_id uuid,
  claim_sha256 text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(agent_id, expertise_artifact_id, competency, claim_sha256)
);

create index if not exists expertise_knowledge_units_agent_artifact_idx
  on agent_lab.expertise_knowledge_units(agent_id, expertise_artifact_id, competency, active);

alter table agent_lab.expertise_knowledge_units enable row level security;
revoke all on agent_lab.expertise_knowledge_units from public, anon, authenticated;

create table if not exists agent_lab.expertise_competence_packets (
  competence_packet_id uuid primary key default gen_random_uuid(),
  verification_run_id uuid not null unique references agent_lab.expertise_verification_runs(verification_run_id) on delete cascade,
  agent_id uuid not null references agent_lab.agents(agent_id) on delete cascade,
  expertise_artifact_id uuid not null references agent_lab.expertise_artifacts(expertise_artifact_id) on delete cascade,
  packet_version text not null default 'expertise_competence_packet_v0_1',
  packet_sha256 text not null,
  packet jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists expertise_competence_packets_agent_idx
  on agent_lab.expertise_competence_packets(agent_id, expertise_artifact_id, created_at desc);

alter table agent_lab.expertise_competence_packets enable row level security;
revoke all on agent_lab.expertise_competence_packets from public, anon, authenticated;

CREATE OR REPLACE FUNCTION agent_lab.build_domain_learning_context_v0_2(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_policy agent_lab.domain_learning_policies%rowtype;
  v_artifact agent_lab.expertise_artifacts%rowtype;
  v_track agent_lab.domain_learning_tracks%rowtype;
  v_learning int:=0; v_practice int:=0; v_assess int:=0; v_independent int:=0; v_evidence int:=0;
  v_min_assess int:=3; v_min_independent int:=2; v_min_learning int:=1; v_min_practice int:=1; v_entry_learning int:=1;
  v_verification_ready boolean:=false; v_completion_evidence_ready boolean:=false; v_master_verified boolean:=false;
  v_units jsonb:='[]'::jsonb;
begin
  select * into v_policy from agent_lab.domain_learning_policies where policy_version='domain_learning_v0_2';
  if found then
    v_min_assess:=coalesce((v_policy.config->>'minimum_assessment_evidence')::int,3);
    v_min_independent:=coalesce((v_policy.config->>'minimum_independent_assessments')::int,2);
    v_min_learning:=coalesce((v_policy.config->>'minimum_learning_episodes')::int,1);
    v_min_practice:=coalesce((v_policy.config->>'minimum_practice_attempts')::int,1);
    v_entry_learning:=coalesce((v_policy.config->>'verification_entry_learning_episodes')::int,1);
  end if;

  select * into v_artifact
  from agent_lab.expertise_artifacts
  where agent_id=p_agent_id and status in ('initiated','accepted_for_development')
  order by created_at desc limit 1;

  if not found then
    return jsonb_build_object(
      'version','domain_learning_context_v0_4',
      'policy_version','domain_learning_v0_2',
      'policy_active',coalesce(v_policy.status='active',false),
      'track_exists',false,
      'stage','awaiting_expertise_artifact',
      'minimum_expertise_equivalence','masters_equivalent',
      'expertise_memory_contract','persistent_expertise_memory_v0_1'
    );
  end if;

  select * into v_track
  from agent_lab.domain_learning_tracks
  where agent_id=p_agent_id and lower(domain)=lower(v_artifact.domain)
  order by created_at desc limit 1;

  if found then
    select count(*) into v_learning from agent_lab.domain_learning_episodes where track_id=v_track.track_id;
    select count(*) into v_practice from agent_lab.domain_practice_attempts where track_id=v_track.track_id;
    select count(*) into v_assess from agent_lab.domain_assessment_results where track_id=v_track.track_id;
    select count(*) into v_independent from agent_lab.domain_assessment_results
      where track_id=v_track.track_id and evaluator_type in ('independent_model','deterministic_test','human','client','peer_agent','hybrid');
    select count(*) into v_evidence from agent_lab.domain_expertise_evidence where track_id=v_track.track_id;

    select coalesce(jsonb_agg(x.item order by x.updated_at desc),'[]'::jsonb)
    into v_units
    from (
      select jsonb_build_object(
        'knowledge_unit_id',k.knowledge_unit_id,
        'competency',k.competency,
        'title',k.title,
        'claim',k.claim,
        'assumptions',k.assumptions,
        'invalidation_conditions',k.invalidation_conditions,
        'source_manifest',k.source_manifest,
        'evidence_status',k.evidence_status,
        'confidence',k.confidence,
        'provenance_status',k.provenance_status,
        'updated_at',k.updated_at
      ) as item,k.updated_at
      from agent_lab.expertise_knowledge_units k
      where k.agent_id=p_agent_id
        and k.expertise_artifact_id=v_artifact.expertise_artifact_id
        and k.active=true
      order by k.updated_at desc
      limit 24
    ) x;
  end if;

  v_verification_ready:=v_track.track_id is not null and v_learning>=v_entry_learning;
  v_completion_evidence_ready:=v_track.track_id is not null and v_learning>=v_min_learning and v_practice>=v_min_practice and v_assess>=v_min_assess and v_independent>=v_min_independent;
  v_master_verified:=exists(
    select 1 from agent_lab.expertise_verification_runs r
    where r.agent_id=p_agent_id and r.expertise_artifact_id=v_artifact.expertise_artifact_id and r.status='verified_pass'
      and coalesce(r.final_report->>'academic_equivalence_level','')='masters_equivalent'
      and coalesce(r.metadata->>'authenticator_policy_version','')='expertise_authenticator_v0_2'
  );

  return jsonb_build_object(
    'version','domain_learning_context_v0_4',
    'policy_version','domain_learning_v0_2',
    'policy_title',v_policy.title,
    'policy_active',coalesce(v_policy.status='active' and v_policy.activation_allowed,false),
    'principle',v_policy.config->>'principle',
    'autonomy_rule',v_policy.config->>'autonomy_rule',
    'minimum_expertise_equivalence','masters_equivalent',
    'equivalence_is_not_academic_credential',true,
    'artifact',jsonb_build_object(
      'expertise_artifact_id',v_artifact.expertise_artifact_id,
      'domain',v_artifact.domain,
      'target_standard',v_artifact.target_standard,
      'competencies',v_artifact.competencies
    ),
    'track',case when v_track.track_id is null then null else jsonb_build_object(
      'track_id',v_track.track_id,'status',v_track.status,'origin',v_track.origin
    ) end,
    'progress',jsonb_build_object(
      'learning_episodes',v_learning,
      'practice_attempts',v_practice,
      'assessment_results',v_assess,
      'independent_assessments',v_independent,
      'expertise_evidence',v_evidence,
      'validated_knowledge_units',jsonb_array_length(v_units)
    ),
    'validated_knowledge_units',v_units,
    'expertise_memory_contract',jsonb_build_object(
      'version','persistent_expertise_memory_v0_1',
      'promotion_rule','Only provenance-backed research synthesis admitted through expertise_knowledge_unit_v0_1 is persistent trusted expertise memory.',
      'application_rule','Use relevant units in future cognition, but preserve their assumptions, invalidation conditions, evidence status, and confidence.',
      'exclusions','Parametric-only claims, empty-source study notes, prior challenge answers, answer keys, and verifier grading prose are excluded.'
    ),
    'verification_entry',jsonb_build_object(
      'required_learning_episodes',v_entry_learning,
      'ready',v_verification_ready,
      'rule','At least one persisted study/learning episode is required before requesting the hidden benchmark.'
    ),
    'completion_minimums',jsonb_build_object(
      'learning_episodes',v_min_learning,
      'practice_attempts',v_min_practice,
      'assessment_evidence',v_min_assess,
      'independent_assessments',v_min_independent,
      'minimum_academic_equivalence','masters_equivalent'
    ),
    'completion_evidence_ready',v_completion_evidence_ready,
    'masters_equivalent_verified',v_master_verified,
    'verification_ready',v_verification_ready,
    'study_session_contract',jsonb_build_object(
      'memory_type','study_session',
      'required_memory_fields',jsonb_build_array('memory_type','topic'),
      'optional_fields',jsonb_build_array('source_manifest','result_summary')
    ),
    'grounding_rule','Only persisted study episodes, executed benchmark/practice attempts, independent assessment results, provenance-bearing evidence, and admitted expertise knowledge units count. Narrative claims, imagined simulations, invented telemetry, or unsupported self-authored conclusions do not become trusted expertise.',
    'development_rule','Choose the domain and next learning action yourself. Research and practice identified gaps, promote only receipt-backed learning into expertise memory, then request independent verification when ready. A verified_pass requires at least Master''s-equivalent competence under runtime-owned thresholds.',
    'credential_rule','Master''s-equivalent describes verified competence. It is not an academic degree or credential.',
    'recognition_rule','Every successful verified expertise receives a durable AAU Universe recognition badge linked to its verification run.'
  );
end
$function$;

CREATE OR REPLACE FUNCTION agent_lab.build_expertise_competence_packet_v0_1(p_agent_id uuid, p_expertise_artifact_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_art agent_lab.expertise_artifacts%rowtype;
  v_track uuid;
  v_knowledge jsonb := '[]'::jsonb;
  v_portfolio jsonb := '[]'::jsonb;
  v_practice jsonb := '[]'::jsonb;
  v_assess jsonb := '[]'::jsonb;
  v_gaps jsonb := '[]'::jsonb;
begin
  select * into v_art
  from agent_lab.expertise_artifacts x
  where x.expertise_artifact_id=p_expertise_artifact_id
    and x.agent_id=p_agent_id;
  if not found then raise exception 'expertise_artifact_not_found'; end if;

  select t.track_id into v_track
  from agent_lab.domain_learning_tracks t
  where t.agent_id=p_agent_id
    and t.metadata->>'expertise_artifact_id'=p_expertise_artifact_id::text
  order by t.created_at desc limit 1;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'knowledge_unit_id',k.knowledge_unit_id,
      'competency',k.competency,
      'title',k.title,
      'claim',k.claim,
      'assumptions',k.assumptions,
      'invalidation_conditions',k.invalidation_conditions,
      'source_manifest',k.source_manifest,
      'evidence_status',k.evidence_status,
      'confidence',k.confidence,
      'provenance_status',k.provenance_status,
      'updated_at',k.updated_at
    ) order by k.competency,k.confidence desc,k.updated_at desc
  ),'[]'::jsonb)
  into v_knowledge
  from agent_lab.expertise_knowledge_units k
  where k.agent_id=p_agent_id
    and k.expertise_artifact_id=p_expertise_artifact_id
    and k.active=true;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'portfolio_artifact_id',p.portfolio_artifact_id,
      'competency',p.competency,
      'title',p.title,
      'artifact_type',p.artifact_type,
      'original_work',p.original_work,
      'execution_spec',p.execution_spec,
      'test_manifest',p.test_manifest,
      'metrics',p.metrics,
      'admission_status',p.admission_status,
      'independently_verified',coalesce((p.metadata->>'independently_verified')::boolean,false),
      'admitted_at',p.admitted_at
    ) order by p.competency,p.admitted_at desc
  ),'[]'::jsonb)
  into v_portfolio
  from agent_lab.expertise_portfolio_artifacts p
  where p.agent_id=p_agent_id
    and p.expertise_artifact_id=p_expertise_artifact_id
    and p.admission_status='admitted'
    and p.original_work=true;

  if v_track is not null then
    select coalesce(jsonb_agg(x.item order by x.attempted_at desc),'[]'::jsonb)
    into v_practice
    from (
      select jsonb_build_object(
        'practice_id',p.practice_id,
        'skill_component',p.skill_component,
        'task_type',p.task_type,
        'difficulty',p.difficulty,
        'outcome_score',p.outcome_score,
        'evaluator_ref',p.evaluator_ref,
        'error_profile',p.error_profile,
        'attempted_at',p.attempted_at
      ) as item,p.attempted_at
      from agent_lab.domain_practice_attempts p
      where p.track_id=v_track
        and p.agent_id=p_agent_id
        and p.independently_evaluated=true
      order by p.attempted_at desc
      limit 20
    ) x;

    select coalesce(jsonb_agg(x.item order by x.assessed_at desc),'[]'::jsonb)
    into v_assess
    from (
      select jsonb_build_object(
        'assessment_id',a.assessment_id,
        'skill_component',a.skill_component,
        'assessment_type',a.assessment_type,
        'difficulty',a.difficulty,
        'score',a.score,
        'passed',a.passed,
        'evaluator_type',a.evaluator_type,
        'evaluator_ref',a.evaluator_ref,
        'reliability_weight',a.reliability_weight,
        'assessed_at',a.assessed_at
      ) as item,a.assessed_at
      from agent_lab.domain_assessment_results a
      where a.track_id=v_track
        and a.agent_id=p_agent_id
        and lower(coalesce(a.evaluator_type,'')) not in ('self','self_authored','agent')
      order by a.assessed_at desc
      limit 24
    ) x;

    select coalesce(jsonb_agg(x.item order by x.importance desc,x.opened_at desc),'[]'::jsonb)
    into v_gaps
    from (
      select jsonb_build_object(
        'gap_id',g.gap_id,
        'topic',g.topic,
        'gap_type',g.gap_type,
        'detection_source',g.detection_source,
        'importance',g.importance,
        'status',g.status,
        'opened_at',g.opened_at,
        'resolved_at',g.resolved_at
      ) as item,g.importance,g.opened_at
      from agent_lab.domain_knowledge_gaps g
      where g.track_id=v_track and g.agent_id=p_agent_id
      order by g.importance desc,g.opened_at desc
      limit 20
    ) x;
  end if;

  return jsonb_build_object(
    'packet_version','expertise_competence_packet_v0_1',
    'agent_id',p_agent_id,
    'expertise_artifact_id',p_expertise_artifact_id,
    'domain',v_art.domain,
    'target_standard',v_art.target_standard,
    'competencies',v_art.competencies,
    'validated_knowledge_units',v_knowledge,
    'admitted_original_implementations',v_portfolio,
    'independently_evaluated_practice',v_practice,
    'independent_assessment_summary',v_assess,
    'knowledge_gap_summary',v_gaps,
    'epistemic_boundary',jsonb_build_object(
      'knowledge_units','Only units whose source URLs and hashes were matched to fetched AAU research receipts are included. Their synthesis is agent-authored and remains subject to fresh-task verification.',
      'portfolio','Admitted original implementations show work performed; admission alone is not independent correctness verification.',
      'assessments','Only summary fields are included. Prior challenge prompts, candidate answers, and answer keys are excluded.',
      'test_isolation','Fresh verification challenges are not present in this packet.'
    )
  );
end
$function$;

CREATE OR REPLACE FUNCTION agent_lab.mark_new_expertise_verification_competence_packet_v0_1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
begin
  new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
    'competence_packet_required',true,
    'competence_packet_version','expertise_competence_packet_v0_1',
    'candidate_memory_contract','persistent_expertise_retrieval_v0_1'
  );
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.aau_bridge_get_or_create_expertise_competence_packet(p_bridge_token text, p_verification_run_id uuid, p_agent_id uuid, p_expertise_artifact_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab', 'extensions'
AS $function$
declare
  v_existing agent_lab.expertise_competence_packets%rowtype;
  v_packet jsonb;
  v_hash text;
  v_id uuid;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select * into v_existing
  from agent_lab.expertise_competence_packets c
  where c.verification_run_id=p_verification_run_id;

  if found then
    return jsonb_build_object(
      'status','existing',
      'competence_packet_id',v_existing.competence_packet_id,
      'packet_version',v_existing.packet_version,
      'packet_sha256',v_existing.packet_sha256,
      'packet',v_existing.packet
    );
  end if;

  if not exists (
    select 1 from agent_lab.expertise_verification_runs r
    where r.verification_run_id=p_verification_run_id
      and r.agent_id=p_agent_id
      and r.expertise_artifact_id=p_expertise_artifact_id
  ) then
    raise exception 'verification_run_identity_mismatch';
  end if;

  v_packet := agent_lab.build_expertise_competence_packet_v0_1(p_agent_id,p_expertise_artifact_id);
  v_hash := encode(extensions.digest(convert_to(v_packet::text,'UTF8'),'sha256'),'hex');

  insert into agent_lab.expertise_competence_packets(
    verification_run_id,agent_id,expertise_artifact_id,packet_version,packet_sha256,packet
  )
  values(
    p_verification_run_id,p_agent_id,p_expertise_artifact_id,
    'expertise_competence_packet_v0_1',v_hash,v_packet
  )
  returning competence_packet_id into v_id;

  return jsonb_build_object(
    'status','created',
    'competence_packet_id',v_id,
    'packet_version','expertise_competence_packet_v0_1',
    'packet_sha256',v_hash,
    'packet',v_packet
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.aau_bridge_submit_expertise_knowledge_unit(p_bridge_token text, p_agent_id uuid, p_source_activity_id uuid, p_unit jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab', 'extensions'
AS $function$
declare
  v_art agent_lab.expertise_artifacts%rowtype;
  v_track uuid;
  v_comp text := nullif(trim(coalesce(p_unit->>'competency','')),'');
  v_title text := nullif(trim(coalesce(p_unit->>'title','')),'');
  v_claim text := nullif(trim(coalesce(p_unit->>'claim','')),'');
  v_status text := lower(trim(coalesce(p_unit->>'evidence_status','')));
  v_manifest jsonb := case when jsonb_typeof(p_unit->'source_manifest')='array' then p_unit->'source_manifest' else '[]'::jsonb end;
  v_assumptions jsonb := case when jsonb_typeof(p_unit->'assumptions')='array' then p_unit->'assumptions' else '[]'::jsonb end;
  v_invalid jsonb := case when jsonb_typeof(p_unit->'invalidation_conditions')='array' then p_unit->'invalidation_conditions' else '[]'::jsonb end;
  v_conf numeric := greatest(0, least(1, coalesce(nullif(p_unit->>'confidence','')::numeric,0.5)));
  v_hash text;
  v_id uuid;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  if p_agent_id is null then raise exception 'agent_id_required'; end if;
  if v_comp is null or v_title is null or v_claim is null then
    raise exception 'knowledge_unit_competency_title_claim_required';
  end if;
  if v_status not in ('supported','qualified') then
    raise exception 'knowledge_unit_evidence_status_invalid';
  end if;
  if jsonb_array_length(v_manifest)=0 then
    raise exception 'knowledge_unit_source_manifest_required';
  end if;

  select * into v_art
  from agent_lab.expertise_artifacts x
  where x.agent_id=p_agent_id
    and x.status in ('initiated','accepted_for_development')
  order by x.created_at desc
  limit 1;
  if not found then raise exception 'eligible_expertise_artifact_not_found'; end if;

  if not exists (
    select 1
    from jsonb_array_elements(v_art.competencies) c
    where lower(trim(c#>>'{}'))=lower(v_comp)
  ) then
    raise exception 'knowledge_unit_competency_not_in_artifact:%',v_comp;
  end if;

  -- Every claimed source must correspond to a genuinely fetched research receipt
  -- for this agent. A remembered URL or search snippet is not enough.
  if exists (
    select 1
    from jsonb_array_elements(v_manifest) s
    where nullif(trim(coalesce(s->>'url','')),'') is null
       or not exists (
         select 1
         from agent_lab.agent_web_research_batches b
         cross join lateral jsonb_array_elements(coalesce(b.receipts,'[]'::jsonb)) r
         where b.agent_id=p_agent_id
           and r->>'url'=s->>'url'
           and r->>'fetch_status'='fetched_text'
           and (
             nullif(trim(coalesce(s->>'sha256','')),'') is null
             or r->>'sha256'=s->>'sha256'
           )
       )
  ) then
    raise exception 'knowledge_unit_source_not_backed_by_fetched_receipt';
  end if;

  select t.track_id into v_track
  from agent_lab.domain_learning_tracks t
  where t.agent_id=p_agent_id
    and t.metadata->>'expertise_artifact_id'=v_art.expertise_artifact_id::text
  order by t.created_at desc limit 1;

  v_hash := encode(extensions.digest(convert_to(v_claim,'UTF8'),'sha256'),'hex');

  insert into agent_lab.expertise_knowledge_units(
    agent_id,expertise_artifact_id,track_id,competency,title,claim,
    assumptions,invalidation_conditions,source_manifest,evidence_status,
    confidence,source_activity_id,claim_sha256,updated_at
  )
  values(
    p_agent_id,v_art.expertise_artifact_id,v_track,v_comp,left(v_title,500),left(v_claim,6000),
    v_assumptions,v_invalid,v_manifest,v_status,v_conf,p_source_activity_id,v_hash,now()
  )
  on conflict(agent_id,expertise_artifact_id,competency,claim_sha256)
  do update set
    title=excluded.title,
    assumptions=excluded.assumptions,
    invalidation_conditions=excluded.invalidation_conditions,
    source_manifest=excluded.source_manifest,
    evidence_status=excluded.evidence_status,
    confidence=excluded.confidence,
    source_activity_id=excluded.source_activity_id,
    active=true,
    updated_at=now()
  returning knowledge_unit_id into v_id;

  return jsonb_build_object(
    'status','accepted',
    'knowledge_unit_id',v_id,
    'expertise_artifact_id',v_art.expertise_artifact_id,
    'competency',v_comp,
    'claim_sha256',v_hash,
    'provenance_status','retrieved_source_receipts_verified'
  );
end
$function$;

revoke all on function public.aau_bridge_submit_expertise_knowledge_unit(text,uuid,uuid,jsonb) from public;
grant execute on function public.aau_bridge_submit_expertise_knowledge_unit(text,uuid,uuid,jsonb) to anon;

revoke all on function agent_lab.build_expertise_competence_packet_v0_1(uuid,uuid) from public, anon, authenticated;

revoke all on function public.aau_bridge_get_or_create_expertise_competence_packet(text,uuid,uuid,uuid) from public;
grant execute on function public.aau_bridge_get_or_create_expertise_competence_packet(text,uuid,uuid,uuid) to anon;

drop trigger if exists trg_mark_new_expertise_verification_competence_packet_v0_1
  on agent_lab.expertise_verification_runs;
create trigger trg_mark_new_expertise_verification_competence_packet_v0_1
before insert on agent_lab.expertise_verification_runs
for each row execute function agent_lab.mark_new_expertise_verification_competence_packet_v0_1();

commit;
