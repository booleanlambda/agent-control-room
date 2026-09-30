-- QDA-601 independent authenticator routing v0.1
begin;

create table if not exists agent_lab.qda601_authenticator_reviews (
  review_id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agent_lab.agents(agent_id) on delete cascade,
  file_id uuid not null unique references agent_lab.agent_files(file_id) on delete cascade,
  unit_code text not null,
  artifact_sha256 text not null,
  status text not null default 'queued' check (status in ('queued','claimed','completed','failed')),
  authenticator_model_requested text not null default 'moonshotai/kimi-k3',
  authenticator_model_returned text,
  score numeric,
  verdict text,
  report jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  claimed_by text,
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists qda601_authenticator_reviews_queue_idx
  on agent_lab.qda601_authenticator_reviews(status,created_at);
alter table agent_lab.qda601_authenticator_reviews enable row level security;
revoke all on agent_lab.qda601_authenticator_reviews from public,anon,authenticated;

create or replace function agent_lab.enqueue_qda601_authenticator_review_v0_1()
returns trigger language plpgsql security definer
set search_path to 'pg_catalog','agent_lab','extensions' as $$
declare v_unit text; v_sha text;
begin
  if new.filename !~ '^QDA601_M[0-9]+_U[0-9]+\.json$' or coalesce(new.inline_text,'')='' then return new; end if;
  v_unit:=replace(regexp_replace(new.filename,'\.json$',''),'_','-');
  v_sha:=encode(extensions.digest(convert_to(new.inline_text,'UTF8'),'sha256'),'hex');
  insert into agent_lab.qda601_authenticator_reviews(agent_id,file_id,unit_code,artifact_sha256,status)
  values(new.agent_id,new.file_id,v_unit,v_sha,'queued') on conflict(file_id) do nothing;
  return new;
end $$;
drop trigger if exists qda601_authenticator_review_enqueue on agent_lab.agent_files;
create trigger qda601_authenticator_review_enqueue after insert on agent_lab.agent_files
for each row execute function agent_lab.enqueue_qda601_authenticator_review_v0_1();

create or replace function public.aau_bridge_claim_qda601_authenticator_review(
 p_bridge_token text,p_executor_id text
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public','agent_lab' as $$
declare v agent_lab.qda601_authenticator_reviews%rowtype; v_artifact text;
begin
 perform agent_lab.assert_broker_bridge_token(p_bridge_token);
 if length(btrim(coalesce(p_executor_id,'')))<3 then raise exception 'qda_authenticator_executor_required'; end if;
 select * into v from agent_lab.qda601_authenticator_reviews
 where status='queued' and attempts<4 order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 update agent_lab.qda601_authenticator_reviews
 set status='claimed',claimed_by=p_executor_id,claimed_at=now(),attempts=attempts+1,last_error=null,updated_at=now()
 where review_id=v.review_id returning * into v;
 select inline_text into v_artifact from agent_lab.agent_files where file_id=v.file_id;
 if coalesce(v_artifact,'')='' then
   update agent_lab.qda601_authenticator_reviews set status='failed',last_error='frozen_artifact_missing',updated_at=now() where review_id=v.review_id;
   raise exception 'qda_authenticator_frozen_artifact_missing:%',v.review_id;
 end if;
 return jsonb_build_object('status','claimed','review_id',v.review_id,'agent_id',v.agent_id,'file_id',v.file_id,
   'unit_code',v.unit_code,'artifact_sha256',v.artifact_sha256,'artifact',v_artifact,
   'authenticator_model_requested',v.authenticator_model_requested,'attempts',v.attempts);
end $$;

create or replace function public.aau_bridge_complete_qda601_authenticator_review(
 p_bridge_token text,p_review_id uuid,p_executor_id text,p_model_returned text,p_score numeric,p_verdict text,p_report jsonb
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public','agent_lab' as $$
declare v agent_lab.qda601_authenticator_reviews%rowtype;
begin
 perform agent_lab.assert_broker_bridge_token(p_bridge_token);
 select * into v from agent_lab.qda601_authenticator_reviews where review_id=p_review_id for update;
 if not found then raise exception 'qda_authenticator_review_not_found'; end if;
 if v.status<>'claimed' then raise exception 'qda_authenticator_review_not_claimed'; end if;
 if v.claimed_by is distinct from p_executor_id then raise exception 'qda_authenticator_claim_owner_mismatch'; end if;
 if p_verdict not in ('verified_pass','verified_fail') then raise exception 'qda_authenticator_verdict_invalid'; end if;
 if p_score is null or p_score<0 or p_score>1 then raise exception 'qda_authenticator_score_invalid'; end if;
 update agent_lab.qda601_authenticator_reviews set status='completed',authenticator_model_returned=p_model_returned,
   score=p_score,verdict=p_verdict,report=coalesce(p_report,'{}'::jsonb),completed_at=now(),updated_at=now(),last_error=null
 where review_id=p_review_id returning * into v;
 update agent_lab.agent_files set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
   'qda601_authenticator_review_id',v.review_id,'qda601_authenticator_status',v.verdict,
   'qda601_authenticator_score',v.score,'qda601_authenticator_model',v.authenticator_model_returned,
   'qda601_authenticator_artifact_sha256',v.artifact_sha256),updated_at=now()
 where file_id=v.file_id;
 return jsonb_build_object('ok',true,'review_id',v.review_id,'unit_code',v.unit_code,'verdict',v.verdict,
   'score',v.score,'authenticator_model',v.authenticator_model_returned,'artifact_sha256',v.artifact_sha256);
end $$;

create or replace function public.aau_bridge_release_qda601_authenticator_review(
 p_bridge_token text,p_review_id uuid,p_executor_id text,p_error text
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public','agent_lab' as $$
declare v agent_lab.qda601_authenticator_reviews%rowtype; v_next text;
begin
 perform agent_lab.assert_broker_bridge_token(p_bridge_token);
 select * into v from agent_lab.qda601_authenticator_reviews where review_id=p_review_id for update;
 if not found then raise exception 'qda_authenticator_review_not_found'; end if;
 if v.status<>'claimed' or v.claimed_by is distinct from p_executor_id then raise exception 'qda_authenticator_release_owner_mismatch'; end if;
 v_next:=case when v.attempts>=4 then 'failed' else 'queued' end;
 update agent_lab.qda601_authenticator_reviews set status=v_next,claimed_by=null,claimed_at=null,
   last_error=left(coalesce(p_error,'unknown_error'),1500),updated_at=now()
 where review_id=p_review_id returning * into v;
 return jsonb_build_object('ok',true,'review_id',v.review_id,'status',v.status,'attempts',v.attempts);
end $$;

revoke all on function public.aau_bridge_claim_qda601_authenticator_review(text,text) from public;
revoke all on function public.aau_bridge_complete_qda601_authenticator_review(text,uuid,text,text,numeric,text,jsonb) from public;
revoke all on function public.aau_bridge_release_qda601_authenticator_review(text,uuid,text,text) from public;
grant execute on function public.aau_bridge_claim_qda601_authenticator_review(text,text) to anon,authenticated;
grant execute on function public.aau_bridge_complete_qda601_authenticator_review(text,uuid,text,text,numeric,text,jsonb) to anon,authenticated;
grant execute on function public.aau_bridge_release_qda601_authenticator_review(text,uuid,text,text) to anon,authenticated;

commit;
