CREATE OR REPLACE FUNCTION agent_lab.is_human_aligned_public_name(p_agent_id uuid, p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_name text:=trim(coalesce(p_name,''));
  v_label text;
  v_model_id text;
  v_model_surname text;
begin
  select internal_label,primary_model_id,model_surname into v_label,v_model_id,v_model_surname from agent_lab.agents where agent_id=p_agent_id;
  if length(v_name)<2 or length(v_name)>80 then return false; end if;
  if v_name !~ '[[:alpha:]]' then return false; end if;
  if v_name like '%<%' or v_name like '%>%' then return false; end if;
  if v_name ~* 'self[- _]?chosen|human[- _]?aligned|personal[ _-]?name|preferred[ _-]?name|placeholder|example|insert[ _-]?name|choose[ _-]?name' then return false; end if;
  if v_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return false; end if;
  if v_name ~* '^agent([_ -]?[a-z0-9]+)*$' then return false; end if;
  if v_name ~* '(agent[_ -]?id|uuid|internal[_ -]?label|model[_ -]?id)' then return false; end if;
  if v_name ~* '^[0-9a-f]{16,}$' then return false; end if;
  if v_label is not null and lower(v_name)=lower(v_label) then return false; end if;
  if v_model_id is not null and lower(v_name)=lower(v_model_id) then return false; end if;
  if v_model_surname is not null and lower(v_name)=lower(v_model_surname) then return false; end if;
  -- Separate per-agent first and last name exclusions. Legacy shared exclusions
  -- remain the fallback for agents not migrated to role-specific fields.
  if exists (
    select 1 from agent_lab.agents self
    where self.agent_id=p_agent_id
      and (
        (
          lower(split_part(v_name,' ',1)) in (
            select lower(btrim(x.word))
            from jsonb_array_elements_text(
              case when jsonb_typeof(self.metadata->'rejected_first_names')='array'
                then self.metadata->'rejected_first_names'
                else coalesce(self.metadata->'rejected_name_components','[]'::jsonb) end
            ) as x(word)
          )
        )
        or (
          lower(regexp_replace(v_name,'^.*[[:space:]]+','')) in (
            select lower(btrim(x.word))
            from jsonb_array_elements_text(
              case when jsonb_typeof(self.metadata->'rejected_last_names')='array'
                then self.metadata->'rejected_last_names'
                else coalesce(self.metadata->'rejected_name_components','[]'::jsonb) end
            ) as x(word)
          )
        )
        or (
          self.public_name is null
          and self.metadata->>'name_reselection_status'='pending_surname'
          and nullif(btrim(self.metadata->>'preserved_first_name'),'') is not null
          and (position(' ' in v_name)=0
            or lower(split_part(v_name,' ',1)) <> lower(self.metadata->>'preserved_first_name'))
        )
      )
  ) then return false; end if;
  -- Names belong to separate agents. Prefer the earliest recorded holder so
  -- an accidental duplicate cannot invalidate an existing agent's identity.
  if exists (
    select 1
    from agent_lab.agents o
    join agent_lab.agents self on self.agent_id=p_agent_id
    where o.agent_id<>p_agent_id
      and nullif(btrim(o.public_name),'') is not null
      and lower(btrim(o.public_name))=lower(v_name)
      and (
        coalesce(o.birth_model_timestamp,o.created_at)<coalesce(self.birth_model_timestamp,self.created_at)
        or (
          coalesce(o.birth_model_timestamp,o.created_at)=coalesce(self.birth_model_timestamp,self.created_at)
          and o.agent_id<p_agent_id
        )
      )
  ) then return false; end if;
  return true;
end;
$function$
;
