-- AAU provider-neutral manual starter bridge v0.9
-- Adds a bridge-token guarded, idempotent fresh-agent creation path for
-- isolated manual model experiments that can coexist with the active
-- autonomous lifecycle.

begin;

create or replace function public.aau_bridge_create_manual_starter_agent_v0_9(
  p_bridge_token text,
  p_ordinal integer,
  p_internal_label text,
  p_model_provider text,
  p_model_id text,
  p_model_family text,
  p_model_version text,
  p_model_surname text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','agent_lab'
as $function$
declare
  v_agent_id uuid;
  v_existing agent_lab.agents%rowtype;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  if p_ordinal < 1 then raise exception 'invalid_ordinal'; end if;
  if nullif(btrim(coalesce(p_internal_label,'')),'') is null then raise exception 'internal_label_required'; end if;
  if nullif(btrim(coalesce(p_model_provider,'')),'') is null then raise exception 'model_provider_required'; end if;
  if nullif(btrim(coalesce(p_model_id,'')),'') is null then raise exception 'model_id_required'; end if;

  select * into v_existing
  from agent_lab.agents
  where internal_label=p_internal_label
  limit 1;

  if v_existing.agent_id is not null then
    if v_existing.primary_model_provider is distinct from p_model_provider
       or v_existing.primary_model_id is distinct from p_model_id then
      raise exception 'starter_agent_label_binding_conflict';
    end if;
    return jsonb_build_object(
      'created',false,
      'agent_id',v_existing.agent_id,
      'internal_label',v_existing.internal_label,
      'status',v_existing.status,
      'consistency_status',v_existing.consistency_status,
      'primary_model_provider',v_existing.primary_model_provider,
      'primary_model_id',v_existing.primary_model_id
    );
  end if;

  if exists (
    select 1 from agent_lab.agents
    where metadata->>'ordinal'=p_ordinal::text
  ) then
    raise exception 'starter_agent_ordinal_already_exists';
  end if;

  v_agent_id := agent_lab.create_manual_starter_agent_v0_8(
    p_ordinal,
    p_internal_label,
    p_model_provider,
    p_model_id,
    p_model_family,
    p_model_version,
    p_model_surname
  );

  update agent_lab.agents
  set consistency_status='TRANSITION_TESTING',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'initial_direct_binding_pending_verification',true,
        'manual_operator_wake_experiment',true,
        'parallel_with_existing_autonomous_agent',true,
        'starter_bridge_contract','aau_bridge_create_manual_starter_agent_v0_9'
      ),
      updated_at=now()
  where agent_id=v_agent_id;

  return jsonb_build_object(
    'created',true,
    'agent_id',v_agent_id,
    'internal_label',p_internal_label,
    'status','incubating',
    'consistency_status','TRANSITION_TESTING',
    'primary_model_provider',p_model_provider,
    'primary_model_id',p_model_id
  );
end;
$function$;

revoke all on function public.aau_bridge_create_manual_starter_agent_v0_9(
  text,integer,text,text,text,text,text,text
) from public;

grant execute on function public.aau_bridge_create_manual_starter_agent_v0_9(
  text,integer,text,text,text,text,text,text
) to anon;

commit;
