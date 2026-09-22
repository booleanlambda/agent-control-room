-- Resume-safe private examination construction: partial material is never an approved standard.
create or replace function public.aau_bridge_checkpoint_expertise_standard(
 p_bridge_token text,p_standard_id uuid,p_author_model text,
 p_public_spec jsonb,p_private_partial jsonb,p_sources jsonb
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','agent_lab','extensions' as $$
declare v agent_lab.expertise_standard_versions%rowtype;
 v_agent_model text;
 v_count integer;
begin
 perform agent_lab.assert_broker_bridge_token(p_bridge_token);
 select * into v from agent_lab.expertise_standard_versions where standard_id=p_standard_id for update;
 if not found or v.status<>'authoring' then raise exception 'standard_not_claimed'; end if;
 select coalesce(nullif(primary_model_id,''),birth_model_id) into v_agent_model
   from agent_lab.agents where agent_id=v.agent_id;
 if nullif(p_author_model,'') is null or p_author_model=v_agent_model then
   raise exception 'academic_author_not_independent'; end if;
 if p_public_spec->>'academic_target'<>'leading_us_university_masters_level_demonstrated_competence'
   or p_public_spec->>'domain' is distinct from v.domain
   or jsonb_typeof(p_public_spec->'competencies') is distinct from 'array'
   or jsonb_array_length(p_public_spec->'competencies')<4 then
   raise exception 'partial_public_standard_invalid'; end if;
 if jsonb_typeof(p_private_partial->'tasks') is distinct from 'array' then
   raise exception 'partial_private_tasks_array_required'; end if;
 v_count:=jsonb_array_length(p_private_partial->'tasks');
 if v_count>8 then raise exception 'too_many_private_tasks'; end if;
 if jsonb_typeof(p_sources) is distinct from 'array' then raise exception 'source_receipts_required'; end if;
 update agent_lab.expertise_standard_versions set
   public_spec=p_public_spec,private_assessment=p_private_partial,source_receipts=p_sources,
   author_model=p_author_model,authored_at=now(),updated_at=now()
 where standard_id=p_standard_id;
 return jsonb_build_object('status','authoring','checkpointed_tasks',v_count,
   'standard_id',p_standard_id,'approved',false);
end;
$$;
revoke all on function public.aau_bridge_checkpoint_expertise_standard(text,uuid,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.aau_bridge_checkpoint_expertise_standard(text,uuid,text,jsonb,jsonb,jsonb) to anon,authenticated;
