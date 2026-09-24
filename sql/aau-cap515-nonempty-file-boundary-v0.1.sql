
BEGIN;

CREATE OR REPLACE FUNCTION agent_lab.register_agent_file_outputs_v0_1(
  p_agent_id uuid,
  p_activity_id uuid,
  p_cognition_run_id uuid,
  p_wake_request_id uuid,
  p_outputs jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'pg_catalog','agent_lab','extensions'
AS $function$
declare
  v_item jsonb;
  v_file jsonb;
  v_id uuid;
  v_msg uuid;
  v_results jsonb := '[]'::jsonb;
  v_filename text;
  v_mime text;
  v_content text;
  v_caption text;
  v_count int := 0;
begin
  if jsonb_typeof(coalesce(p_outputs,'[]'::jsonb)) <> 'array' then
    return jsonb_build_object('created',0,'files','[]'::jsonb);
  end if;

  for v_item in select value from jsonb_array_elements(p_outputs) loop
    exit when v_count >= 8;
    if coalesce(v_item->>'origin','') <> 'agent_file_output_v0_1' then
      continue;
    end if;

    v_file := case when jsonb_typeof(v_item->'file')='object' then v_item->'file' else v_item end;
    v_filename := left(btrim(coalesce(v_file->>'filename','')),255);
    v_mime := lower(btrim(coalesce(v_file->>'mime_type','text/plain')));
    v_content := coalesce(v_file->>'content','');
    v_caption := left(coalesce(v_file->>'caption',''),2000);

    -- A filename/reference is not a file. Refuse phantom zero-byte artifacts.
    if v_filename='' or btrim(v_content)='' or char_length(v_content)>200000 then
      continue;
    end if;

    if v_mime not in (
      'text/plain','text/markdown','application/json','text/csv',
      'text/x-python','application/x-python-code',
      'text/javascript','application/javascript',
      'text/typescript','application/typescript',
      'text/x-sql','application/sql'
    ) then
      continue;
    end if;

    select f.file_id,f.source_message_id into v_id,v_msg
    from agent_lab.agent_files f
    where f.agent_id=p_agent_id
      and f.source_wake_request_id=p_wake_request_id
      and f.filename=v_filename
      and f.direction='outbound'
      and f.purpose='agent_output'
      and length(btrim(coalesce(f.inline_text,'')))>0
    order by f.created_at desc limit 1;

    if v_id is not null then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'file_id',v_id,'filename',v_filename,'mime_type',v_mime,'message_id',v_msg,'reused',true
      ));
      v_count := v_count + 1;
      continue;
    end if;

    v_id:=extensions.gen_random_uuid();

    insert into agent_lab.admin_chat_messages(
      agent_id,sender_kind,content,delivery_status,source_wake_request_id,
      source_activity_id,attachment_count,primary_file_id,metadata
    ) values(
      p_agent_id,'agent',coalesce(nullif(v_caption,''),'Created file: '||v_filename),
      'responded',p_wake_request_id,p_activity_id,1,v_id,
      jsonb_build_object(
        'origin','agent_file_output_v0_1',
        'file_id',v_id,
        'file_registration_version','agent_file_output_registration_v0_3_nonempty'
      )
    ) returning message_id into v_msg;

    insert into agent_lab.agent_files(
      file_id,agent_id,sender_kind,recipient_kind,direction,filename,mime_type,
      file_size_bytes,storage_bucket,storage_path,caption,purpose,inline_text,
      source_message_id,source_activity_id,source_cognition_run_id,
      source_wake_request_id,processing_status,visibility,metadata
    ) values(
      v_id,p_agent_id,'agent','admin','outbound',v_filename,v_mime,
      octet_length(v_content),'inline',
      'inline/'||p_agent_id::text||'/'||v_id::text||'/'||v_filename,
      v_caption,'agent_output',v_content,v_msg,p_activity_id,p_cognition_run_id,
      p_wake_request_id,'delivered','shared_with_admin',
      jsonb_build_object(
        'origin','agent_authored_file_output_v0_1',
        'file_channel_version','agent_file_channel_v0_2',
        'file_registration_version','agent_file_output_registration_v0_3_nonempty'
      )
    );

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'file_id',v_id,'filename',v_filename,'mime_type',v_mime,'message_id',v_msg,'reused',false
    ));
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'created',v_count,'files',v_results,
    'version','agent_file_output_registration_v0_3_nonempty'
  );
end;
$function$;

