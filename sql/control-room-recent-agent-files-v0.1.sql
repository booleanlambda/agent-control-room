-- Control Room recent agent file inbox v0.1
create or replace function public.aau_control_room_recent_agent_files(p_limit integer default 100)
returns jsonb
language sql
security definer
set search_path to 'pg_catalog','agent_lab'
as $fn$
select jsonb_build_object(
  'version','agent_file_inbox_v0_1',
  'files',coalesce(jsonb_agg(x.obj order by x.created_at desc),'[]'::jsonb)
)
from (
  select f.created_at,jsonb_build_object(
    'file_id',f.file_id,
    'agent_id',f.agent_id,
    'agent_name',coalesce(a.public_name,a.internal_label),
    'internal_label',a.internal_label,
    'sender_kind',f.sender_kind,
    'recipient_kind',f.recipient_kind,
    'direction',f.direction,
    'filename',f.filename,
    'mime_type',f.mime_type,
    'file_size_bytes',f.file_size_bytes,
    'storage_bucket',f.storage_bucket,
    'storage_path',f.storage_path,
    'sha256',f.sha256,
    'caption',f.caption,
    'purpose',f.purpose,
    'source_message_id',f.source_message_id,
    'source_wake_request_id',f.source_wake_request_id,
    'processing_status',f.processing_status,
    'visibility',f.visibility,
    'metadata',f.metadata,
    'has_inline_content',(f.inline_text is not null),
    'inline_text_preview',case when f.inline_text is null then null else left(f.inline_text,2400) end,
    'created_at',f.created_at,
    'updated_at',f.updated_at
  ) obj
  from agent_lab.agent_files f
  join agent_lab.agents a on a.agent_id=f.agent_id
  where f.direction='outbound'
  order by f.created_at desc
  limit greatest(1,least(coalesce(p_limit,100),300))
) x;
$fn$;
revoke all on function public.aau_control_room_recent_agent_files(integer) from public,anon,authenticated;
grant execute on function public.aau_control_room_recent_agent_files(integer) to service_role;
