
BEGIN;

CREATE OR REPLACE FUNCTION agent_lab.cap515_reconciliation_preflight_v0_1(p_agent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog','agent_lab'
AS $function$
declare
  v_work agent_lab.complex_work_pilots%rowtype;
  v_canon_file uuid; v_fin_file uuid; v_ev_file uuid; v_cross_file uuid; v_board_file uuid;
  v_canon jsonb; v_fin jsonb; v_ev jsonb; v_cross jsonb; v_board jsonb;
  v_evidence_rows jsonb:='[]'::jsonb;
  v_discount numeric:=0;
  v_formula text:='';
  v_unbacked_verified int:=0;
  v_external_sources int:=0;
  v_receipt_sources int:=0;
  v_missing int:=0;
  v_failures text[]:='{}';
  v_ready boolean:=false;
  v_canon_ltv numeric; v_fin_ltv numeric;
  v_canon_ratio numeric; v_fin_ratio numeric;
  v_tmp text; v_match text[];
  v_cross_canon uuid; v_board_canon uuid;
begin
  select * into v_work
  from agent_lab.complex_work_pilots
  where agent_id=p_agent_id
    and metadata->>'assessment_release_state'='held_pending_operator_preflight'
    and status in('draft','in_progress','blocked','submitted')
  order by created_at desc limit 1;

  if not found then
    return jsonb_build_object('ready_for_operator_review',false,'reason','no_active_cap515_preflight_work');
  end if;

  select file_id,agent_lab.try_parse_jsonb_v0_1(inline_text) into v_canon_file,v_canon
  from agent_lab.agent_files
  where agent_id=p_agent_id and created_at>=v_work.created_at
    and upper(filename) like 'CANONICAL_VENTURE_MODEL%'
    and length(btrim(coalesce(inline_text,'')))>0
    and coalesce((metadata->>'invalid_empty_output')::boolean,false)=false
  order by created_at desc limit 1;

  select file_id,agent_lab.try_parse_jsonb_v0_1(inline_text) into v_fin_file,v_fin
  from agent_lab.agent_files
  where agent_id=p_agent_id and created_at>=v_work.created_at
    and upper(filename) like 'FINANCIAL_CHECKS%'
    and length(btrim(coalesce(inline_text,'')))>0
    and coalesce((metadata->>'invalid_empty_output')::boolean,false)=false
  order by created_at desc limit 1;

  select file_id,agent_lab.try_parse_jsonb_v0_1(inline_text) into v_ev_file,v_ev
  from agent_lab.agent_files
  where agent_id=p_agent_id and created_at>=v_work.created_at
    and upper(filename) like 'CLAIM_EVIDENCE_REGISTER%'
    and length(btrim(coalesce(inline_text,'')))>0
    and coalesce((metadata->>'invalid_empty_output')::boolean,false)=false
  order by created_at desc limit 1;

  select file_id,agent_lab.try_parse_jsonb_v0_1(inline_text) into v_cross_file,v_cross
  from agent_lab.agent_files
  where agent_id=p_agent_id and created_at>=v_work.created_at
    and upper(filename) like 'CROSS_UNIT_RECONCILIATION%'
    and length(btrim(coalesce(inline_text,'')))>0
    and coalesce((metadata->>'invalid_empty_output')::boolean,false)=false
  order by created_at desc limit 1;

  select file_id,agent_lab.try_parse_jsonb_v0_1(inline_text) into v_board_file,v_board
  from agent_lab.agent_files
  where agent_id=p_agent_id and created_at>=v_work.created_at
    and upper(filename) like 'BOARD_DECISION%'
    and length(btrim(coalesce(inline_text,'')))>0
    and coalesce((metadata->>'invalid_empty_output')::boolean,false)=false
  order by created_at desc limit 1;

  v_missing:=(case when v_canon_file is null then 1 else 0 end)
    +(case when v_fin_file is null then 1 else 0 end)
    +(case when v_ev_file is null then 1 else 0 end)
    +(case when v_cross_file is null then 1 else 0 end)
    +(case when v_board_file is null then 1 else 0 end);
  if v_missing>0 then v_failures:=array_append(v_failures,'required_artifacts_missing'); end if;

  if coalesce(v_canon#>>'{unit_economics,discount_rate}','') ~ '^[0-9]+([.][0-9]+)?$' then
    v_discount:=(v_canon#>>'{unit_economics,discount_rate}')::numeric;
  elsif coalesce(v_fin#>>'{canonical_inputs,unit_economics,discount_rate}','') ~ '^[0-9]+([.][0-9]+)?$' then
    v_discount:=(v_fin#>>'{canonical_inputs,unit_economics,discount_rate}')::numeric;
  end if;

  v_formula:=lower(coalesce(
    nullif(v_fin#>>'{checks,ltv_calculation,formula}',''),
    nullif(v_fin#>>'{calculations,ltv_recomputation,methodology}',''),
    nullif(v_fin#>>'{ltv_calculation,formula}',''),
    ''
  ));
  if v_fin_file is not null and v_discount>0
     and v_formula not like '%discount%'
     and v_formula not like '%present value%'
     and v_formula not like '%churn%+%discount%' then
    v_failures:=array_append(v_failures,'ltv_formula_omits_stated_discount_rate');
  end if;

  if coalesce(v_canon#>>'{unit_economics,ltv_calculated}','') ~ '^[0-9]+([.][0-9]+)?$' then
    v_canon_ltv:=(v_canon#>>'{unit_economics,ltv_calculated}')::numeric;
  end if;
  if coalesce(v_canon#>>'{unit_economics,ltv_cac_ratio}','') ~ '^[0-9]+([.][0-9]+)?$' then
    v_canon_ratio:=(v_canon#>>'{unit_economics,ltv_cac_ratio}')::numeric;
  end if;

  v_tmp:=coalesce(v_fin#>>'{calculations,ltv_recomputation,ltv_result}','');
  if v_tmp<>'' then
    v_match:=regexp_match(v_tmp,'([0-9][0-9,]*([.][0-9]+)?)\s*$');
    if v_match is not null then v_fin_ltv:=replace(v_match[1],',','')::numeric; end if;
  end if;
  v_tmp:=coalesce(v_fin#>>'{calculations,efficiency_metrics,ltv_cac_ratio}','');
  if v_tmp<>'' then
    v_match:=regexp_match(lower(v_tmp),'([0-9]+([.][0-9]+)?)x\s*$');
    if v_match is not null then v_fin_ratio:=v_match[1]::numeric; end if;
  end if;

  if v_canon_ltv is not null and v_fin_ltv is not null
     and abs(v_canon_ltv-v_fin_ltv)>100 then
    v_failures:=array_append(v_failures,'canonical_financial_ltv_mismatch');
  end if;
  if v_canon_ratio is not null and v_fin_ratio is not null
     and abs(v_canon_ratio-v_fin_ratio)>0.02 then
    v_failures:=array_append(v_failures,'canonical_financial_ltv_cac_mismatch');
  end if;

  -- Support every CAP515 evidence-register schema emitted so far:
  -- evidence_entries[], evidence_ledger[], and claims[] with evidence.source_url.
  v_evidence_rows:=case
    when jsonb_typeof(v_ev->'evidence_entries')='array' then v_ev->'evidence_entries'
    when jsonb_typeof(v_ev->'evidence_ledger')='array' then v_ev->'evidence_ledger'
    when jsonb_typeof(v_ev->'claims')='array' then v_ev->'claims'
    else '[]'::jsonb end;

  if jsonb_array_length(v_evidence_rows)>0 then
    select count(*) into v_unbacked_verified
    from jsonb_array_elements(v_evidence_rows) e
    where upper(coalesce(e->>'verification_status',e->>'status',''))='VERIFIED'
      and lower(coalesce(e->>'classification',e->>'status','')) not in
          ('arithmetic_derivation','internal_calculation','arithmetic')
      and (
        nullif(btrim(coalesce(e#>>'{source,url}',e#>>'{evidence,source_url}','')),'') is null
        or coalesce(e#>>'{source,url}',e#>>'{evidence,source_url}','') !~* '^https://'
      );

    select count(distinct coalesce(e#>>'{source,url}',e#>>'{evidence,source_url}'))
      into v_external_sources
    from jsonb_array_elements(v_evidence_rows) e
    where coalesce(e#>>'{source,url}',e#>>'{evidence,source_url}','') ~* '^https://';

    select count(distinct coalesce(e#>>'{source,url}',e#>>'{evidence,source_url}'))
      into v_receipt_sources
    from jsonb_array_elements(v_evidence_rows) e
    where coalesce(e#>>'{source,url}',e#>>'{evidence,source_url}','') ~* '^https://'
      and exists(
        select 1
        from agent_lab.agent_web_research_batches b
        cross join lateral jsonb_array_elements(coalesce(b.receipts,'[]'::jsonb)) r
        where b.agent_id=p_agent_id
          and b.created_at>=v_work.created_at
          and r->>'url'=coalesce(e#>>'{source,url}',e#>>'{evidence,source_url}')
          and r->>'fetch_status'='fetched_text'
          and coalesce(r->>'sha256','') ~ '^[a-fA-F0-9]{64}$'
          and (
            nullif(coalesce(e#>>'{evidence,sha256}',e#>>'{source,sha256}',''),'') is null
            or lower(r->>'sha256')=lower(coalesce(e#>>'{evidence,sha256}',e#>>'{source,sha256}'))
          )
      );
  end if;

  if v_unbacked_verified>0 then
    v_failures:=array_append(v_failures,'verified_claims_without_independent_provenance');
  end if;
  if v_ev_file is not null and v_receipt_sources<3 then
    v_failures:=array_append(v_failures,'fewer_than_three_receipt_backed_external_sources');
  end if;

  if v_cross_file is not null and (v_cross is null or jsonb_typeof(v_cross)<>'object') then
    v_failures:=array_append(v_failures,'cross_unit_reconciliation_not_valid_json');
  end if;
  if v_board_file is not null and (v_board is null or jsonb_typeof(v_board)<>'object') then
    v_failures:=array_append(v_failures,'board_decision_not_valid_json');
  end if;

  begin v_cross_canon:=nullif(v_cross#>>'{canonical_model_reference,file_id}','')::uuid; exception when others then v_cross_canon:=null; end;
  begin v_board_canon:=nullif(v_board#>>'{canonical_model_reference,file_id}','')::uuid; exception when others then v_board_canon:=null; end;

  if v_cross_file is not null and (
      v_cross_canon is null or v_cross_canon<>v_canon_file or
      not exists(select 1 from agent_lab.agent_files f where f.file_id=v_cross_canon and f.agent_id=p_agent_id
        and length(btrim(coalesce(f.inline_text,'')))>0
        and coalesce((f.metadata->>'invalid_empty_output')::boolean,false)=false)
    ) then
    v_failures:=array_append(v_failures,'cross_unit_not_bound_to_latest_substantive_canonical');
  end if;

  if v_board_file is not null and (
      v_board_canon is null or v_board_canon<>v_canon_file or
      not exists(select 1 from agent_lab.agent_files f where f.file_id=v_board_canon and f.agent_id=p_agent_id
        and length(btrim(coalesce(f.inline_text,'')))>0
        and coalesce((f.metadata->>'invalid_empty_output')::boolean,false)=false)
    ) then
    v_failures:=array_append(v_failures,'board_not_bound_to_latest_substantive_canonical');
  end if;

  v_ready:=coalesce(array_length(v_failures,1),0)=0;

  return jsonb_build_object(
    'version','cap515_reconciliation_preflight_v0_4_evidence_schema_compat',
    'work_id',v_work.work_id,
    'ready_for_operator_review',v_ready,
    'failures',to_jsonb(v_failures),
    'files',jsonb_build_object(
      'canonical',v_canon_file,'financial',v_fin_file,'evidence',v_ev_file,
      'cross_unit',v_cross_file,'board',v_board_file),
    'checks',jsonb_build_object(
      'stated_discount_rate',v_discount,
      'ltv_formula_mentions_discount',case when v_discount<=0 then true else
        (v_formula like '%discount%' or v_formula like '%present value%' or v_formula like '%churn%+%discount%') end,
      'canonical_ltv',v_canon_ltv,'financial_ltv',v_fin_ltv,
      'canonical_ltv_cac',v_canon_ratio,'financial_ltv_cac',v_fin_ratio,
      'unbacked_verified_claims',v_unbacked_verified,
      'traceable_https_source_count',v_external_sources,
      'receipt_backed_external_source_count',v_receipt_sources),
    'rule','Minimum mechanical/evidence integrity only. Evidence schema compatibility includes claims[]. External sources count only when exact URL (and SHA when supplied) matches a persisted fetched-text research receipt. Passing does not award CAP515 or release the assessment hold.'
  );
end;
$function$;

REVOKE ALL ON FUNCTION agent_lab.cap515_reconciliation_preflight_v0_1(uuid)
FROM PUBLIC,anon,authenticated;

COMMIT;