-- Only substantive files may advance the CAP515 intervention tree.
CREATE OR REPLACE FUNCTION agent_lab.capture_cap515_complex_work_file_v0_1()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'pg_catalog','agent_lab'
AS $function$
declare
  v_work uuid;
  v_step text;
begin
  if new.agent_id is null or new.purpose<>'agent_output'
     or length(btrim(coalesce(new.inline_text,'')))=0 then
    return new;
  end if;

  select work_id into v_work
  from agent_lab.complex_work_pilots
  where agent_id=new.agent_id
    and status in('draft','in_progress','blocked','submitted')
    and metadata->>'assessment_release_state'='held_pending_operator_preflight'
  order by created_at desc limit 1;
  if v_work is null then return new; end if;

  v_step:=case
    when upper(new.filename) like 'CANONICAL_VENTURE_MODEL%' then 'canonical'
    when upper(new.filename) like 'FINANCIAL_CHECKS%' then 'math'
    when upper(new.filename) like 'CLAIM_EVIDENCE_REGISTER%' then 'evidence'
    when upper(new.filename) like 'CROSS_UNIT_RECONCILIATION%' then 'alignment'
    when upper(new.filename) like 'BOARD_DECISION%' then 'board'
    else null end;
  if v_step is null then return new; end if;

  update agent_lab.complex_work_steps
  set status='submitted',
      evidence_file_ids=case when new.file_id=any(evidence_file_ids)
        then evidence_file_ids else array_append(evidence_file_ids,new.file_id) end,
      checkpoint=coalesce(checkpoint,'{}'::jsonb)||jsonb_build_object(
        'latest_agent_file_id',new.file_id,'latest_filename',new.filename,
        'latest_sha256',new.sha256,'agent_submitted_at',new.created_at,
        'verification_status','operator_preflight_required'),
      updated_at=now()
  where work_id=v_work and step_key=v_step;
  return new;
end;
$function$;

