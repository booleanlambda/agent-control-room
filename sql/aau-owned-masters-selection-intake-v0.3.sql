CREATE OR REPLACE FUNCTION agent_lab.validate_expertise_viability_proposal_v0_1(p_proposal jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_missing jsonb:='[]'::jsonb;
  v_app jsonb;
  v_econ jsonb;
  v_check jsonb;
begin
  if jsonb_typeof(p_proposal) is distinct from 'object' then
    return jsonb_build_object('ok',false,'missing',jsonb_build_array('proposal:object'),
      'contract_version','expertise_viability_proposal_v0_1');
  end if;

  if length(btrim(coalesce(p_proposal->>'domain','')))<2 then
    v_missing:=v_missing||jsonb_build_array('domain');
  end if;
  if p_proposal->>'proposal_contract_version' is distinct from 'expertise_viability_proposal_v0_3' then
  if nullif(btrim(coalesce(p_proposal->>'target_standard','')),'') is null then
    v_missing:=v_missing||jsonb_build_array('target_standard');
  end if;
  if jsonb_typeof(p_proposal->'scope') is distinct from 'object'
     or coalesce(p_proposal->'scope','{}'::jsonb)='{}'::jsonb then
    v_missing:=v_missing||jsonb_build_array('scope:nonempty_object');
  end if;
  if jsonb_typeof(p_proposal->'competencies') is distinct from 'array'
     or jsonb_array_length(case when jsonb_typeof(p_proposal->'competencies')='array'
       then p_proposal->'competencies' else '[]'::jsonb end)=0 then
    v_missing:=v_missing||jsonb_build_array('competencies:nonempty_array');
  end if;
  if jsonb_typeof(p_proposal->'evidence_requirements') is distinct from 'object'
     or coalesce(p_proposal->'evidence_requirements','{}'::jsonb)='{}'::jsonb then
    v_missing:=v_missing||jsonb_build_array('evidence_requirements:nonempty_object');
  end if;
  if jsonb_typeof(p_proposal->'verification_plan') is distinct from 'object'
     or coalesce(p_proposal->'verification_plan','{}'::jsonb)='{}'::jsonb then
    v_missing:=v_missing||jsonb_build_array('verification_plan:nonempty_object');
  elsif (p_proposal->'verification_plan') ?| array[
      'mean_score_min','pass_score','task_score_min','required_task_fraction'
    ] then
    v_missing:=v_missing||jsonb_build_array('verification_plan:runtime_owned_thresholds_must_not_be_agent_set');
  end if;

  end if;

  v_app:=case when jsonb_typeof(p_proposal->'intended_application')='object'
    then p_proposal->'intended_application' else '{}'::jsonb end;
  v_econ:=case when jsonb_typeof(p_proposal->'economic_viability')='object'
    then p_proposal->'economic_viability' else '{}'::jsonb end;
  v_check:=agent_lab.validate_expertise_application_v0_1(v_app,v_econ);
  if not coalesce((v_check->>'ok')::boolean,false) then
    v_missing:=v_missing||coalesce(v_check->'missing','[]'::jsonb);
  end if;

  if length(btrim(coalesce(p_proposal->>'economic_case','')))<160 then
    v_missing:=v_missing||jsonb_build_array('economic_case:min_160_chars');
  end if;
  if length(btrim(coalesce(p_proposal->>'socioeconomic_case','')))<160 then
    v_missing:=v_missing||jsonb_build_array('socioeconomic_case:min_160_chars');
  end if;
  if jsonb_typeof(p_proposal->'evidence') is distinct from 'array'
     or jsonb_array_length(case when jsonb_typeof(p_proposal->'evidence')='array'
       then p_proposal->'evidence' else '[]'::jsonb end)=0 then
    v_missing:=v_missing||jsonb_build_array('evidence:nonempty_array');
  end if;
  if length(btrim(coalesce(p_proposal->>'confidence_and_gaps','')))<40 then
    v_missing:=v_missing||jsonb_build_array('confidence_and_gaps:min_40_chars');
  end if;

  return jsonb_build_object(
    'ok',v_missing='[]'::jsonb,
    'missing',v_missing,
    'contract_version',coalesce(p_proposal->>'proposal_contract_version','expertise_viability_proposal_v0_1'),
    'approval_semantics','Operator approval authorizes this combined expertise-development path and viability thesis as one unit; it does not verify competence, customers, revenue, funding, or measured social impact.',
    'application_validation',v_check
  );
end
$function$
;

CREATE OR REPLACE FUNCTION public.aau_bridge_submit_expertise_viability_proposal(p_bridge_token text, p_agent_id uuid, p_wake_request_id uuid, p_proposal jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_domain text;
  v_id uuid;
  v_pending uuid;
  v_revision uuid;
  v_stage text;
  v_check jsonb;
  v_agent_proposal jsonb;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  if not exists(
    select 1 from agent_lab.wake_queue
    where agent_id=p_agent_id and wake_request_id=p_wake_request_id
      and (status in ('running','claimed')
        or (status='completed' and completed_at>now()-interval '20 minutes'))
  ) then raise exception 'expertise_viability_proposal_wake_not_running'; end if;

  select current_stage into v_stage
  from agent_lab.mandatory_lifecycle_states where agent_id=p_agent_id;
  if v_stage<>'expertise_artifact' then
    raise exception 'expertise_viability_proposal_wrong_stage:%',coalesce(v_stage,'missing');
  end if;

  if p_proposal is null or jsonb_typeof(p_proposal)<>'object'
     or octet_length(p_proposal::text)>60000 then
    raise exception 'expertise_viability_proposal_invalid_payload';
  end if;

  -- Preserve the self-selected domain and economic thesis, not candidate-authored
  -- academic requirements. AAU independently writes those after submission.
  v_agent_proposal:=(p_proposal - 'target_standard' - 'scope' - 'competencies'
     - 'evidence_requirements' - 'verification_plan')
     || jsonb_build_object('proposal_contract_version','expertise_viability_proposal_v0_3',
       'standard_authority','aau_independent_author_and_reviewer');
  v_check:=agent_lab.validate_expertise_viability_proposal_v0_1(v_agent_proposal);
  if not coalesce((v_check->>'ok')::boolean,false) then
    raise exception 'expertise_viability_proposal_incomplete:%',v_check->'missing';
  end if;

  v_domain:=left(btrim(p_proposal->>'domain'),300);

  select proposal_id into v_revision
  from agent_lab.expertise_economic_proposals
  where agent_id=p_agent_id and status='revision_requested'
  order by updated_at desc limit 1 for update;

  if v_revision is not null then
    update agent_lab.expertise_economic_proposals
    set domain=v_domain,
        report=v_agent_proposal||jsonb_build_object(
          'proposal_contract_version','expertise_viability_proposal_v0_3',
          'unit_approval_required',true
        ),
        source_wake_request_id=p_wake_request_id,
        status='pending',
        reviewed_at=null,operator_id=null,operator_note=null,
        updated_at=now()
    where proposal_id=v_revision
    returning proposal_id into v_id;

    return jsonb_build_object(
      'status','pending','proposal_id',v_id,'domain',v_domain,
      'operator_approval_required',true,'revision_resubmitted',true,
      'contract_version','expertise_viability_proposal_v0_3'
    );
  end if;

  select proposal_id into v_pending
  from agent_lab.expertise_economic_proposals
  where agent_id=p_agent_id and status='pending' for update;

  if v_pending is not null then
    return jsonb_build_object(
      'status','already_pending','proposal_id',v_pending,
      'operator_approval_required',true,
      'contract_version','expertise_viability_proposal_v0_3'
    );
  end if;

  if exists(select 1 from agent_lab.expertise_economic_proposals
    where agent_id=p_agent_id and status in('approved','consumed')) then
    raise exception 'expertise_viability_prior_unit_approval_exists';
  end if;

  insert into agent_lab.expertise_economic_proposals(
    agent_id,domain,report,source_wake_request_id,status
  ) values(
    p_agent_id,v_domain,
    v_agent_proposal||jsonb_build_object(
      'proposal_contract_version','expertise_viability_proposal_v0_3',
      'unit_approval_required',true
    ),
    p_wake_request_id,'pending'
  ) returning proposal_id into v_id;

  return jsonb_build_object(
    'status','pending','proposal_id',v_id,'domain',v_domain,
    'operator_approval_required',true,'revision_resubmitted',false,
    'contract_version','expertise_viability_proposal_v0_3'
  );
end
$function$
;
