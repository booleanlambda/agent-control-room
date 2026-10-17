create schema if not exists aau_research_v19;

revoke all on schema aau_research_v19 from public;

create table aau_research_v19.runs (run_id uuid primary key, problem_hash text not null check(length(problem_hash)=64),
 expected_roots int not null check(expected_roots between 1 and 32),incumbent bigint not null check(incumbent>=0),created_at timestamptz default now());

create table aau_research_v19.branches (run_id uuid references aau_research_v19.runs(run_id),
 id text not null,root_hash text not null check(length(root_hash)=64),status text not null default 'pending' check(status in ('pending','leased','done')),
 fence bigint not null default 0,worker text,lease_until timestamptz,attempts int not null default 0,
 exact_cost bigint,leaves bigint,receipt text,
 primary key(run_id,id),check((status='done' and exact_cost>=0 and leaves>0 and length(receipt)=64) or
 (status<>'done' and exact_cost is null and leaves is null and receipt is null)));

create table aau_research_v19.events (seq bigint generated always as identity primary key,
 run_id uuid not null,id text not null,kind text not null,epoch bigint not null,at timestamptz default now());

alter table aau_research_v19.runs enable row level security;

alter table aau_research_v19.branches enable row level security;

alter table aau_research_v19.events enable row level security;

revoke all on all tables in schema aau_research_v19 from public;

create or replace function aau_research_v19.claim(p_run uuid,p_id text,p_worker text,p_seconds int default 90)
returns table(ok boolean, epoch bigint) language plpgsql security invoker set search_path=pg_catalog,aau_research_v19 as $$
declare e bigint;
begin
 if p_worker is null or length(p_worker) not between 1 and 80 or p_seconds not between 1 and 900 then raise exception 'BAD_CLAIM'; end if;
 update aau_research_v19.branches set status='leased',fence=fence+1,worker=p_worker,
 lease_until=clock_timestamp()+make_interval(secs=>p_seconds),attempts=attempts+1
 where run_id=p_run and id=p_id and (status='pending' or (status='leased' and lease_until<=clock_timestamp()))
 returning fence into e;
 if e is null then return query select false,0::bigint;
 else
 insert into aau_research_v19.events(run_id,id,kind,epoch) values(p_run,p_id,'claim',e);
 return query select true,e;
 end if;
end $$;

create or replace function aau_research_v19.complete(p_run uuid,p_id text,p_worker text,p_epoch bigint,
p_cost bigint,p_leaves bigint,p_receipt text) returns text
language plpgsql security invoker set search_path=pg_catalog,aau_research_v19 as $$
declare r aau_research_v19.branches%rowtype;
begin
 if p_cost is null or p_cost<0 or p_leaves is null or p_leaves<1 or p_receipt is null or length(p_receipt)<>64
 then raise exception 'BAD_RECEIPT';end if;
 select * into r from aau_research_v19.branches where run_id=p_run and id=p_id for update;
 if not found then return 'UNKNOWN';end if;
 if r.status='done' then
   if r.exact_cost=p_cost and r.leaves=p_leaves and r.receipt=p_receipt then return 'DUPLICATE';end if;
   return 'CONFLICT';
 end if;
 if r.status<>'leased' or r.worker is distinct from p_worker or
 r.fence is distinct from p_epoch or r.lease_until<=clock_timestamp() then return 'STALE';end if;
 update aau_research_v19.branches
 set status='done',exact_cost=p_cost,leaves=p_leaves,receipt=p_receipt,lease_until=null
 where run_id=p_run and id=p_id;
 insert into aau_research_v19.events(run_id,id,kind,epoch) values(p_run,p_id,'complete',p_epoch);
 return 'COMMITTED';
end $$;

create or replace function aau_research_v19.summary(p_run uuid)
returns table(total int,completed int,pending int,lower_bound bigint,upper_bound bigint,gap bigint,optimal boolean)
language sql stable security invoker set search_path=pg_catalog,aau_research_v19 as $$
with a as (select r.expected_roots,r.incumbent,
 count(b.id)::int as n,count(b.id) filter(where b.status='done')::int as finished,
 count(b.id) filter(where b.status<>'done')::int as unfinished,
 min(b.exact_cost) filter(where b.status='done') as minimum
 from aau_research_v19.runs r left join aau_research_v19.branches b on r.run_id=b.run_id
 where r.run_id=p_run group by r.expected_roots,r.incumbent),
 x as (select *,least(incumbent,coalesce(minimum,incumbent)) as upper_cost,
 case when unfinished>0 then 0::bigint else minimum end as lower_cost from a)
select n,finished,unfinished,lower_cost,upper_cost,upper_cost-lower_cost,
(n=expected_roots and unfinished=0 and lower_cost=upper_cost)
from x where n=expected_roots and lower_cost is not null
$$;

revoke all on all functions in schema aau_research_v19 from public;
