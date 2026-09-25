-- AAU deep cognition checkpoint v0.3 universal-cycle replacement
-- A new independent assessment/revision invalidates reuse of an earlier work artifact.
-- Bound-model, running-wake and authoritative-current-unit guards remain unchanged.
begin;
CREATE OR REPLACE FUNCTION public.aau_bridge_deep_cognition_checkpoint(p_bridge_token text, p_agent_id uuid, p_wake_request_id uuid, p_unit_id uuid, p_model text, p_action text, p_artifact text DEFAULT NULL::text, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_bound text;
  v_stage text;
  v_progress jsonb;
  v_unit_id uuid;
  v_units integer;
  v_courses integer;
  v_attempt integer:=0;
  v_unit_status text;
  v_assessed_at timestamptz;
  v_feedback_hash text:='none';
  v_key text;
  v_hash text;
  v_existing agent_lab.deep_cognition_checkpoints%rowtype;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  if p_action not in ('get','save') then
    raise exception 'invalid_deep_checkpoint_action';
  end if;
  if not exists (
    select 1 from agent_lab.wake_queue w
    where w.agent_id=p_agent_id and w.wake_request_id=p_wake_request_id
      and w.status in ('running','claimed')
  ) then
    raise exception 'deep_checkpoint_wake_not_running';
  end if;
  select a.primary_model_id into v_bound from agent_lab.agents a where a.agent_id=p_agent_id;
  if v_bound is null or v_bound is distinct from p_model then
    raise exception 'deep_checkpoint_bound_model_mismatch';
  end if;
  v_stage:=agent_lab.current_mandatory_lifecycle_stage(p_agent_id);
  if v_stage <> 'mba_entrepreneurship' then
    raise exception 'deep_checkpoint_not_supported_for_stage';
  end if;
  v_progress:=agent_lab.entrepreneurship_program_progress_v0_1(p_agent_id);
  v_unit_id:=nullif(v_progress#>>'{next_unit,unit_id}','')::uuid;
  if v_unit_id is null or v_unit_id is distinct from p_unit_id
     or (v_progress->>'next_kind') not in ('study_unit','course_remediation') then
    raise exception 'deep_checkpoint_assignment_mismatch';
  end if;
  v_units:=coalesce((v_progress->>'units_submitted')::integer,0);
  v_courses:=coalesce((v_progress->>'courses_passed')::integer,0);
  select coalesce(up.attempt_count,0),up.status,up.assessed_at,
         case when up.assessment_report is null or up.assessment_report='{}'::jsonb then 'none'
              else left(encode(extensions.digest(up.assessment_report::text,'sha256'),'hex'),16) end
    into v_attempt,v_unit_status,v_assessed_at,v_feedback_hash
  from agent_lab.entrepreneurship_unit_progress up
  where up.agent_id=p_agent_id and up.unit_id=v_unit_id;
  if not found then
    v_attempt:=0;v_unit_status:='not_started';v_assessed_at:=null;v_feedback_hash:='none';
  end if;
  -- A failed assessment is a new cognition revision. The feedback fingerprint
  -- prevents reuse of the exact artifact that the independent assessor rejected.
  v_key:=concat_ws(':','mba',v_unit_id::text,
    'u'||v_units::text,'c'||v_courses::text,'a'||v_attempt::text,
    's'||coalesce(v_unit_status,'not_started'),'f'||coalesce(v_feedback_hash,'none'));
  if p_action='save' then
    if p_artifact is null or octet_length(p_artifact) not between 30 and 100000 then
      raise exception 'deep_checkpoint_invalid_artifact';
    end if;
    if p_meta is null or jsonb_typeof(p_meta)<>'object' or octet_length(p_meta::text)>15000 then
      raise exception 'deep_checkpoint_invalid_metadata';
    end if;
    v_hash:=encode(extensions.digest(p_artifact,'sha256'),'hex');
    insert into agent_lab.deep_cognition_checkpoints (
      agent_id,assignment_key,model_id,unit_id,units_submitted,courses_passed,
      artifact,artifact_hash,cognitive_metadata,source_wake_request_id
    ) values (
      p_agent_id,v_key,p_model,v_unit_id,v_units,v_courses,
      p_artifact,v_hash,p_meta,p_wake_request_id
    )
    on conflict (agent_id,assignment_key,model_id)
    do update set
      artifact=excluded.artifact,artifact_hash=excluded.artifact_hash,
      cognitive_metadata=excluded.cognitive_metadata,source_wake_request_id=excluded.source_wake_request_id,
      created_at=now()
    where agent_lab.deep_cognition_checkpoints.created_at < now()-interval '24 hours'
       or coalesce(agent_lab.deep_cognition_checkpoints.cognitive_metadata->>'contract','') not like '%universal_cognition_cycle_v0_1%';
  end if;
  select * into v_existing
    from agent_lab.deep_cognition_checkpoints c
    where c.agent_id=p_agent_id and c.assignment_key=v_key and c.model_id=p_model
      and c.created_at >= now()-interval '24 hours';
  if not found then
    return jsonb_build_object('status','not_found','assignment_key',v_key);
  end if;
  if encode(extensions.digest(v_existing.artifact,'sha256'),'hex') is distinct from v_existing.artifact_hash then
    raise exception 'deep_checkpoint_hash_mismatch';
  end if;
  return jsonb_build_object(
    'status','ready','version','deep_cognition_checkpoint_v0_3_universal_cycle',
    'checkpoint_id',v_existing.checkpoint_id,
    'assignment_key',v_key,
    'source_wake_request_id',v_existing.source_wake_request_id,
    'model',v_existing.model_id,
    'artifact',v_existing.artifact,
    'artifact_hash',v_existing.artifact_hash,
    'meta',v_existing.cognitive_metadata,
    'created_at',v_existing.created_at,
    'unit_attempt_count',v_attempt,
    'unit_status',v_unit_status,
    'assessment_feedback_hash',v_feedback_hash,
    'assessed_at',v_assessed_at
  );
end;
$function$
;
commit;
