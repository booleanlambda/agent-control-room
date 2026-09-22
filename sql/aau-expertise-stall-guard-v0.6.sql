-- AAU v0.6: bounded expertise-verification stall detection.
create or replace function agent_lab.expertise_verification_stall_evidence_v0_1(p_agent_id uuid)
returns jsonb language plpgsql stable set search_path to 'pg_catalog','agent_lab'
as $$
declare
  v_art uuid;
  v_gate jsonb;
  v_stage text;
  v_n integer:=0;
  v_stalls integer:=0;
  v_recent jsonb:='[]'::jsonb;
  v_failed_at timestamptz;
  v_pending boolean:=false;
begin
  select current_stage into v_stage from agent_lab.mandatory_lifecycle_states where agent_id=p_agent_id;
  if v_stage is distinct from 'expertise_development' then
    return jsonb_build_object('stalled',false,'reason','different_lifecycle_stage');
  end if;
  select expertise_artifact_id into v_art from agent_lab.expertise_artifacts
   where agent_id=p_agent_id order by created_at desc limit 1;
  if v_art is null then return jsonb_build_object('stalled',false,'reason','no_expertise_artifact'); end if;
  v_gate:=agent_lab.evaluate_expertise_reverification_evidence_v0_1(p_agent_id,v_art);
  v_failed_at:=nullif(v_gate->>'last_failed_at','')::timestamptz;
  if v_failed_at is null or coalesce((v_gate->>'ready_for_new_verification')::boolean,false) then
    return jsonb_build_object('stalled',false,'reason','no_pending_remediation_requirement','gate',v_gate);
  end if;
  select exists(select 1 from agent_lab.expertise_verification_runs r
    where r.agent_id=p_agent_id and r.expertise_artifact_id=v_art
      and r.status in ('pending','claimed','running','awaiting_thesis','manual_required')
  ) into v_pending;
  if v_pending then return jsonb_build_object('stalled',false,'reason','verification_actually_pending','gate',v_gate); end if;

  with recent as (
    select a.activity_id,a.created_at,a.selected_action,a.stated_reason,a.outcome,a.input_payload
    from agent_lab.activity_log a
    where a.agent_id=p_agent_id and a.event_type='autonomous_wake' and a.created_at>v_failed_at
    order by a.created_at desc,a.activity_id desc limit 2
  ), tagged as (
    select r.*,case
      when r.selected_action in ('request_expertise_verification','request_independent_verification_of_artifact','request_independent_assessment')
        and r.outcome #>> '{runtime_feedback,expertise_verification,status}'='blocked'
        and r.outcome #>> '{runtime_feedback,expertise_verification,reason}'='expertise_reverification_evidence_required'
        then 'blocked_request'
      when r.selected_action in ('nothing_is_valid_action','do_nothing')
        and coalesce(r.stated_reason,'') ~* '(await|wait).*verif'
        and jsonb_array_length(case when jsonb_typeof(r.outcome->'associations')='array'
          then r.outcome->'associations' else '[]'::jsonb end)=0
        then 'waiting_without_exam'
      else 'progress_or_other' end as classification
    from recent r
  )
  select count(*),count(*) filter(where classification in ('blocked_request','waiting_without_exam')),
    coalesce(jsonb_agg(jsonb_build_object('activity_id',activity_id,'at',created_at,
      'action',selected_action,'classification',classification,
      'wake_request_id',input_payload->>'wake_request_id') order by created_at desc),'[]'::jsonb)
  into v_n,v_stalls,v_recent from tagged;
  return jsonb_build_object('version','expertise_verification_stall_v0_1',
    'stalled',v_n=2 and v_stalls=2,
    'reason',case when v_n=2 and v_stalls=2 then 'two_consecutive_blocked_or_false_pending_wakes'
      else 'insufficient_consecutive_stall_evidence' end,
    'latest_failed_run_id',v_gate->>'last_failed_run_id',
    'current_gate',v_gate,'recent',v_recent,'no_active_exam',true);
end;
$$;

create or replace function agent_lab.maybe_pause_expertise_verification_stall_v0_1(
  p_agent_id uuid,p_completed_wake_request_id uuid
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','agent_lab','public'
as $$
declare
  v_evidence jsonb;
  v_alert_id uuid;
  v_pause jsonb;
  v_art uuid;
  v_current_status text;
begin
  select status into v_current_status from agent_lab.autonomous_lifecycle_runs where agent_id=p_agent_id;
  if v_current_status in ('paused','archived') or v_current_status is null then
    return jsonb_build_object('status','skipped','reason','already_paused_or_absent');
  end if;
  v_evidence:=agent_lab.expertise_verification_stall_evidence_v0_1(p_agent_id);
  if not coalesce((v_evidence->>'stalled')::boolean,false) then
    return jsonb_build_object('status','not_stalled','evidence',v_evidence);
  end if;
  select expertise_artifact_id into v_art from agent_lab.expertise_artifacts
    where agent_id=p_agent_id order by created_at desc limit 1;
  insert into agent_lab.operator_alerts(
    agent_id,alert_type,severity,title,detail,source_ref,status,last_seen_at,resolved_at,metadata
  ) values (
    p_agent_id,'expertise_verification_no_progress','high',
    'Expertise development needs administrator attention',
    'Two consecutive wakes produced a blocked verification request or waited for an exam that does not exist. No new qualifying practice or admitted implementation. Agent and levy paused.',
    'expertise_reverification:'||v_art::text,'open',now(),null,
    jsonb_build_object('scanner','expertise_verification_stall_v0_1','alert_class','agent_development',
      'source_wake_request_id',p_completed_wake_request_id,'evidence',v_evidence,
      'requires_operator_review',true)
  )
  on conflict(agent_id,alert_type,source_ref) do update
    set severity='high',status='open',last_seen_at=now(),resolved_at=null,
      occurrences=agent_lab.operator_alerts.occurrences+1,
      metadata=excluded.metadata
  returning alert_id into v_alert_id;
  v_pause:=public.aau_control_room_admin_pause(
    p_agent_id,'expertise_verification_no_progress:operator_attention_required'
  );
  return jsonb_build_object('status','paused_for_operator_review',
    'alert_id',v_alert_id,'pause',v_pause,'evidence',v_evidence);
end;
$$;
revoke all on function agent_lab.maybe_pause_expertise_verification_stall_v0_1(uuid,uuid) from public,anon,authenticated;
