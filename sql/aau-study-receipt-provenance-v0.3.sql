-- Only verified fetched URL+SHA research receipts contribute to persisted study source_count.
CREATE OR REPLACE FUNCTION agent_lab.capture_domain_learning_study_session_v0_1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_mem jsonb := coalesce(new.outcome->'memory','{}'::jsonb);
  v_updates jsonb := '[]'::jsonb;
  v_item jsonb;
  v_track agent_lab.domain_learning_tracks%rowtype;
  v_manifest jsonb;
  v_source_count int := 0;
  v_topic text;
  v_summary text;
begin
  if agent_lab.current_mandatory_lifecycle_stage(new.agent_id) <> 'expertise_development' then
    return new;
  end if;

  select * into v_track
  from agent_lab.domain_learning_tracks
  where agent_id=new.agent_id
    and status in ('exploring','developing','specializing','maintaining')
  order by updated_at desc,created_at desc
  limit 1;

  if not found then
    return new;
  end if;

  -- Backward compatibility: older runtime emitted memory_type directly under memory.
  if coalesce(v_mem->>'memory_type','')='study_session' then
    v_updates:=jsonb_build_array(v_mem);
  -- Current runtime emits one or more memory updates under memory.updates[].
  elsif jsonb_typeof(v_mem->'updates')='array' then
    v_updates:=v_mem->'updates';
  else
    return new;
  end if;

  for v_item in select value from jsonb_array_elements(v_updates) loop
    continue when coalesce(v_item->>'memory_type','') <> 'study_session';

    -- One canonical study episode per activity; retries/replays remain idempotent.
    if exists(
      select 1
      from agent_lab.domain_learning_episodes e
      where e.track_id=v_track.track_id
        and e.metadata->>'source_activity_id'=new.activity_id::text
    ) then
      return new;
    end if;

    v_manifest:=case
      when jsonb_typeof(v_item->'source_manifest')='array' then v_item->'source_manifest'
      else '[]'::jsonb
    end;
    -- A source is counted only if AAU actually fetched the same URL and SHA-256.
    -- This validates receipt provenance, not substantive support for the agent's claim.
    select coalesce(jsonb_agg(s.value),'[]'::jsonb)
    into v_manifest
    from jsonb_array_elements(v_manifest) s
    where nullif(trim(coalesce(s.value->>'url','')),'') is not null
      and nullif(trim(coalesce(s.value->>'sha256','')),'') is not null
      and exists (
        select 1
        from agent_lab.agent_web_research_batches b
        cross join lateral jsonb_array_elements(coalesce(b.receipts,'[]'::jsonb)) r
        where b.agent_id=new.agent_id
          and r->>'fetch_status'='fetched_text'
          and r->>'url'=s.value->>'url'
          and r->>'sha256'=s.value->>'sha256'
      );
    v_source_count:=jsonb_array_length(v_manifest);
    v_topic:=left(
      coalesce(
        nullif(trim(v_item->>'topic'),''),
        nullif(trim(new.selected_action),''),
        'unspecified study'
      ),1000
    );
    v_summary:=left(
      coalesce(
        nullif(trim(v_item->>'result_summary'),''),
        nullif(trim(v_item->>'content'),''),
        nullif(trim(new.stated_reason),''),
        'study session recorded'
      ),5000
    );

    insert into agent_lab.domain_learning_episodes(
      track_id,agent_id,episode_type,topic,source_count,evidence_quality,
      retrieval_success,compute_cost,duration_seconds,result_summary,
      source_manifest,metadata,completed_at
    )
    values(
      v_track.track_id,new.agent_id,'study',v_topic,v_source_count,0,
      case when v_source_count>0 then 1 else 0 end,
      greatest(0,coalesce((new.resource_cost->>'compute')::numeric,0)),
      0,v_summary,v_manifest,
      jsonb_build_object(
        'source_activity_id',new.activity_id,
        'capture_version','study_session_capture_v0_2',
        'memory_schema',
          case when coalesce(v_mem->>'memory_type','')='study_session'
               then 'memory_direct_v0_1'
               else 'memory_updates_v0_2' end,
        'evidence_quality_unscored',true,
        'agent_authored_summary_only',true
      ),
      new.created_at
    );

    update agent_lab.domain_learning_tracks
    set last_engaged_at=new.created_at,updated_at=now()
    where track_id=v_track.track_id;

    return new;
  end loop;

  return new;
exception when others then
  raise warning 'study_session_capture_failed agent=% activity=% error=%',
    new.agent_id,new.activity_id,sqlerrm;
  return new;
end;
$function$
;