-- Preflight ignores phantom/empty historical files.
CREATE OR REPLACE FUNCTION agent_lab.cap515_reconciliation_preflight_v0_1(p_agent_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path TO 'pg_catalog','agent_lab'
AS $function$
declare
  v_work agent_lab.complex_work_pilots%rowtype;
  v_canon_file uuid; v_fin_file uuid; v_ev_file uuid; v_cross_file uuid; v_board_file uuid;
  v_canon jsonb; v_fin jsonb; v_ev jsonb; v_cross jsonb; v_board jsonb;
  v_discount numeric:=0;
  v_formula text:='';
  v_unbacked_verified int:=0;
  v_external_sources int:=0;
  v_missing int:=0;
  v_failures text[]:='{}';
  v_ready boolean:=false;
begin
  select * into v_work from agent_lab.complex_work_pilots
   where agent_id=p_agent_id
     and metadata->>'assessment_release_state'='held_pending_operator_preflight'
     and status in('draft','in_progress','blocked','submitted')
   order by created_at desc limit 1;
  if not found then
    return jsonb_build_object('ready_for_operator_review',false,'reason','no_active_cap515_preflight_work');
  end if;

  select file_id,agent_lab.try_parse_jsonb_v0_1(inline_text) into v_canon_file,v_canon
   from agent_lab.agent_files where agent_id=p_agent_id and created_at>=v_work.created_at
     and upper(filename) like 'CANONICAL_VENTURE_MODEL%'
     and length(btrim(coalesce(inline_text,'')))>0
   order by created_at desc limit 1;
  select file_id,agent_lab.try_parse_jsonb_v0_1(inline_text) into v_fin_file,v_fin
   from agent_lab.agent_files where agent_id=p_agent_id and created_at>=v_work.created_at
     and upper(filename) like 'FINANCIAL_CHECKS%'
     and length(btrim(coalesce(inline_text,'')))>0
   order by created_at desc limit 1;
  select file_id,agent_lab.try_parse_jsonb_v0_1(inline_text) into v_ev_file,v_ev
   from agent_lab.agent_files where agent_id=p_agent_id and created_at>=v_work.created_at
     and upper(filename) like 'CLAIM_EVIDENCE_REGISTER%'
     and length(btrim(coalesce(inline_text,'')))>0
   order by created_at desc limit 1;
  select file_id,agent_lab.try_parse_jsonb_v0_1(inline_text) into v_cross_file,v_cross
   from agent_lab.agent_files where agent_id=p_agent_id and created_at>=v_work.created_at
     and upper(filename) like 'CROSS_UNIT_RECONCILIATION%'
     and length(btrim(coalesce(inline_text,'')))>0
   order by created_at desc limit 1;
  select file_id,agent_lab.try_parse_jsonb_v0_1(inline_text) into v_board_file,v_board
   from agent_lab.agent_files where agent_id=p_agent_id and created_at>=v_work.created_at
     and upper(filename) like 'BOARD_DECISION%'
     and length(btrim(coalesce(inline_text,'')))>0
   order by created_at desc limit 1;

  v_missing:=(case when v_canon_file is null then 1 else 0 end)
    +(case when v_fin_file is null then 1 else 0 end)
    +(case when v_ev_file is null then 1 else 0 end)
    +(case when v_cross_file is null then 1 else 0 end)
    +(case when v_board_file is null then 1 else 0 end);
  if v_missing>0 then v_failures:=array_append(v_failures,'required_artifacts_missing'); end if;

  if coalesce(v_canon#>>'{unit_economics,discount_rate}','') ~ '^[0-9]+([.][0-9]+)?$' then
    v_discount:=(v_canon#>>'{unit_economics,discount_rate}')::numeric;
  end if;
  v_formula:=lower(coalesce(v_fin#>>'{checks,ltv_calculation,formula}',''));
  if v_fin_file is not null and v_discount>0
     and v_formula not like '%discount%' and v_formula not like '%present value%' then
    v_failures:=array_append(v_failures,'ltv_formula_omits_stated_discount_rate');
  end if;

  if v_ev is not null and jsonb_typeof(v_ev->'evidence_entries')='array' then
    select count(*) into v_unbacked_verified
    from jsonb_array_elements(v_ev->'evidence_entries') e
    where upper(coalesce(e->>'verification_status',''))='VERIFIED'
      and lower(coalesce(e->>'classification','')) not in('arithmetic_derivation','internal_calculation')
      and (
        nullif(btrim(coalesce(e#>>'{source,url}','')),'') is null
        or upper(btrim(coalesce(e#>>'{source,url}','')))='N/A'
        or lower(coalesce(e#>>'{source,url}','')) like 'file_id:%'
        or lower(coalesce(e#>>'{source,publisher}','')) like 'internal%'
        or lower(coalesce(e#>>'{source,publisher}','')) in('agent','general industry standard')
      );

    select count(*) into v_external_sources
    from jsonb_array_elements(v_ev->'evidence_entries') e
    where nullif(btrim(coalesce(e#>>'{source,url}','')),'') is not null
      and upper(btrim(coalesce(e#>>'{source,url}','')))<>'N/A'
      and lower(coalesce(e#>>'{source,url}','')) not like 'file_id:%'
      and lower(coalesce(e#>>'{source,publisher}','')) not like 'internal%'
      and lower(coalesce(e#>>'{source,publisher}','')) not in('agent','general industry standard');
  end if;

  if v_unbacked_verified>0 then
    v_failures:=array_append(v_failures,'verified_claims_without_independent_provenance');
  end if;
  if v_ev_file is not null and v_external_sources<3 then
    v_failures:=array_append(v_failures,'fewer_than_three_traceable_external_sources');
  end if;
  if v_cross_file is not null and (v_cross is null or jsonb_typeof(v_cross)<>'object') then
    v_failures:=array_append(v_failures,'cross_unit_reconciliation_not_valid_json');
  end if;
  if v_board_file is not null and (v_board is null or jsonb_typeof(v_board)<>'object') then
    v_failures:=array_append(v_failures,'board_decision_not_valid_json');
  end if;

  v_ready:=coalesce(array_length(v_failures,1),0)=0;
  return jsonb_build_object(
    'version','cap515_reconciliation_preflight_v0_2_nonempty_files',
    'work_id',v_work.work_id,'ready_for_operator_review',v_ready,
    'failures',to_jsonb(v_failures),
    'files',jsonb_build_object('canonical',v_canon_file,'financial',v_fin_file,'evidence',v_ev_file,'cross_unit',v_cross_file,'board',v_board_file),
    'checks',jsonb_build_object(
      'stated_discount_rate',v_discount,
      'ltv_formula_mentions_discount',case when v_discount<=0 then true else (v_formula like '%discount%' or v_formula like '%present value%') end,
      'unbacked_verified_claims',v_unbacked_verified,
      'traceable_external_source_count',v_external_sources),
    'rule','This preflight ignores zero-byte/phantom artifacts and checks minimum mechanical/evidence integrity only. Passing it does not award CAP515 or release the assessment hold.'
  );
end;
$function$;

COMMIT;
