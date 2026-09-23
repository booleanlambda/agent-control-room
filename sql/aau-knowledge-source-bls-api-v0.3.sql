-- AAU knowledge refresh v0.3: replace blocked BLS RSS with the official
-- BLS Public Data API latest-series endpoints. Source attribution remains
-- distinct from independent factual verification.
begin;

alter table agent_lab.knowledge_refresh_sources
  drop constraint if exists knowledge_refresh_sources_adapter_check;
alter table agent_lab.knowledge_refresh_sources
  add constraint knowledge_refresh_sources_adapter_check
  check (adapter = any (array[
    'rss'::text,
    'world_bank_indicator'::text,
    'bls_latest_series'::text
  ]));

update agent_lab.knowledge_refresh_sources
set enabled=false,updated_at=now(),
    last_error=coalesce(last_error,'')
      ||case when coalesce(last_error,'')='' then '' else '; ' end
      ||'disabled_after_repeated_http_403_use_official_bls_public_api'
where source_key='bls_latest_rss';

insert into agent_lab.knowledge_refresh_sources(
  source_key,publisher,endpoint,source_host,component,topic,adapter,enabled,
  poll_interval_seconds,max_items,last_checked_at,last_success_at,
  consecutive_failures,last_error
) values
(
 'bls_cpi_u_latest','U.S. Bureau of Labor Statistics',
 'https://api.bls.gov/publicAPI/v2/timeseries/data/CUUR0000SA0?latest=true',
 'api.bls.gov','general','us_inflation','bls_latest_series',true,
 3600,1,null,null,0,null
),
(
 'bls_unemployment_latest','U.S. Bureau of Labor Statistics',
 'https://api.bls.gov/publicAPI/v2/timeseries/data/LNS14000000?latest=true',
 'api.bls.gov','general','us_labor_market','bls_latest_series',true,
 3600,1,null,null,0,null
)
on conflict(source_key) do update set
 publisher=excluded.publisher,
 endpoint=excluded.endpoint,
 source_host=excluded.source_host,
 component=excluded.component,
 topic=excluded.topic,
 adapter=excluded.adapter,
 enabled=true,
 poll_interval_seconds=excluded.poll_interval_seconds,
 max_items=excluded.max_items,
 updated_at=now(),
 consecutive_failures=0,
 last_error=null;


