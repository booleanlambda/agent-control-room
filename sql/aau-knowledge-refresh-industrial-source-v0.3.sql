-- AAU optional industrial-sector observations through the Federal Reserve's official G.17 announcement feed.
-- Delivers bounded headline-only knowledge; not stock-market sector returns.
INSERT INTO agent_lab.knowledge_refresh_sources(source_key,publisher,endpoint,source_host,component,topic,adapter,enabled,poll_interval_seconds,max_items)
VALUES ('fed_industrial_rss','Federal Reserve','https://www.federalreserve.gov/feeds/g17.xml','www.federalreserve.gov','peripheral','industrial_sector_indicators','rss',true,86400,5)
ON CONFLICT(source_key) DO NOTHING;
