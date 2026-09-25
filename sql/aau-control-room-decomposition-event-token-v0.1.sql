-- AAU Control Room decomposition event token v0.1
-- Extends the existing long-poll change token so cognition requirement-node
-- writes wake connected Control Room sessions immediately.
-- No timer/poll interval is required in the browser.

CREATE OR REPLACE FUNCTION public.aau_control_room_change_token()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
with revisions as (
  select
    coalesce((select max(updated_at) from agent_lab.agents),'epoch'::timestamptz) agents_rev,
    coalesce((select max(updated_at) from agent_lab.state),'epoch'::timestamptz) state_rev,
    coalesce((select max(updated_at) from agent_lab.autonomous_lifecycle_runs),'epoch'::timestamptz) lifecycle_rev,
    coalesce((select greatest(max(created_at),max(started_at),max(completed_at)) from agent_lab.wake_queue),'epoch'::timestamptz) wakes_rev,
    coalesce((select max(updated_at) from agent_lab.admin_chat_messages),'epoch'::timestamptz) chat_rev,
    coalesce((select max(updated_at) from agent_lab.agent_files),'epoch'::timestamptz) files_rev,
    coalesce((select max(updated_at) from agent_lab.expertise_economic_proposals),'epoch'::timestamptz) expertise_rev,
    coalesce((select max(updated_at) from agent_lab.attention_items),'epoch'::timestamptz) attention_rev,
    coalesce((select max(updated_at) from agent_lab.cognition_requirement_nodes),'epoch'::timestamptz) decomposition_rev
)
select jsonb_build_object(
  'token',md5(concat_ws('|',
    agents_rev,state_rev,lifecycle_rev,wakes_rev,chat_rev,files_rev,
    expertise_rev,attention_rev,decomposition_rev
  )),
  'agents_rev',agents_rev,
  'state_rev',state_rev,
  'lifecycle_rev',lifecycle_rev,
  'wakes_rev',wakes_rev,
  'chat_rev',chat_rev,
  'files_rev',files_rev,
  'expertise_rev',expertise_rev,
  'attention_rev',attention_rev,
  'decomposition_rev',decomposition_rev
) from revisions
$function$;