-- Persist the adapter/fact-kind contract used by the live recorder.
CREATE OR REPLACE FUNCTION agent_lab.record_knowledge_source_refresh_v0_3(p_source_key text, p_items jsonb, p_error text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
DECLARE v_src agent_lab.knowledge_refresh_sources%rowtype;
 v_row jsonb;v_item_id uuid;v_external text;v_claim text;v_link text;v_pub timestamptz;
 v_period text;v_kind text;v_added integer:=0;v_rejected integer:=0;
 v_old agent_lab.knowledge_seed_packages%rowtype;v_new uuid;
 v_snapshot jsonb;v_version text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('aau_knowledge_refresh_publish_v0_3'));
 SELECT * INTO v_src FROM agent_lab.knowledge_refresh_sources
  WHERE source_key=p_source_key FOR UPDATE;
 IF NOT FOUND OR NOT v_src.enabled THEN
   RETURN jsonb_build_object('status','source_disabled_or_missing','source',p_source_key);
 END IF;
 IF p_error IS NOT NULL THEN
   UPDATE agent_lab.knowledge_refresh_sources SET last_checked_at=now(),
    consecutive_failures=consecutive_failures+1,last_error=left(p_error,400),updated_at=now()
   WHERE source_key=p_source_key;
   RETURN jsonb_build_object('status','source_failed','source',p_source_key);
 END IF;
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)>v_src.max_items THEN
   RAISE EXCEPTION 'knowledge_refresh_invalid_batch';
 END IF;
 FOR v_row IN SELECT value FROM jsonb_array_elements(p_items) LOOP
   v_external:=left(trim(coalesce(v_row->>'external_id','')),200);
   v_claim:=left(trim(coalesce(v_row->>'claim','')),650);
   v_link:=left(trim(coalesce(v_row->>'source_url','')),1200);
   v_period:=left(trim(coalesce(v_row->>'observation_period','')),100);
   v_kind:=coalesce(v_row->>'fact_kind','');
   IF v_external='' OR length(v_claim)<12 OR v_period='' OR
     v_link NOT LIKE 'https://' || v_src.source_host || '/%' OR
     v_kind NOT IN ('publisher_headline','dated_reference_statistic') OR
     (v_src.adapter='rss' AND v_kind<>'publisher_headline') OR
     (v_src.adapter='world_bank_indicator' AND v_kind<>'dated_reference_statistic') OR
     (v_src.adapter='bls_latest_series' AND v_kind<>'dated_reference_statistic') OR
     (v_row->>'published_at') IS NULL OR
     (v_row->>'published_at') !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d' THEN
     RAISE EXCEPTION 'knowledge_refresh_invalid_item';
   END IF;
   v_pub:=(v_row->>'published_at')::timestamptz;
   IF v_pub > now()+interval '24 hours' OR v_pub < now()-interval '450 days' THEN
     RAISE EXCEPTION 'knowledge_refresh_publication_date_out_of_bounds';
   END IF;
   INSERT INTO agent_lab.knowledge_refresh_items(
     source_key,external_id,component,topic,claim,publisher,source_url,
     published_at,observation_period,fact_kind,metadata)
   VALUES (v_src.source_key,v_external,v_src.component,v_src.topic,v_claim,v_src.publisher,
     v_link,v_pub,v_period,v_kind,
     jsonb_build_object('source_type',v_src.adapter,'verification','source_attribution_only',
       'not_independently_factual_verification',v_kind='publisher_headline'))
   ON CONFLICT(source_key,external_id,component) DO NOTHING
   RETURNING item_id INTO v_item_id;
   IF v_item_id IS NOT NULL THEN v_added:=v_added+1; END IF;
   v_item_id:=NULL;
 END LOOP;
 UPDATE agent_lab.knowledge_refresh_sources SET last_checked_at=now(),
  last_success_at=now(),consecutive_failures=0,last_error=NULL,updated_at=now()
 WHERE source_key=p_source_key;
 IF v_added=0 THEN
  RETURN jsonb_build_object('status','unchanged','source',p_source_key,'new_items',0);
 END IF;
 SELECT * INTO v_old FROM agent_lab.knowledge_seed_packages WHERE status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'knowledge_active_seed_missing'; END IF;
 -- Maintain the original versioned birth facts plus latest bounded observations.
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_snapshot FROM (
   SELECT i.item_id,i.component,i.topic,i.claim,i.publisher,i.source_url,
     i.published_at,i.observation_period,i.fact_kind,i.metadata
   FROM agent_lab.knowledge_refresh_items i
   ORDER BY i.ingested_at DESC,i.item_id LIMIT 32
 ) x;
 SELECT s.factual_snapshot||v_snapshot INTO v_snapshot FROM agent_lab.knowledge_seed_packages s
   WHERE s.version='knowledge_pool_seed_v0_2';
 v_version:='knowledge_pool_refresh_'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS');
 UPDATE agent_lab.knowledge_seed_packages SET status='retired' WHERE seed_package_id=v_old.seed_package_id;
 INSERT INTO agent_lab.knowledge_seed_packages(
   version,status,general_topics,peripheral_topics,source_manifest,factual_snapshot,metadata)
 VALUES(v_version,'active',v_old.general_topics,v_old.peripheral_topics,
   v_old.source_manifest,v_snapshot,v_old.metadata||
   jsonb_build_object('kind','dated_shared_source_refresh','refreshed_at',now(),
     'refresh_source',p_source_key,'shared_ingestion',true,'broadcaster_reactivated',false))
 RETURNING seed_package_id INTO v_new;
 UPDATE agent_lab.agent_knowledge_pools SET seed_package_id=v_new,updated_at=now()
 WHERE seed_package_id=v_old.seed_package_id;
 RETURN jsonb_build_object('status','published','source',p_source_key,
   'new_items',v_added,'seed_version',v_version,'snapshot_items',jsonb_array_length(v_snapshot));
END
$function$
;

commit;
