-- V20 isolated development branch ONLY: branch-scoping marker.
-- Applied and verified by Neon connector on br-cold-rice-b4m3l9qu.
create table if not exists aau_research_v19.integration_scope (
  branch_id text primary key,
  marker text not null
);
revoke all on aau_research_v19.integration_scope from public;
alter table aau_research_v19.integration_scope enable row level security;
insert into aau_research_v19.integration_scope(branch_id,marker)
values('br-cold-rice-b4m3l9qu','AAU_V20_ISOLATED_LIVE_WORKER')
on conflict(branch_id) do nothing;
