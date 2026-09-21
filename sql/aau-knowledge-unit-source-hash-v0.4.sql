-- Require exact URL + SHA-256 for every admitted expertise source.
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
       or nullif(trim(coalesce(s->>'sha256','')),'') is null
       or not exists (
         select 1
         from agent_lab.agent_web_research_batches b
         cross join lateral jsonb_array_elements(coalesce(b.receipts,'[]'::jsonb)) r
         where b.agent_id=p_agent_id
           and r->>'url'=s->>'url'
           and r->>'fetch_status'='fetched_text'
           and r->>'sha256'=s->>'sha256'
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
$function$
;
