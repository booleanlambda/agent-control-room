-- Control Room v2 file visibility: return safe inline previews for authorized UI rendering.
CREATE OR REPLACE FUNCTION public.aau_control_room_agent_files(p_agent_id uuid, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
  select jsonb_build_object(
    'version','agent_file_channel_v0_2',
    'agent_id',p_agent_id,
    'files',coalesce(jsonb_agg(x.obj order by x.created_at desc),'[]'::jsonb)
  )
  from (
    select f.created_at,jsonb_build_object(
      'file_id',f.file_id,
      'agent_id',f.agent_id,
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
      'embodiment_asset_id',f.embodiment_asset_id,
      'processing_status',f.processing_status,
      'visibility',f.visibility,
      'metadata',f.metadata,
      'has_inline_content',(f.inline_text is not null),
      'inline_text_preview',case when f.inline_text is null then null else left(f.inline_text,2400) end,
      'created_at',f.created_at,
      'updated_at',f.updated_at
    ) obj
    from agent_lab.agent_files f
    where f.agent_id=p_agent_id
    order by f.created_at desc
    limit greatest(1,least(coalesce(p_limit,100),200))
  ) x;
$function$
;
revoke all on function public.aau_control_room_agent_files(uuid,integer) from public,anon,authenticated;
grant execute on function public.aau_control_room_agent_files(uuid,integer) to service_role;
