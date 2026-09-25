-- AAU Control Room live decomposition trace v0.1
-- Adds the 10 most recently updated autonomous requirement nodes to operator_agent_detail
-- for the live Intents panel. Read-only; no cognition semantics are changed.

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
  'version','operator_agent_detail_v0_5_decomposition_trace',
  'protocol_version','next_intent_protocol_v0_1',
  'generated_at',now(),
  'status',(select to_jsonb(s) from agent_lab.operator_agent_status_intent s where s.agent_id=p_agent_id),
  'authoritative_assignment',(select body from assignment),
  'artifact_tree',agent_lab.operator_agent_artifact_tree_v0_1(p_agent_id),
  'timeline',coalesce((select jsonb_agg(jsonb_build_object(
    'agent_id',t.agent_id,'occurred_at',t.occurred_at,
    'event_kind',replace(replace(t.event_kind,'autonomous_wake','autonomous_intent'),'first_wake','first_intent'),
    'event_ref',t.event_ref,'title',replace(replace(t.title,'Wake','Intent'),'wake','intent'),
    'detail',replace(replace(t.detail,'Wake','Intent'),'wake','intent'),'context',t.context
  ) order by t.occurred_at desc) from (
    select * from agent_lab.operator_agent_timeline
    where agent_id=p_agent_id
    order by occurred_at desc
    limit greatest(1,least(coalesce(p_limit,50),500))
  ) t),'[]'::jsonb),
  'next_intents',coalesce((select jsonb_agg(to_jsonb(n) order by n.execute_at asc nulls last,n.created_at asc)
    from agent_lab.next_intents n where n.agent_id=p_agent_id and n.status='active'),'[]'::jsonb),
  'intent_executions',coalesce((select jsonb_agg(to_jsonb(q) order by q.execute_at desc nulls last,q.created_at desc)
    from (select * from agent_lab.intent_queue where agent_id=p_agent_id
      order by execute_at desc nulls last,created_at desc limit 25) q),'[]'::jsonb),
  'decomposition_executions',coalesce((select jsonb_agg(jsonb_build_object(
      'node_id',n.node_id,'assignment_key',n.assignment_key,'node_path',n.node_path,
      'depth',n.depth,'ordinal',n.ordinal,'requirement_text',n.requirement_text,
      'source_kind',n.source_kind,'source_ref',n.source_ref,'status',n.status,
      'decision_type',n.decision_type,'decision_payload',n.decision_payload,
      'result_hash',n.result_hash,'wake_request_id',n.last_wake_request_id,
      'created_at',n.created_at,'updated_at',n.updated_at
    ) order by n.updated_at desc,n.depth desc,n.ordinal desc)
    from (select * from agent_lab.cognition_requirement_nodes
      where agent_id=p_agent_id
      order by updated_at desc,depth desc,ordinal desc limit 10) n),'[]'::jsonb),
  'interests',coalesce((select jsonb_agg(jsonb_build_object(
    'topic',i.topic,'interest_strength',i.interest_strength,'curiosity_strength',i.curiosity_strength,
    'last_engaged_at',i.last_engaged_at) order by greatest(i.interest_strength,i.curiosity_strength) desc)
    from agent_lab.interests i where i.agent_id=p_agent_id),'[]'::jsonb),
  'active_goals',coalesce((select jsonb_agg(to_jsonb(g) order by g.priority desc)
    from agent_lab.goals g where g.agent_id=p_agent_id and g.status='active'),'[]'::jsonb),
  'active_projects',coalesce((select jsonb_agg(to_jsonb(p) order by p.priority desc)
    from agent_lab.projects p where p.owner_agent_id=p_agent_id and p.status in ('planned','active','paused')),'[]'::jsonb),
  'evidence_provenance',jsonb_build_object('version','evidence_provenance_v0_1',
    'recent_bundles',agent_lab.build_recent_evidence_context(p_agent_id,6)),
  'alerts',coalesce((select jsonb_agg(to_jsonb(a) order by a.last_seen_at desc)
    from agent_lab.operator_alerts a where a.agent_id=p_agent_id and a.status='open'),'[]'::jsonb)
);
$function$;

commit;
