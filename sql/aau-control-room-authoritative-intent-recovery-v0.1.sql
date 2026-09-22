-- AAU Control Room authoritative assignment + retry-state cleanup v0.1
-- Successful wake reclaim clears active last_error while preserving retry history.
-- Operator detail exposes lifecycle-authoritative work separately from historical scheduler text.

begin;

CREATE OR REPLACE FUNCTION agent_lab.operator_agent_detail(p_agent_id uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
with lifecycle as (
  select agent_lab.current_mandatory_lifecycle_stage(p_agent_id) as stage
), assignment as (
  select case
    when stage='mba_entrepreneurship' then (
      select jsonb_build_object(
        'source','authoritative_lifecycle',
        'stage',stage,
        'kind',p->>'next_kind',
        'course_code',p#>>'{current_course,course_code}',
        'course_title',p#>>'{current_course,title}',
        'unit_id',p#>>'{next_unit,unit_id}',
        'unit_order',nullif(p#>>'{next_unit,unit_order}','')::int,
        'unit_title',p#>>'{next_unit,title}',
        'assignment_prompt',p#>>'{next_unit,assignment_prompt}',
        'units_submitted',nullif(p->>'units_submitted','')::int,
        'courses_passed',nullif(p->>'courses_passed','')::int,
        'display_label',concat_ws(' — ',
          nullif(concat_ws(' ',p#>>'{current_course,course_code}',
            case when p#>>'{next_unit,unit_order}' is not null then 'Unit '||(p#>>'{next_unit,unit_order}') else null end),''),
          p#>>'{next_unit,title}'
        )
      )
      from (select agent_lab.entrepreneurship_program_progress_v0_1(p_agent_id) p) x
    )
    else jsonb_build_object(
      'source','authoritative_lifecycle',
      'stage',stage,
      'kind','lifecycle_stage',
      'display_label',replace(initcap(replace(coalesce(stage,'unknown'),'_',' ')),'Mba','MBA')
    )
  end as body
  from lifecycle
)
select jsonb_build_object(
  'version','operator_agent_detail_next_intent_v0_3_authoritative_assignment',
  'protocol_version','next_intent_protocol_v0_1',
  'generated_at',now(),
  'status',(select to_jsonb(s) from agent_lab.operator_agent_status_intent s where s.agent_id=p_agent_id),
  'authoritative_assignment',(select body from assignment),
  'timeline',coalesce((select jsonb_agg(jsonb_build_object(
    'agent_id',t.agent_id,'occurred_at',t.occurred_at,
    'event_kind',replace(replace(t.event_kind,'autonomous_wake','autonomous_intent'),'first_wake','first_intent'),
    'event_ref',t.event_ref,'title',replace(replace(t.title,'Wake','Intent'),'wake','intent'),
    'detail',replace(replace(t.detail,'Wake','Intent'),'wake','intent'),'context',t.context
  ) order by t.occurred_at desc) from (select * from agent_lab.operator_agent_timeline where agent_id=p_agent_id order by occurred_at desc limit greatest(1,least(coalesce(p_limit,50),500))) t),'[]'::jsonb),
  'next_intents',coalesce((select jsonb_agg(to_jsonb(n) order by n.execute_at asc nulls last,n.created_at asc) from agent_lab.next_intents n where n.agent_id=p_agent_id and n.status='active'),'[]'::jsonb),
  'intent_executions',coalesce((select jsonb_agg(to_jsonb(q) order by q.execute_at desc nulls last,q.created_at desc) from (select * from agent_lab.intent_queue where agent_id=p_agent_id order by execute_at desc nulls last,created_at desc limit 25) q),'[]'::jsonb),
  'interests',coalesce((select jsonb_agg(jsonb_build_object('topic',i.topic,'interest_strength',i.interest_strength,'curiosity_strength',i.curiosity_strength,'last_engaged_at',i.last_engaged_at) order by greatest(i.interest_strength,i.curiosity_strength) desc) from agent_lab.interests i where i.agent_id=p_agent_id),'[]'::jsonb),
  'active_goals',coalesce((select jsonb_agg(to_jsonb(g) order by g.priority desc) from agent_lab.goals g where g.agent_id=p_agent_id and g.status='active'),'[]'::jsonb),
  'active_projects',coalesce((select jsonb_agg(to_jsonb(p) order by p.priority desc) from agent_lab.projects p where p.owner_agent_id=p_agent_id and p.status in ('planned','active','paused')),'[]'::jsonb),
  'evidence_provenance',jsonb_build_object('version','evidence_provenance_v0_1','recent_bundles',agent_lab.build_recent_evidence_context(p_agent_id,6)),
  'alerts',coalesce((select jsonb_agg(to_jsonb(a) order by a.last_seen_at desc) from agent_lab.operator_alerts a where a.agent_id=p_agent_id and a.status='open'),'[]'::jsonb)
);
$function$
;

CREATE OR REPLACE FUNCTION public.aau_bridge_begin_nvidia_experimental_wake(p_bridge_token text, p_wake_request_id uuid, p_agent_id uuid, p_worker_id text DEFAULT 'render-nvidia-experimental'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
declare
  v_q agent_lab.wake_queue%rowtype;
  v_agent agent_lab.agents%rowtype;
  v_packet jsonb;
  v_global_pause boolean := false;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  select coalesce((metadata->>'global_pause')::boolean,false) into v_global_pause
  from agent_lab.runtime_config where config_id=1;
  if not v_global_pause then raise exception 'isolated_nvidia_wake_requires_global_pause'; end if;

  select * into v_agent from agent_lab.agents
  where agent_id=p_agent_id and status <> 'archived';
  if v_agent.agent_id is null then raise exception 'agent_missing_or_archived'; end if;
  if coalesce(v_agent.primary_model_provider,'') <> 'nvidia_direct' or coalesce(v_agent.primary_model_id,'')='' then
    raise exception 'agent_not_bound_to_nvidia_direct';
  end if;

  if exists(select 1 from agent_lab.autonomous_lifecycle_runs r where r.agent_id=p_agent_id) and not exists(
    select 1 from agent_lab.autonomous_lifecycle_runs r where r.agent_id=p_agent_id and r.status in ('starting','running','degraded')
  ) then raise exception 'autonomous_lifecycle_not_running'; end if;

  update agent_lab.wake_queue q
     set status='claimed',
         claimed_at=now(),
         worker_id=coalesce(nullif(p_worker_id,''),'render-nvidia-experimental'),
         attempts=q.attempts+1,
         metadata=
           case when q.last_error is not null then
             coalesce(q.metadata,'{}'::jsonb)
             || jsonb_build_object(
               'retry_history',
               (case when jsonb_typeof(q.metadata->'retry_history')='array'
                     then q.metadata->'retry_history' else '[]'::jsonb end)
               || jsonb_build_array(jsonb_build_object(
                    'error',q.last_error,
                    'reclaimed_at',now(),
                    'prior_attempts',q.attempts,
                    'prior_worker_id',q.worker_id,
                    'prior_started_at',q.started_at
                  )),
               'last_recovery_cleared_at',now(),
               'last_recovery_cleared_by',coalesce(nullif(p_worker_id,''),'render-nvidia-experimental')
             )
           else coalesce(q.metadata,'{}'::jsonb) end,
         last_error=null
   where q.wake_request_id=p_wake_request_id and q.agent_id=p_agent_id and q.status='queued'
     and (q.due_at is null or q.due_at<=now())
  returning q.* into v_q;
  if v_q.wake_request_id is null then raise exception 'wake_not_claimable'; end if;

  if v_q.wake_intent_id is not null then
    update agent_lab.wake_intents set status='triggered',triggered_at=now()
    where wake_intent_id=v_q.wake_intent_id and status='active';
  end if;

  if not agent_lab.mark_wake_running(p_wake_request_id) then raise exception 'wake_mark_running_failed'; end if;

  update agent_lab.autonomous_lifecycle_runs
     set status='running',last_error=null,updated_at=now()
   where agent_id=p_agent_id and status in ('starting','running','degraded');

  v_packet:=agent_lab.get_cognition_packet(p_agent_id,p_wake_request_id);
  return jsonb_build_object(
    'wake_request_id',p_wake_request_id,'agent_id',p_agent_id,
    'primary_model_provider',v_agent.primary_model_provider,'primary_model_id',v_agent.primary_model_id,
    'consistency_status',v_agent.consistency_status,'packet',v_packet
  );
end;
$function$
;

commit;
