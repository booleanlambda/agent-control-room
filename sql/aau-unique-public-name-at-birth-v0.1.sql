-- AAU identity collision prevention, Sep 20 2026.

-- Earlier committed public names are protected; newer agents must independently choose available names.

-- For the in-progress agent 44, its original duplicate choice is preserved in audit history, superseded,

-- and its packet lists that single unavailable name; do not reset previous agent 43.

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


CREATE OR REPLACE FUNCTION agent_lab.get_cognition_packet(p_agent_id uuid, p_wake_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'agent_lab', 'public', 'extensions', 'pg_temp'
AS $function$
declare
 v_packet jsonb;
 v_results jsonb;
 v_contract jsonb;
begin
 v_packet:=agent_lab.get_cognition_packet_pre_capability_results_v0_1(p_agent_id,p_wake_request_id);
 v_results:=agent_lab.build_recent_capability_results_v0_1(p_agent_id);
 v_contract:=agent_lab.build_evidence_first_cognition_contract_v0_1();
 return agent_lab.canonicalize_next_intent_json_v0_1(
   v_packet
   || jsonb_build_object(
     'brain_packet_version','brain_packet_v0_40_identity_name_collision_guard',
     'identity_name_availability',jsonb_build_object(
       'unavailable_names',coalesce((
         select case when nullif(btrim(a.metadata->>'unavailable_public_name'),'') is null
           then '[]'::jsonb else jsonb_build_array(a.metadata->>'unavailable_public_name') end
         from agent_lab.agents a where a.agent_id=p_agent_id
       ),'[]'::jsonb),
       'rule','If your earlier chosen public name was unavailable because another agent had previously committed it, independently choose a different name. The runtime will not assign one. Do not inherit another agent identity.'),
     'recent_capability_results',v_results,
     'capability_result_system_contract',
     'recent_capability_results is authoritative runtime feedback. If an inspection capability is COMPLETED, its result is available now and must not be described as pending. Use completed evidence before repeating the same inspection.',
     'evidence_first_cognition_contract',v_contract,
     'evidence_first_system_contract',
     'Intention is not execution, execution is not independent verification. Use evidence_first_cognition_contract before making progress claims or selecting another external action. Never claim a gate passed without the latest authoritative verdict.'
   )
 );
end;
$function$

