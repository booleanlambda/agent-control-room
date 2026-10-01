-- AAU cognitive self-remediation v0.2
-- Recovery is now two-stage: mechanical repair first, fresh cognition second,
-- verification only at the repair-specific evidence boundary.

begin;

alter table agent_lab.cognition_remediation_episodes
  drop constraint if exists cognition_remediation_episodes_repair_type_check;

alter table agent_lab.cognition_remediation_episodes
  add constraint cognition_remediation_episodes_repair_type_check
  check (repair_type in (
    'INVALIDATE_DISCOVERY_CHECKPOINT',
    'REFRESH_SIBING_EVIDENCE',
    'REFRESH_SIBLING_EVIDENCE',
    'REBUILD_SYNTHESIS_FROM_RESOLVED_EVIDENCE'
  ));

create or replace function public.aau_bridge_cognition_remediation_v0_1(
  p_bridge_token text,
  p_agent_id uuid,
  p_wake_request_id uuid,
  p_assignment_key text,
  p_node_path text,
  p_model text,
  p_action text,
  p_episode jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','agent_lab','extensions'
as $function$
declare
  v_bound text;
  v_id uuid;
  v_attempt integer;
  v_status text;
  v_repair_type text;
  v_row agent_lab.cognition_remediation_episodes%rowtype;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  if p_action not in ('list','create','update') then
    raise exception 'cognition_remediation_invalid_action';
  end if;
  if length(coalesce(p_assignment_key,'')) not between 1 and 240
     or p_node_path !~ '^R([.][0-9]{3}){0,16}$' then
    raise exception 'cognition_remediation_invalid_identity';
  end if;
  if not exists (
    select 1 from agent_lab.wake_queue w
    where w.agent_id=p_agent_id and w.wake_request_id=p_wake_request_id
      and w.status in ('running','claimed')
  ) then
    raise exception 'cognition_remediation_wake_not_running';
  end if;

  select primary_model_id into v_bound
  from agent_lab.agents where agent_id=p_agent_id;
  if v_bound is null or v_bound is distinct from p_model then
    raise exception 'cognition_remediation_bound_model_mismatch';
  end if;

  if p_action='list' then
    return jsonb_build_object(
      'status','ready',
      'version','cognitive_self_remediation_v0_2',
      'episodes',coalesce((
        select jsonb_agg(jsonb_build_object(
          'remediation_id',e.remediation_id,
          'attempt_no',e.attempt_no,
          'status',e.status,
          'observed_anomaly',e.observed_anomaly,
          'prior_belief',e.prior_belief,
          'contradicting_evidence',e.contradicting_evidence,
          'diagnosis',e.diagnosis,
          'repair_type',e.repair_type,
          'repair_payload',e.repair_payload,
          'verification_criterion',e.verification_criterion,
          'pre_state',e.pre_state,
          'post_state',e.post_state,
          'verification_result',e.verification_result,
          'created_at',e.created_at,
          'updated_at',e.updated_at
        ) order by e.attempt_no)
        from agent_lab.cognition_remediation_episodes e
        where e.agent_id=p_agent_id
          and e.assignment_key=p_assignment_key
          and e.node_path=p_node_path
          and e.model_id=p_model
      ),'[]'::jsonb)
    );
  end if;

  if p_episode is null or jsonb_typeof(p_episode)<>'object'
     or octet_length(p_episode::text)>24000 then
    raise exception 'cognition_remediation_invalid_payload';
  end if;

  if p_action='create' then
    v_attempt:=coalesce((p_episode->>'attempt_no')::integer,0);
    v_repair_type:=upper(coalesce(p_episode->>'repair_type',''));
    if v_attempt not between 1 and 2 then
      raise exception 'cognition_remediation_attempt_limit';
    end if;
    if v_repair_type not in (
      'INVALIDATE_DISCOVERY_CHECKPOINT',
      'REFRESH_SIBLING_EVIDENCE',
      'REBUILD_SYNTHESIS_FROM_RESOLVED_EVIDENCE'
    ) then
      raise exception 'cognition_remediation_repair_not_allowed';
    end if;
    if length(btrim(coalesce(p_episode->>'observed_anomaly','')))<8
       or length(btrim(coalesce(p_episode->>'prior_belief','')))<3
       or length(btrim(coalesce(p_episode->>'diagnosis','')))<8
       or length(btrim(coalesce(p_episode->>'verification_criterion','')))<8 then
      raise exception 'cognition_remediation_required_reasoning_missing';
    end if;
    if jsonb_typeof(coalesce(p_episode->'contradicting_evidence','[]'::jsonb))<>'array'
       or jsonb_array_length(coalesce(p_episode->'contradicting_evidence','[]'::jsonb))>16 then
      raise exception 'cognition_remediation_evidence_invalid';
    end if;

    insert into agent_lab.cognition_remediation_episodes(
      agent_id,assignment_key,node_path,model_id,attempt_no,status,
      observed_anomaly,prior_belief,contradicting_evidence,diagnosis,
      repair_type,repair_payload,verification_criterion,pre_state,
      source_wake_request_id,last_wake_request_id
    ) values (
      p_agent_id,p_assignment_key,p_node_path,p_model,v_attempt,'proposed',
      left(p_episode->>'observed_anomaly',2400),
      left(p_episode->>'prior_belief',2400),
      coalesce(p_episode->'contradicting_evidence','[]'::jsonb),
      left(p_episode->>'diagnosis',3000),
      v_repair_type,
      coalesce(p_episode->'repair_payload','{}'::jsonb),
      left(p_episode->>'verification_criterion',2400),
      coalesce(p_episode->'pre_state','{}'::jsonb),
      p_wake_request_id,p_wake_request_id
    )
    on conflict(agent_id,assignment_key,node_path,model_id,attempt_no) do nothing
    returning * into v_row;

    if not found then
      select * into v_row from agent_lab.cognition_remediation_episodes
      where agent_id=p_agent_id and assignment_key=p_assignment_key
        and node_path=p_node_path and model_id=p_model and attempt_no=v_attempt;
    end if;

    return jsonb_build_object(
      'status','ready','version','cognitive_self_remediation_v0_2',
      'remediation_id',v_row.remediation_id,'attempt_no',v_row.attempt_no,
      'episode_status',v_row.status,'repair_type',v_row.repair_type
    );
  end if;

  begin
    v_id:=(p_episode->>'remediation_id')::uuid;
  exception when others then
    raise exception 'cognition_remediation_id_invalid';
  end;
  v_status:=lower(coalesce(p_episode->>'status',''));
  if v_status not in ('applied','verifying','succeeded','failed') then
    raise exception 'cognition_remediation_status_invalid';
  end if;

  update agent_lab.cognition_remediation_episodes
  set status=v_status,
      post_state=case when p_episode ? 'post_state'
                      then coalesce(p_episode->'post_state','{}'::jsonb)
                      else post_state end,
      verification_result=case when p_episode ? 'verification_result'
                               then coalesce(p_episode->'verification_result','{}'::jsonb)
                               else verification_result end,
      last_wake_request_id=p_wake_request_id,
      updated_at=now()
  where remediation_id=v_id
    and agent_id=p_agent_id
    and assignment_key=p_assignment_key
    and node_path=p_node_path
    and model_id=p_model
  returning * into v_row;

  if not found then raise exception 'cognition_remediation_not_found'; end if;

  return jsonb_build_object(
    'status','ready','version','cognitive_self_remediation_v0_2',
    'remediation_id',v_row.remediation_id,'attempt_no',v_row.attempt_no,
    'episode_status',v_row.status,'repair_type',v_row.repair_type,
    'updated_at',v_row.updated_at
  );
end
$function$;

revoke all on function public.aau_bridge_cognition_remediation_v0_1(
  text,uuid,uuid,text,text,text,text,jsonb
) from public, anon, authenticated;

commit;
