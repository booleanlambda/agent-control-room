-- Control Room explicit verification recovery action v0.1
create or replace function public.aau_control_room_resume_expertise_verification(
  p_verification_run_id uuid,
  p_operator_id text,
  p_reason text
) returns jsonb
language sql
security definer
set search_path to 'pg_catalog','agent_lab'
as $fn$
  select agent_lab.operator_resume_expertise_verification_v0_1(
    p_verification_run_id,p_operator_id,p_reason
  );
$fn$;
revoke all on function public.aau_control_room_resume_expertise_verification(uuid,text,text) from public,anon,authenticated;
grant execute on function public.aau_control_room_resume_expertise_verification(uuid,text,text) to service_role;
