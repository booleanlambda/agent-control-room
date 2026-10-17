create schema if not exists aau_research_v22;

revoke all on schema aau_research_v22 from public;

create table if not exists aau_research_v22.runs (
 run_id uuid primary key,
 mode text not null check(mode in ('serial','two_workers')),
 fixture_digest text not null check(length(fixture_digest)=64),
 expected_cases integer not null check(expected_cases=9),
 node_budget integer not null check(node_budget=2200),
 created_at timestamptz not null default now());

create table if not exists aau_research_v22.cases(
 run_id uuid not null references aau_research_v22.runs(run_id),
 id text not null, input_digest text not null check(length(input_digest)=64),
 status text not null default 'pending' check(status in ('pending','leased','done')),
 fence bigint not null default 0,
 worker text,lease_until timestamptz,
 attempts integer not null default 0,
 lower_bound bigint,upper_bound bigint,expanded integer,
 certificate_digest text,witness_digest text,solver_elapsed_ms double precision,
 primary key(run_id,id),
 check((status='done' and lower_bound is not null and upper_bound is not null
 and lower_bound>=0 and upper_bound>=lower_bound and expanded between 0 and 2200
 and length(certificate_digest)=64 and length(witness_digest)=64
 and solver_elapsed_ms>=0) or
 (status<>'done' and lower_bound is null and upper_bound is null
 and expanded is null and certificate_digest is null and witness_digest is null
 and solver_elapsed_ms is null)));

create table if not exists aau_research_v22.events(
 id bigint generated always as identity primary key,
 run_id uuid not null,
 case_id text not null,
 action text not null check(action in ('claim','complete')),
 fence bigint not null,created_at timestamptz not null default now());

create index if not exists v22_cases_by_status on aau_research_v22.cases(run_id,status,lease_until);

alter table aau_research_v22.runs enable row level security;

alter table aau_research_v22.cases enable row level security;

alter table aau_research_v22.events enable row level security;

revoke all on all tables in schema aau_research_v22 from public;

create or replace function aau_research_v22.claim(p_run uuid,p_case text,p_worker text,p_seconds integer default 90)
returns table(ok boolean,epoch bigint)
language plpgsql security invoker set search_path=pg_catalog,aau_research_v22 as $$
declare e bigint;
begin
 if p_worker is null or length(p_worker) not between 1 and 80 or p_seconds not between 1 and 900
 then raise exception 'INVALID_CLAIM';end if;
 update aau_research_v22.cases
 set status='leased',fence=fence+1,worker=p_worker,lease_until=clock_timestamp()+make_interval(secs=>p_seconds),attempts=attempts+1
 where run_id=p_run and id=p_case and (status='pending' or (status='leased' and lease_until<=clock_timestamp()))
 returning fence into e;
 if e is null then return query select false,0::bigint;
 else
 insert into aau_research_v22.events(run_id,case_id,action,fence) values(p_run,p_case,'claim',e);
 return query select true,e;
 end if;
end $$;

create or replace function aau_research_v22.complete(
 p_run uuid,p_case text,p_worker text,p_fence bigint,
 p_lower bigint,p_upper bigint,p_expanded integer,p_cert text,p_witness text,p_ms double precision)
returns text language plpgsql security invoker set search_path=pg_catalog,aau_research_v22 as $$
declare r aau_research_v22.cases%rowtype; max_nodes integer;
begin
 select * into r from aau_research_v22.cases where run_id=p_run and id=p_case for update;
 if not found then return 'UNKNOWN_CASE'; end if;
 select node_budget into max_nodes from aau_research_v22.runs where run_id=p_run;
 if p_lower is null or p_upper is null or p_lower<0 or p_upper<p_lower or
 p_expanded is null or p_expanded<0 or p_expanded>max_nodes or
 p_cert is null or length(p_cert)<>64 or p_witness is null or length(p_witness)<>64 or
 p_ms is null or p_ms<0 or not isfinite(p_ms) then
  return 'INVALID_CERTIFICATE';
 end if;
 if r.status='done' then
  if r.lower_bound=p_lower and r.upper_bound=p_upper and r.expanded=p_expanded
   and r.certificate_digest=p_cert and r.witness_digest=p_witness then return 'DUPLICATE';end if;
  return 'CONFLICT';
 end if;
 if r.status<>'leased' or r.worker is distinct from p_worker or
 r.fence is distinct from p_fence or r.lease_until<=clock_timestamp() then return 'STALE';end if;
 update aau_research_v22.cases set status='done',lower_bound=p_lower,upper_bound=p_upper,
 expanded=p_expanded,certificate_digest=p_cert,witness_digest=p_witness,solver_elapsed_ms=p_ms,
 lease_until=null where run_id=p_run and id=p_case;
 insert into aau_research_v22.events(run_id,case_id,action,fence)
 values(p_run,p_case,'complete',p_fence);
 return 'COMMITTED';
end $$;

create or replace function aau_research_v22.summary(p_run uuid)
returns table(mode text,total integer,complete integer,pending integer,
 summed_gap bigint,optimal_cases integer,sum_expanded bigint)
language sql stable security invoker set search_path=pg_catalog,aau_research_v22 as $$
 select r.mode,count(c.id)::integer,
 count(c.id) filter(where c.status='done')::integer,
 count(c.id) filter(where c.status<>'done')::integer,
 sum(c.upper_bound-c.lower_bound) filter(where c.status='done')::bigint,
 count(c.id) filter(where c.status='done' and c.lower_bound=c.upper_bound)::integer,
 sum(c.expanded) filter(where c.status='done')::bigint
 from aau_research_v22.runs r left join aau_research_v22.cases c on c.run_id=r.run_id
 where r.run_id=p_run group by r.mode
$$;

revoke all on all functions in schema aau_research_v22 from public;
