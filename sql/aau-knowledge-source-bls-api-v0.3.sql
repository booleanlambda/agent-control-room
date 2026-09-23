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

commit;
