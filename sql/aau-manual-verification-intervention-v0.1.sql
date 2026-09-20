-- AAU MANUAL EXPERTISE VERIFICATION INTERVENTION v0.1 (Sep 20 2026)
-- Requires existing expertise_verification_runs and base AAU checkpoint/gate functions.
-- Bounded automatic retry; frozen evidence; operator-only model-assisted authentication
-- and adjudication; deterministic final gate; no change to candidate's bound model.
-- Control Room API and UI changes are deployed separately.
create table if not exists agent_lab.verification_intervention_alerts(
 verification_run_id uuid primary key references agent_lab.expertise_verification_runs(verification_run_id),
 agent_id uuid not null references agent_lab.agents(agent_id),
 expertise_artifact_id uuid not null references agent_lab.expertise_artifacts(expertise_artifact_id),
 status text not null default 'open' check(status in ('open','operator_requested','resolved')),
 failed_stage text not null,
 error_code text not null,
 error_message text,
 automatic_attempts integer not null,
 evidence_sha256 text not null,
 checkpoint_counts jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 resolved_at timestamptz,
 metadata jsonb not null default '{}'::jsonb
);
create index if not exists verification_intervention_alerts_open_idx
 on agent_lab.verification_intervention_alerts(created_at desc) where status in ('open','operator_requested');
do $constraint$
begin
 if not exists(
   select 1 from pg_constraint
   where conrelid='agent_lab.expertise_verification_runs'::regclass
   and conname='expertise_verification_runs_status_check'
   and pg_get_constraintdef(oid) like '%manual_required%'
 ) then
  alter table agent_lab.expertise_verification_runs
   drop constraint if exists expertise_verification_runs_status_check;
  alter table agent_lab.expertise_verification_runs
   add constraint expertise_verification_runs_status_check
   check(status in ('pending','claimed','running','verified_pass',
                    'verified_fail','failed','cancelled','manual_required'));
 end if;
end $constraint$;
revoke all on agent_lab.verification_intervention_alerts from public,anon,authenticated;
grant select,insert,update on agent_lab.verification_intervention_alerts to service_role;


CREATE OR REPLACE FUNCTION agent_lab.record_expired_verification_alert_v0_1(p_verification_run_id uuid, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare v agent_lab.expertise_verification_runs%rowtype;
  v_hash text;v_counts jsonb;v_stage text;
begin
 select * into v from agent_lab.expertise_verification_runs
 where verification_run_id=p_verification_run_id;
 if not found or v.status<>'manual_required' then
  raise exception 'manual_required_run_not_found';
 end if;
 v_counts:=jsonb_build_object(
 'challenge_tasks',case when jsonb_typeof(v.challenge_packet->'tasks')='array'
  then jsonb_array_length(v.challenge_packet->'tasks') else 0 end,
 'candidate_answers',case when jsonb_typeof(v.candidate_answers)='array'
  then jsonb_array_length(v.candidate_answers) else 0 end,
 'authenticator_grades',case when jsonb_typeof(v.authenticator_grades)='array'
  then jsonb_array_length(v.authenticator_grades) else 0 end,
 'adjudicator_grades',case when jsonb_typeof(v.adjudicator_grades)='array'
  then jsonb_array_length(v.adjudicator_grades) else 0 end);
 v_stage:=case
  when (v_counts->>'challenge_tasks')::int=0 then 'challenge'
  when (v_counts->>'candidate_answers')::int<(v_counts->>'challenge_tasks')::int then 'candidate'
  when (v_counts->>'authenticator_grades')::int<(v_counts->>'candidate_answers')::int then 'authentication'
  else 'adjudication_or_completion' end;
 v_hash:=encode(sha256(convert_to(jsonb_build_object(
 'challenge',coalesce(v.challenge_packet,'{}'::jsonb),
 'answers',coalesce(v.candidate_answers,'[]'::jsonb),
 'authenticator',coalesce(v.authenticator_grades,'[]'::jsonb),
 'adjudicator',coalesce(v.adjudicator_grades,'[]'::jsonb))::text,'UTF8')),'hex');
 insert into agent_lab.verification_intervention_alerts(
 verification_run_id,agent_id,expertise_artifact_id,status,failed_stage,error_code,
 error_message,automatic_attempts,evidence_sha256,checkpoint_counts,metadata)
 values(v.verification_run_id,v.agent_id,v.expertise_artifact_id,'open',v_stage,
 left(coalesce(p_code,'expired_verification_lease'),200),
 left(coalesce(v.metadata->>'last_error_message','Verification lease expired before completion'),2000),
 coalesce((v.metadata->>'attempt_count')::int,1),v_hash,v_counts,
 jsonb_build_object('source','expertise_verification_lease_recovery','verdict','not_produced'))
 on conflict(verification_run_id) do update set status='open',updated_at=now(),
 resolved_at=null,failed_stage=excluded.failed_stage,error_code=excluded.error_code,
 error_message=excluded.error_message,automatic_attempts=excluded.automatic_attempts,
 evidence_sha256=excluded.evidence_sha256,checkpoint_counts=excluded.checkpoint_counts,
 metadata=agent_lab.verification_intervention_alerts.metadata||jsonb_build_object('reopened_at',now());
 return jsonb_build_object('ok',true,'verification_run_id',v.verification_run_id,'stage',v_stage);
end $function$


CREATE OR REPLACE FUNCTION agent_lab.recover_expired_expertise_verifications_v0_1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare v agent_lab.expertise_verification_runs%rowtype;
 v_count int:=0;v_escalated int:=0;v_next text;
begin
 for v in select * from agent_lab.expertise_verification_runs
  where status in ('running','claimed')
    and nullif(metadata->>'claim_expires_at','') is not null
    and (metadata->>'claim_expires_at')::timestamptz<now()
  order by created_at for update skip locked
 loop
  v_next:=case
   when coalesce((v.metadata->>'manual_resume_active')::boolean,false)
       or coalesce((v.metadata->>'attempt_count')::int,1)>=2
    then 'manual_required' else 'pending' end;
  update agent_lab.expertise_verification_runs
   set status=v_next,updated_at=now(),
    metadata=(coalesce(metadata,'{}'::jsonb)-'claim_expires_at'-'retry_after_at')
      ||jsonb_build_object('recovered_at',now(),
       'recovery_reason','expired_running_or_claimed_verification_lease',
       'recovery_version','verification_bounded_retry_v0_1',
       'retry_after_at',case when v_next='pending' then now() else null end,
       'last_error_code','expired_verification_lease',
       'last_error_at',now(),
       'manual_required_at',case when v_next='manual_required' then now() else null end)
  where verification_run_id=v.verification_run_id;
  if v_next='manual_required' then
   perform agent_lab.record_expired_verification_alert_v0_1(
       v.verification_run_id,'expired_verification_lease');
   v_escalated:=v_escalated+1;
  end if;
  v_count:=v_count+1;
 end loop;
 return jsonb_build_object('recovered',v_count,'manual_alerts',v_escalated,
  'version','verification_bounded_retry_v0_1','checked_at',now());
end $function$


CREATE OR REPLACE FUNCTION agent_lab.operator_verification_alerts_v0_1(p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
select jsonb_build_object(
 'version','verification_manual_takeover_v0_1','checked_at',now(),
 'alerts',coalesce(jsonb_agg(jsonb_build_object(
   'verification_run_id',v.verification_run_id,
   'agent_id',v.agent_id,'agent_name',a.public_name,
   'domain',e.domain,'status',v.status,'failed_stage',v.failed_stage,
   'error_code',v.error_code,'error_message',v.error_message,
   'automatic_attempts',v.automatic_attempts,'checkpoint_counts',v.checkpoint_counts,
   'evidence_sha256',v.evidence_sha256,'created_at',v.created_at,
   'updated_at',v.updated_at,'run_status',r.status,
   'operator_action','Call on ChatGPT to inspect this run, then explicitly authorize recovery.'
  ) order by v.created_at desc),'[]'::jsonb))
from (select * from agent_lab.verification_intervention_alerts
      where status in ('open','operator_requested')
      order by created_at desc limit greatest(1,least(coalesce(p_limit,25),100))) v
join agent_lab.expertise_verification_runs r using(verification_run_id)
join agent_lab.agents a on a.agent_id=v.agent_id
join agent_lab.expertise_artifacts e on e.expertise_artifact_id=v.expertise_artifact_id;
$function$


CREATE OR REPLACE FUNCTION agent_lab.operator_verification_evidence_v0_1(p_verification_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare v_run agent_lab.expertise_verification_runs%rowtype;v_alert agent_lab.verification_intervention_alerts%rowtype;v_hash text;
begin
 select * into v_run from agent_lab.expertise_verification_runs where verification_run_id=p_verification_run_id;
 if not found then raise exception 'verification_run_not_found'; end if;
 select * into v_alert from agent_lab.verification_intervention_alerts where verification_run_id=p_verification_run_id;
 if not found then raise exception 'manual_intervention_alert_not_found'; end if;
 v_hash:=encode(sha256(convert_to(jsonb_build_object(
  'challenge',coalesce(v_run.challenge_packet,'{}'::jsonb),
  'answers',coalesce(v_run.candidate_answers,'[]'::jsonb),
  'authenticator',coalesce(v_run.authenticator_grades,'[]'::jsonb),
  'adjudicator',coalesce(v_run.adjudicator_grades,'[]'::jsonb))::text,'UTF8')),'hex');
 return jsonb_build_object('verification_run_id',v_run.verification_run_id,
  'agent_id',v_run.agent_id,'expertise_artifact_id',v_run.expertise_artifact_id,
  'run_status',v_run.status,'alert_status',v_alert.status,
  'failed_stage',v_alert.failed_stage,'error_code',v_alert.error_code,
  'evidence_sha256',v_hash,'frozen_hash_matches',v_hash=v_alert.evidence_sha256,
  'candidate_model',v_run.candidate_model_id,
  'challenge_packet',v_run.challenge_packet,'candidate_answers',v_run.candidate_answers,
  'authenticator_grades',v_run.authenticator_grades,'adjudicator_grades',v_run.adjudicator_grades,
  'checkpoint_stage',v_run.metadata->>'checkpoint_stage',
  'last_error',v_run.metadata->>'last_error_message',
  'verdict_available',v_run.verified_at is not null);
end $function$


CREATE OR REPLACE FUNCTION agent_lab.operator_resume_expertise_verification_v0_1(p_verification_run_id uuid, p_operator_id text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare v_run agent_lab.expertise_verification_runs%rowtype;
 v_alert agent_lab.verification_intervention_alerts%rowtype;
 v_hash text; v_answers int;v_tasks int;
begin
 if nullif(btrim(coalesce(p_operator_id,'')),'') is null or
   nullif(btrim(coalesce(p_reason,'')),'') is null then
  raise exception 'operator_id_and_reason_required';
 end if;
 select * into v_run from agent_lab.expertise_verification_runs
 where verification_run_id=p_verification_run_id for update;
 if not found then raise exception 'verification_run_not_found'; end if;
 select * into v_alert from agent_lab.verification_intervention_alerts
 where verification_run_id=p_verification_run_id for update;
 if not found then raise exception 'manual_intervention_alert_not_found'; end if;
 if v_run.status='pending' and v_alert.status='operator_requested' then
  return jsonb_build_object('status','already_requested','verification_run_id',p_verification_run_id);
 end if;
 if v_run.status<>'manual_required' or v_alert.status<>'open' or v_run.verified_at is not null then
  raise exception 'manual_takeover_requires_unresolved_open_alert';
 end if;
 v_tasks:=case when jsonb_typeof(v_run.challenge_packet->'tasks')='array'
  then jsonb_array_length(v_run.challenge_packet->'tasks') else 0 end;
 v_answers:=case when jsonb_typeof(v_run.candidate_answers)='array'
  then jsonb_array_length(v_run.candidate_answers) else 0 end;
 if v_tasks=0 or v_answers<>v_tasks then
  raise exception 'candidate_evidence_incomplete_manual_grading_unavailable';
 end if;
 v_hash:=encode(sha256(convert_to(jsonb_build_object(
  'challenge',coalesce(v_run.challenge_packet,'{}'::jsonb),
  'answers',coalesce(v_run.candidate_answers,'[]'::jsonb),
  'authenticator',coalesce(v_run.authenticator_grades,'[]'::jsonb),
  'adjudicator',coalesce(v_run.adjudicator_grades,'[]'::jsonb))::text,'UTF8')),'hex');
 if v_hash<>v_alert.evidence_sha256 then
   raise exception 'frozen_evidence_hash_mismatch';
 end if;
 update agent_lab.expertise_verification_runs
 set status='pending',updated_at=now(),
  metadata=(coalesce(metadata,'{}'::jsonb)-'claim_expires_at'-'retry_after_at'
    -'claimed_by'-'claimed_at')||jsonb_build_object(
      'manual_resume_active',true,'manual_resume_requested_at',now(),
      'manual_resume_operator',left(p_operator_id,180),
      'manual_resume_reason',left(p_reason,1000),
      'manual_resume_count',coalesce((metadata->>'manual_resume_count')::integer,0)+1,
      'manual_resume_evidence_sha256',v_hash,
      'manual_resume_policy','verification_manual_takeover_v0_1')
 where verification_run_id=p_verification_run_id;
 update agent_lab.verification_intervention_alerts
 set status='operator_requested',updated_at=now(),
  metadata=metadata||jsonb_build_object('operator_requested_at',now(),
   'operator_id',left(p_operator_id,180),'reason',left(p_reason,1000))
 where verification_run_id=p_verification_run_id;
 return jsonb_build_object('ok',true,'status','operator_requested',
   'verification_run_id',p_verification_run_id,
   'evidence_sha256',v_hash,'operator_id',left(p_operator_id,180),
   'note','The worker will resume saved authentication/adjudication; no verdict is implied.');
end $function$


CREATE OR REPLACE FUNCTION agent_lab.operator_begin_manual_grade_review_v0_1(p_verification_run_id uuid, p_operator_id text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare v agent_lab.expertise_verification_runs%rowtype;
 a agent_lab.verification_intervention_alerts%rowtype;v_hash text;v_candidate_hash text;
begin
 if nullif(btrim(coalesce(p_operator_id,'')),'') is null or length(btrim(coalesce(p_reason,'')))<10
 then raise exception 'operator_identity_and_substantive_reason_required';end if;
 select * into v from agent_lab.expertise_verification_runs where verification_run_id=p_verification_run_id for update;
 select * into a from agent_lab.verification_intervention_alerts where verification_run_id=p_verification_run_id for update;
 if not found then raise exception 'manual_intervention_alert_not_found';end if;
 if v.status<>'manual_required' or v.verified_at is not null then raise exception 'manual_review_requires_unresolved_run';end if;
 if a.status='operator_requested' and coalesce((v.metadata->>'manual_review_active')::boolean,false) then
  return jsonb_build_object('status','already_requested','verification_run_id',p_verification_run_id);
 end if;
 if a.status<>'open' then raise exception 'manual_review_alert_not_open';end if;
 if jsonb_typeof(v.challenge_packet->'tasks') is distinct from 'array'
    or jsonb_array_length(v.challenge_packet->'tasks')=0
    or jsonb_typeof(v.candidate_answers) is distinct from 'array'
    or jsonb_array_length(v.candidate_answers)<>jsonb_array_length(v.challenge_packet->'tasks')
 then raise exception 'complete_candidate_evidence_required';end if;
 v_hash:=encode(sha256(convert_to(jsonb_build_object(
  'challenge',coalesce(v.challenge_packet,'{}'::jsonb),
  'answers',coalesce(v.candidate_answers,'[]'::jsonb),
  'authenticator',coalesce(v.authenticator_grades,'[]'::jsonb),
  'adjudicator',coalesce(v.adjudicator_grades,'[]'::jsonb))::text,'UTF8')),'hex');
 if v_hash<>a.evidence_sha256 then raise exception 'frozen_checkpoint_mismatch';end if;
 v_candidate_hash:=encode(sha256(convert_to(jsonb_build_object(
  'challenge',v.challenge_packet,'answers',v.candidate_answers)::text,'UTF8')),'hex');
 update agent_lab.expertise_verification_runs
 set updated_at=now(),metadata=metadata||jsonb_build_object(
  'manual_review_active',true,'manual_review_operator',left(p_operator_id,180),
  'manual_review_started_at',now(),'manual_review_reason',left(p_reason,1000),
  'manual_candidate_snapshot_sha256',v_candidate_hash,
  'manual_review_protocol','operator_attested_model_review_v0_1')
 where verification_run_id=p_verification_run_id;
 update agent_lab.verification_intervention_alerts
 set status='operator_requested',updated_at=now(),
 metadata=metadata||jsonb_build_object('operator_id',left(p_operator_id,180),
  'manual_review_started_at',now(),'manual_candidate_snapshot_sha256',v_candidate_hash)
 where verification_run_id=p_verification_run_id;
 return jsonb_build_object('ok',true,'status','manual_review_in_progress',
  'verification_run_id',p_verification_run_id,'candidate_snapshot_sha256',v_candidate_hash,
  'note','Grade only the frozen candidate answers. No pass/fail verdict exists yet.');
end $function$


CREATE OR REPLACE FUNCTION agent_lab.operator_submit_expertise_grade_v0_1(p_verification_run_id uuid, p_operator_id text, p_stage text, p_task_id text, p_components jsonb, p_critical text, p_confidence numeric, p_unsupported boolean, p_review_model text, p_justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare v agent_lab.expertise_verification_runs%rowtype;
 v_a agent_lab.verification_intervention_alerts%rowtype;
 v_task jsonb;v_answer jsonb;v_prior jsonb;v_grade jsonb;
 v_key text;v_val numeric;v_score numeric:=0;v_weight numeric;
 v_hash text;v_array jsonb;v_critical text;
begin
 if p_stage not in ('authentication','adjudication') then raise exception 'invalid_review_stage';end if;
 if nullif(btrim(coalesce(p_task_id,'')),'') is null
    or nullif(btrim(coalesce(p_review_model,'')),'') is null
    or nullif(btrim(coalesce(p_operator_id,'')),'') is null
    or length(btrim(coalesce(p_justification,'')))<60 then
   raise exception 'task_model_operator_and_substantive_justification_required';
 end if;
 if p_review_model='manual' or p_review_model='human'
    or lower(btrim(p_review_model))=lower(btrim(coalesce((select candidate_model_id from agent_lab.expertise_verification_runs where verification_run_id=p_verification_run_id),'')))
 then raise exception 'review_model_must_be_distinct_and_identified';end if;
 if p_confidence is null or p_confidence<0 or p_confidence>1 or p_unsupported is null then
  raise exception 'confidence_or_unsupported_invalid';end if;
 if jsonb_typeof(p_components) is distinct from 'object' then raise exception 'components_object_required';end if;
 select * into v from agent_lab.expertise_verification_runs where verification_run_id=p_verification_run_id for update;
 if not found then raise exception 'verification_run_not_found';end if;
 select * into v_a from agent_lab.verification_intervention_alerts where verification_run_id=p_verification_run_id for update;
 if not found then raise exception 'manual_intervention_alert_not_found';end if;
 if v.status<>'manual_required' or v_a.status<>'operator_requested'
    or coalesce((v.metadata->>'manual_review_active')::boolean,false)=false
    or v.metadata->>'manual_review_operator'<>p_operator_id
 then raise exception 'manual_review_claim_not_owned_or_active';end if;
 v_hash:=encode(sha256(convert_to(jsonb_build_object(
  'challenge',v.challenge_packet,'answers',v.candidate_answers)::text,'UTF8')),'hex');
 if v_hash<>v.metadata->>'manual_candidate_snapshot_sha256' then
  raise exception 'candidate_evidence_changed_since_manual_claim';end if;
 select value into v_task from jsonb_array_elements(v.challenge_packet->'tasks')
  where value->>'id'=p_task_id limit 1;
 select value into v_answer from jsonb_array_elements(v.candidate_answers)
  where value->>'id'=p_task_id limit 1;
 if v_task is null or v_answer is null or nullif(btrim(v_answer->>'answer'),'') is null
 then raise exception 'task_or_saved_candidate_answer_missing';end if;
 foreach v_key in array array['execution','method','security','validation','communication'] loop
  if jsonb_typeof(p_components->v_key) is distinct from 'number' then
   raise exception 'numeric_component_required:%',v_key;end if;
  v_val:=(p_components->>v_key)::numeric;
  if v_val<0 or v_val>1 then raise exception 'component_out_of_range:%',v_key;end if;
  v_weight:=case v_key when 'execution' then 0.30 when 'method' then 0.20
    when 'security' then 0.20 when 'validation' then 0.15 else 0.15 end;
  v_score:=v_score+v_val*v_weight;
 end loop;
 v_score:=round(v_score,4);
 v_critical:=case when lower(btrim(coalesce(p_critical,''))) in ('','none','null','false')
    then null else left(btrim(p_critical),160) end;
 if p_stage='authentication' then
  if exists(select 1 from jsonb_array_elements(coalesce(v.authenticator_grades,'[]'::jsonb))
    where value->>'id'=p_task_id) then raise exception 'authenticator_grade_already_exists';end if;
 else
  select value into v_prior from jsonb_array_elements(coalesce(v.authenticator_grades,'[]'::jsonb))
    where value->>'id'=p_task_id limit 1;
  if v_prior is null then raise exception 'authentication_required_before_adjudication';end if;
  if not (
   ((v_prior->>'score')::numeric between 0.75 and 0.85)
   or nullif(v_prior->>'critical_error','') is not null
   or coalesce((v_prior->>'unsupported')::boolean,false)
   or coalesce((v_prior->>'confidence')::numeric,0)<0.70
  ) then raise exception 'adjudication_not_required_for_unflagged_grade';end if;
  if lower(btrim(p_review_model))=lower(btrim(coalesce(v_prior->>'verifier_model','')))
   then raise exception 'adjudicator_must_differ_from_authenticator';end if;
  if exists(select 1 from jsonb_array_elements(coalesce(v.adjudicator_grades,'[]'::jsonb))
   where value->>'id'=p_task_id) then raise exception 'adjudicator_grade_already_exists';end if;
 end if;
 v_grade:=jsonb_build_object(
  'id',p_task_id,'components',p_components,'score',v_score,
  'critical_error',v_critical,'confidence',p_confidence,
  'unsupported',p_unsupported,'source','operator_attested_model_review_v0_1',
  'reviewer_operator',left(p_operator_id,180),
  'review_model',left(p_review_model,180),
  'review_justification',left(p_justification,3000),
  'candidate_evidence_sha256',v_hash,'graded_at',now(),
  'raw_sha256',encode(sha256(convert_to(jsonb_build_object(
   'task_id',p_task_id,'components',p_components,'critical',v_critical,
   'confidence',p_confidence,'unsupported',p_unsupported,
   'justification',p_justification)::text,'UTF8')),'hex')
 );
 if p_stage='authentication' then
  v_grade:=v_grade||jsonb_build_object('verifier_model',left(p_review_model,180));
  update agent_lab.expertise_verification_runs
  set authenticator_grades=coalesce(authenticator_grades,'[]'::jsonb)||jsonb_build_array(v_grade),
   updated_at=now(),metadata=metadata||jsonb_build_object('checkpoint_stage','manual_authenticated_task','checkpoint_at',now())
  where verification_run_id=p_verification_run_id;
 else
  v_grade:=v_grade||jsonb_build_object('adjudicator_model',left(p_review_model,180),
    'supersedes_score',(v_prior->>'score')::numeric);
  update agent_lab.expertise_verification_runs
  set adjudicator_grades=coalesce(adjudicator_grades,'[]'::jsonb)||jsonb_build_array(v_grade),
    updated_at=now(),metadata=metadata||jsonb_build_object('checkpoint_stage','manual_adjudicated_task','checkpoint_at',now())
  where verification_run_id=p_verification_run_id;
 end if;
 return jsonb_build_object('ok',true,'verification_run_id',p_verification_run_id,
  'stage',p_stage,'task_id',p_task_id,'score',v_score,'status','grade_recorded_not_final');
end $function$


CREATE OR REPLACE FUNCTION agent_lab.operator_finalize_manual_grades_v0_1(p_verification_run_id uuid, p_operator_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare v agent_lab.expertise_verification_runs%rowtype;
 a agent_lab.verification_intervention_alerts%rowtype; t jsonb;g jsonb;
 v_required_adj int:=0;v_tasks int;v_hash text;
begin
 select * into v from agent_lab.expertise_verification_runs where verification_run_id=p_verification_run_id for update;
 select * into a from agent_lab.verification_intervention_alerts where verification_run_id=p_verification_run_id for update;
 if not found then raise exception 'manual_alert_not_found';end if;
 if v.status<>'manual_required' or a.status<>'operator_requested'
  or coalesce((v.metadata->>'manual_review_active')::boolean,false)=false
  or v.metadata->>'manual_review_operator'<>p_operator_id then
  raise exception 'manual_review_not_owned_or_active';end if;
 v_hash:=encode(sha256(convert_to(jsonb_build_object(
  'challenge',v.challenge_packet,'answers',v.candidate_answers)::text,'UTF8')),'hex');
 if v_hash<>v.metadata->>'manual_candidate_snapshot_sha256' then
   raise exception 'candidate_evidence_changed_since_manual_claim';end if;
 v_tasks:=jsonb_array_length(v.challenge_packet->'tasks');
 if jsonb_array_length(v.candidate_answers)<>v_tasks
  or jsonb_array_length(v.authenticator_grades)<>v_tasks then
  raise exception 'authentication_incomplete';end if;
 for t in select value from jsonb_array_elements(v.challenge_packet->'tasks') loop
  select value into g from jsonb_array_elements(v.authenticator_grades)
   where value->>'id'=t->>'id' limit 1;
  if g is null then raise exception 'missing_authenticator_grade:%',t->>'id';end if;
  if (g->>'score')::numeric between 0.75 and 0.85
     or nullif(g->>'critical_error','') is not null
     or coalesce((g->>'unsupported')::boolean,false)
     or coalesce((g->>'confidence')::numeric,0)<0.70 then
   v_required_adj:=v_required_adj+1;
   if not exists(select 1 from jsonb_array_elements(coalesce(v.adjudicator_grades,'[]'::jsonb))
    where value->>'id'=t->>'id') then raise exception 'required_adjudication_missing:%',t->>'id';end if;
  end if;
 end loop;
 if jsonb_array_length(coalesce(v.adjudicator_grades,'[]'::jsonb))<>v_required_adj then
  raise exception 'unmatched_adjudication_count';end if;
 update agent_lab.expertise_verification_runs set status='pending',updated_at=now(),
  metadata=(metadata-'claim_expires_at'-'retry_after_at'-'claimed_by'-'claimed_at')
   ||jsonb_build_object('manual_resume_active',true,
    'manual_review_completed_at',now(),'manual_review_operator',left(p_operator_id,180),
    'manual_review_stage','decision_ready','manual_review_protocol','operator_attested_model_review_v0_1')
 where verification_run_id=p_verification_run_id;
 update agent_lab.verification_intervention_alerts
 set updated_at=now(),metadata=metadata||jsonb_build_object(
  'manual_grades_complete_at',now(),'manual_grades_operator',left(p_operator_id,180))
 where verification_run_id=p_verification_run_id;
 return jsonb_build_object('ok',true,'status','operator_requested',
  'verification_run_id',p_verification_run_id,
  'authenticated_tasks',v_tasks,'adjudicated_tasks',v_required_adj,
  'next_step','Worker computes the deterministic final gate without model calls for completed grades.');
end $function$


CREATE OR REPLACE FUNCTION agent_lab.request_expertise_verification(p_agent_id uuid, p_expertise_artifact_id uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_model text;
  v_id uuid;
  v_track uuid;
  v_learning int := 0;
  v_entry_learning int := 1;
  v_art agent_lab.expertise_artifacts%rowtype;
  v_contract text;
  v_gate jsonb;
  v_legacy_files int := 0;
begin
  select coalesce(nullif(a.primary_model_id,''),nullif(a.birth_model_id,''))
  into v_model
  from agent_lab.agents a
  where a.agent_id=p_agent_id;
  if v_model is null then raise exception 'agent_model_not_bound'; end if;

  select * into v_art
  from agent_lab.expertise_artifacts x
  where x.expertise_artifact_id=p_expertise_artifact_id
    and x.agent_id=p_agent_id
    and x.status in ('initiated','accepted_for_development');
  if not found then raise exception 'eligible_expertise_artifact_not_found'; end if;

  if coalesce(v_art.metadata->>'application_contract_version','')='expertise_application_v0_1'
     and not coalesce((agent_lab.validate_expertise_application_v0_1(v_art.intended_application,v_art.economic_viability)->>'ok')::boolean,false) then
    raise exception 'expertise_application_v0_1_incomplete:%',
      agent_lab.validate_expertise_application_v0_1(v_art.intended_application,v_art.economic_viability)::text;
  end if;

  v_contract := coalesce(v_art.metadata->>'portfolio_contract_version','expertise_portfolio_v0_1_legacy');
  v_track := agent_lab.ensure_domain_learning_track_for_artifact(p_agent_id,p_expertise_artifact_id);

  if v_contract='expertise_portfolio_v0_2' then
    v_gate := agent_lab.evaluate_expertise_portfolio_gate_v0_2(p_agent_id,p_expertise_artifact_id);
    if not coalesce((v_gate->>'ready_for_verification')::boolean,false) then
      raise exception 'expertise_portfolio_v0_2_incomplete:%', v_gate::text;
    end if;
  else
    -- Grandfather only pre-v0.2 experimental artifacts. The old capture path failed to
    -- canonicalize study/practice rows, so source files are accepted as the legacy baseline.
    select count(*) into v_learning
    from agent_lab.domain_learning_episodes where track_id=v_track;

    select count(*) into v_legacy_files
    from agent_lab.agent_files
    where agent_id=p_agent_id
      and direction='outbound'
      and purpose='agent_output'
      and created_at>=v_art.created_at;

    if v_learning<1 and v_legacy_files<1 then
      raise exception 'legacy_expertise_development_not_ready:no_learning_or_output_evidence';
    end if;

    v_gate := jsonb_build_object(
      'version','legacy_expertise_entry_baseline_v0_1',
      'contract_version',v_contract,
      'grandfathered',true,
      'learning_episodes',v_learning,
      'agent_output_files',v_legacy_files,
      'reason','pre_v0_2_experiment_preserved_without_retroactive_reclassification'
    );
  end if;

  -- A manual intervention is not a failed competence assessment. Do not
  -- create a replacement run to bypass the frozen checkpoint or alert.
  select r.verification_run_id into v_id
  from agent_lab.expertise_verification_runs r
  where r.agent_id=p_agent_id and r.expertise_artifact_id=p_expertise_artifact_id
    and r.status='manual_required'
  order by r.created_at desc limit 1;
  if v_id is not null then return v_id; end if;

  if exists(
    select 1 from agent_lab.expertise_verification_runs r
    where r.agent_id=p_agent_id
      and r.expertise_artifact_id=p_expertise_artifact_id
      and r.status in ('pending','claimed','running')
  ) then
    select r.verification_run_id into v_id
    from agent_lab.expertise_verification_runs r
    where r.agent_id=p_agent_id
      and r.expertise_artifact_id=p_expertise_artifact_id
      and r.status in ('pending','claimed','running')
    order by r.created_at desc limit 1;
    return v_id;
  end if;

  insert into agent_lab.expertise_verification_runs(
    agent_id,expertise_artifact_id,candidate_model_id,metadata
  ) values (
    p_agent_id,p_expertise_artifact_id,v_model,
    coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object(
      'protocol','expertise_verification_runtime_v0_3',
      'provider','nvidia_direct',
      'domain_learning_policy','domain_learning_v0_2',
      'authenticator_policy_version','expertise_authenticator_v0_2',
      'minimum_academic_equivalence','masters_equivalent',
      'threshold_authority','runtime_owned',
      'candidate_thresholds_ignored',true,
      'portfolio_contract_version',v_contract,
      'portfolio_entry_gate',v_gate
    )
  ) returning verification_run_id into v_id;

  return v_id;
end
$function$


CREATE OR REPLACE FUNCTION agent_lab.retry_expertise_verification(p_agent_id uuid, p_expertise_artifact_id uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_id uuid;
  v_previous_failure jsonb;
begin
  if not exists (
    select 1
    from agent_lab.expertise_artifacts x
    where x.expertise_artifact_id=p_expertise_artifact_id
      and x.agent_id=p_agent_id
      and x.status in ('initiated','accepted_for_development')
  ) then
    raise exception 'eligible_expertise_artifact_not_found';
  end if;

  select r.verification_run_id into v_id
  from agent_lab.expertise_verification_runs r
  where r.agent_id=p_agent_id and r.expertise_artifact_id=p_expertise_artifact_id
    and r.status='manual_required'
  order by r.created_at desc limit 1;
  if v_id is not null then return v_id; end if;

  select r.verification_run_id into v_id
  from agent_lab.expertise_verification_runs r
  where r.agent_id=p_agent_id
    and r.expertise_artifact_id=p_expertise_artifact_id
    and r.status in ('pending','claimed','running')
  order by r.created_at desc
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  select r.verification_run_id,
         jsonb_build_object(
           'error_code',r.metadata->>'last_error_code',
           'error_message',r.metadata->>'last_error_message',
           'error_at',r.metadata->>'last_error_at',
           'executor_id',r.metadata->>'last_executor_id',
           'attempt_count',coalesce((r.metadata->>'attempt_count')::integer,0),
           'recorded_at',now()
         )
    into v_id,v_previous_failure
  from agent_lab.expertise_verification_runs r
  where r.agent_id=p_agent_id
    and r.expertise_artifact_id=p_expertise_artifact_id
    and r.status='failed'
    and r.overall_score is null
    and r.verified_at is null
  order by r.updated_at desc,r.created_at desc
  limit 1
  for update;

  if v_id is null then
    raise exception 'retryable_runtime_failed_verification_not_found';
  end if;

  update agent_lab.expertise_verification_runs r
  set status='pending',
      challenge_packet='{}'::jsonb,
      candidate_answers='[]'::jsonb,
      authenticator_grades='[]'::jsonb,
      adjudicator_grades='[]'::jsonb,
      final_report='{}'::jsonb,
      overall_score=null,
      verified_at=null,
      updated_at=now(),
      metadata=(coalesce(r.metadata,'{}'::jsonb)
        - 'claim_expires_at'
        - 'claimed_by'
        - 'claimed_at'
        - 'retry_after_at'
        - 'last_error_code'
        - 'last_error_message'
        - 'last_error_at'
        - 'last_executor_id')
        || jsonb_build_object(
          'previous_runtime_failures',coalesce(r.metadata->'previous_runtime_failures','[]'::jsonb) || jsonb_build_array(v_previous_failure),
          'retry_requested_at',now(),
          'retry_request_count',coalesce((r.metadata->>'retry_request_count')::integer,0)+1,
          'retry_origin','agent_selected_retry_action_v0_1'
        )
        || coalesce(p_metadata,'{}'::jsonb)
  where r.verification_run_id=v_id;

  return v_id;
end;
$function$


CREATE OR REPLACE FUNCTION agent_lab.build_expertise_verification_context_v0_1(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_artifact agent_lab.expertise_artifacts%rowtype;
  v_run agent_lab.expertise_verification_runs%rowtype;
  v_complete boolean := false;
  v_runtime_failed boolean := false;
  v_report_requested boolean := false;
  v_report jsonb := '{}'::jsonb;
  v_mean numeric := null;
  v_mean_min numeric := 0.85;
  v_task_min numeric := 0.80;
  v_fraction numeric := 0.80;
  v_required_count integer := 0;
  v_passed_count integer := 0;
  v_expected_count integer := 0;
  v_gap numeric := null;
  v_failures jsonb := '[]'::jsonb;
  v_grade jsonb;
  v_score numeric;
begin
  select * into v_artifact
  from agent_lab.expertise_artifacts
  where agent_id=p_agent_id
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'version','expertise_verification_context_v0_3',
      'artifact_status','none',
      'verification_status','not_available',
      'verification_exists',false,
      'result_available',false,
      'competence_verdict_available',false,
      'challenge_hidden_until_complete',true
    );
  end if;

  select * into v_run
  from agent_lab.expertise_verification_runs
  where agent_id=p_agent_id and expertise_artifact_id=v_artifact.expertise_artifact_id
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'version','expertise_verification_context_v0_3',
      'artifact',jsonb_build_object(
        'expertise_artifact_id',v_artifact.expertise_artifact_id,
        'domain',v_artifact.domain,
        'status',v_artifact.status,
        'target_standard',v_artifact.target_standard
      ),
      'verification_status','not_requested',
      'verification_exists',false,
      'result_available',false,
      'competence_verdict_available',false,
      'challenge_hidden_until_complete',true,
      'threshold_semantics',jsonb_build_object(
        'overall_mean_minimum',0.85,
        'per_task_minimum',0.80,
        'required_task_fraction',0.80,
        'authoritative_explanation',
          'The overall expertise-pass threshold is a mean score of at least 0.85. The value 0.80 is the per-task minimum and the required task fraction, not the overall pass threshold.'
      ),
      'rule','Do not claim a verification was submitted or completed unless this context says so.'
    );
  end if;

  v_complete := v_run.status in ('verified_pass','verified_fail');
  v_runtime_failed := v_run.status in ('failed','manual_required');

  if v_complete then
    begin
      v_mean := coalesce(
        (v_run.final_report #>> '{runtime_owned_master_gate,mean_score}')::numeric,
        (v_run.final_report #>> '{gate,mean_score}')::numeric,
        v_run.overall_score
      );
    exception when others then
      v_mean := v_run.overall_score;
    end;

    begin
      v_mean_min := coalesce(
        (v_run.final_report #>> '{runtime_owned_master_gate,mean_score_min}')::numeric,
        (v_run.final_report #>> '{gate,mean_score_min}')::numeric,
        0.85
      );
    exception when others then
      v_mean_min := 0.85;
    end;

    begin
      v_task_min := coalesce(
        (v_run.final_report #>> '{runtime_owned_master_gate,task_score_min}')::numeric,
        (v_run.final_report #>> '{gate,task_score_min}')::numeric,
        0.80
      );
    exception when others then
      v_task_min := 0.80;
    end;

    begin
      v_fraction := coalesce(
        (v_run.final_report #>> '{runtime_owned_master_gate,required_task_fraction}')::numeric,
        0.80
      );
    exception when others then
      v_fraction := 0.80;
    end;

    begin
      v_required_count := coalesce(
        (v_run.final_report #>> '{runtime_owned_master_gate,required_task_count}')::integer,
        (v_run.final_report #>> '{gate,required_task_count}')::integer,
        0
      );
    exception when others then
      v_required_count := 0;
    end;

    begin
      v_passed_count := coalesce(
        (v_run.final_report #>> '{runtime_owned_master_gate,passed_task_count}')::integer,
        (v_run.final_report #>> '{gate,passed_task_count}')::integer,
        0
      );
    exception when others then
      v_passed_count := 0;
    end;

    begin
      v_expected_count := coalesce(
        (v_run.final_report #>> '{runtime_owned_master_gate,expected_task_count}')::integer,
        (v_run.final_report #>> '{gate,task_count}')::integer,
        0
      );
    exception when others then
      v_expected_count := 0;
    end;

    if v_required_count=0 and v_expected_count>0 then
      v_required_count := ceil(v_expected_count*v_fraction)::integer;
    end if;

    if v_mean is not null then
      v_gap := greatest(0, v_mean_min-v_mean);
      if v_mean < v_mean_min then
        v_failures := v_failures || jsonb_build_array(jsonb_build_object(
          'type','overall_mean_below_minimum',
          'actual',v_mean,
          'required',v_mean_min,
          'gap',v_gap
        ));
      end if;
    end if;

    if jsonb_typeof(coalesce(v_run.final_report->'final_grades','[]'::jsonb))='array' then
      for v_grade in
        select value from jsonb_array_elements(coalesce(v_run.final_report->'final_grades','[]'::jsonb))
      loop
        begin
          v_score := (v_grade->>'score')::numeric;
        exception when others then
          v_score := null;
        end;
        if v_score is not null and v_score < v_task_min then
          v_failures := v_failures || jsonb_build_array(jsonb_build_object(
            'type','task_below_minimum',
            'task_id',v_grade->>'id',
            'actual',v_score,
            'required',v_task_min,
            'gap',greatest(0,v_task_min-v_score)
          ));
        end if;
      end loop;
    end if;

    if coalesce((v_run.final_report #>> '{runtime_owned_master_gate,critical_error_count}')::integer,0)>0 then
      v_failures := v_failures || jsonb_build_array(jsonb_build_object(
        'type','critical_errors_present',
        'count',(v_run.final_report #>> '{runtime_owned_master_gate,critical_error_count}')::integer
      ));
    end if;

    if coalesce((v_run.final_report #>> '{runtime_owned_master_gate,unsupported_claim_count}')::integer,0)>0 then
      v_failures := v_failures || jsonb_build_array(jsonb_build_object(
        'type','unsupported_claims_present',
        'count',(v_run.final_report #>> '{runtime_owned_master_gate,unsupported_claim_count}')::integer
      ));
    end if;
  end if;

  if v_runtime_failed then
    select exists(
      select 1 from agent_lab.activity_log a
      where a.agent_id=p_agent_id
        and a.selected_action='request_verification_failure_report'
        and a.created_at>=coalesce((v_run.metadata->>'last_error_at')::timestamptz,v_run.updated_at)
    ) into v_report_requested;

    v_report := jsonb_build_object(
      'report_type',case when v_run.status='manual_required' then 'manual_intervention_required' else 'verification_runtime_failure' end,
      'report_status',case when v_report_requested then 'fulfilled' else 'available' end,
      'requested_by_agent',v_report_requested,
      'verification_run_id',v_run.verification_run_id,
      'failed_at',coalesce(v_run.metadata->>'last_error_at',v_run.updated_at::text),
      'error_code',v_run.metadata->>'last_error_code',
      'error_message',v_run.metadata->>'last_error_message',
      'attempt_count',coalesce((v_run.metadata->>'attempt_count')::integer,0),
      'competence_verdict','not_produced',
      'manual_required',v_run.status='manual_required',
      'failed_stage',v_run.metadata->>'manual_failure_stage',
      'overall_score',null,
      'explanation','The verification runtime failed before a valid expertise pass/fail verdict was produced. This is a verifier/infrastructure failure, not evidence that the agent failed the expertise standard.',
      'agent_guidance',case when v_run.status='manual_required' then 'Independent verification is frozen. Do not re-request, retry, or reconstruct it; await operator intervention and an authoritative verdict.' else 'Do not revise the expertise artifact as though it failed assessment. Wait for or request a verifier retry after the runtime/adjudicator fault is repaired.' end
    );
  end if;

  return jsonb_build_object(
    'version','expertise_verification_context_v0_3',
    'artifact',jsonb_build_object(
      'expertise_artifact_id',v_artifact.expertise_artifact_id,
      'domain',v_artifact.domain,
      'status',v_artifact.status,
      'target_standard',v_artifact.target_standard
    ),
    'verification',jsonb_build_object(
      'verification_run_id',v_run.verification_run_id,
      'status',case when v_run.status='manual_required' then 'manual_required' when v_runtime_failed then 'runtime_failed' else v_run.status end,
      'raw_runtime_status',v_run.status,
      'requested_at',v_run.created_at,
      'updated_at',v_run.updated_at,
      'verified_at',v_run.verified_at,
      'result_available',v_complete,
      'competence_verdict_available',v_complete,
      'overall_score',case when v_complete then v_run.overall_score else null end,
      'final_report',case when v_complete then coalesce(v_run.final_report,'{}'::jsonb) else '{}'::jsonb end,
      'runtime_failure_report',case when v_runtime_failed then v_report else '{}'::jsonb end
    ),
    'threshold_semantics',jsonb_build_object(
      'overall_mean_score',case when v_complete then v_mean else null end,
      'required_overall_mean',v_mean_min,
      'overall_gap_to_required_mean',case when v_complete then v_gap else null end,
      'per_task_minimum',v_task_min,
      'required_task_fraction',v_fraction,
      'required_task_count',case when v_complete then v_required_count else null end,
      'passed_task_count',case when v_complete then v_passed_count else null end,
      'expected_task_count',case when v_complete then v_expected_count else null end,
      'important',
        '0.80 is NOT the overall expertise-pass threshold. The overall mean must be at least 0.85. The 0.80 value is the per-task minimum and required task fraction.'
    ),
    'failure_reasons',case when v_complete then v_failures else '[]'::jsonb end,
    'verification_status',case when v_run.status='manual_required' then 'manual_required' when v_runtime_failed then 'runtime_failed' else v_run.status end,
    'verification_exists',true,
    'result_available',v_complete,
    'competence_verdict_available',v_complete,
    'runtime_failure',v_runtime_failed,
    'failure_report',case when v_runtime_failed then v_report else '{}'::jsonb end,
    'challenge_hidden_until_complete',true,
    'rule',case
      when v_runtime_failed then
        'A verifier runtime error is not an expertise failure. When status is manual_required, do not retry; await operator intervention. No competence verdict exists.'
      when v_complete then
        'Threshold semantics are authoritative. Never treat 0.80 as the overall pass threshold; the overall mean requirement is 0.85. Use failure_reasons rather than inferring gate semantics from raw scores.'
      else
        'Treat this context as authoritative for whether expertise verification exists, is pending, or is complete. Never invent unseen verification results or challenge content.'
    end
  );
end
$function$


CREATE OR REPLACE FUNCTION public.aau_bridge_fail_expertise_verification(p_bridge_token text, p_verification_run_id uuid, p_executor_id text, p_error_code text, p_error_message text, p_retry_after_seconds integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab', 'extensions'
AS $function$
declare
 v_run agent_lab.expertise_verification_runs%rowtype;
 v_status text; v_stage text; v_attempts integer; v_retryable boolean;
 v_hash text; v_counts jsonb;
begin
 perform agent_lab.assert_broker_bridge_token(p_bridge_token);
 if nullif(btrim(coalesce(p_executor_id,'')),'') is null then
  raise exception 'executor_id_required';
 end if;
 select * into v_run from agent_lab.expertise_verification_runs
 where verification_run_id=p_verification_run_id for update;
 if not found then raise exception 'verification_run_not_found'; end if;
 if v_run.status not in ('claimed','running') then
  raise exception 'verification_run_not_active';
 end if;
 if coalesce(v_run.metadata->>'claimed_by','')<>p_executor_id then
  raise exception 'verification_claim_owner_mismatch';
 end if;
 v_attempts:=coalesce((v_run.metadata->>'attempt_count')::integer,1);
 v_retryable:=coalesce(p_retry_after_seconds,0)>0;
 -- Exactly one bounded automatic reattempt. An operator-requested recovery
 -- must never create a new automatic retry cycle.
 v_status:=case when v_retryable and v_attempts<2
      and coalesce((v_run.metadata->>'manual_resume_active')::boolean,false)=false
   then 'pending' else 'manual_required' end;
 v_counts:=jsonb_build_object(
  'challenge_tasks',case when jsonb_typeof(v_run.challenge_packet->'tasks')='array'
   then jsonb_array_length(v_run.challenge_packet->'tasks') else 0 end,
  'candidate_answers',case when jsonb_typeof(v_run.candidate_answers)='array'
   then jsonb_array_length(v_run.candidate_answers) else 0 end,
  'authenticator_grades',case when jsonb_typeof(v_run.authenticator_grades)='array'
   then jsonb_array_length(v_run.authenticator_grades) else 0 end,
  'adjudicator_grades',case when jsonb_typeof(v_run.adjudicator_grades)='array'
   then jsonb_array_length(v_run.adjudicator_grades) else 0 end
 );
 v_stage:=case
   when (v_counts->>'challenge_tasks')::integer=0 then 'challenge'
   when (v_counts->>'candidate_answers')::integer<(v_counts->>'challenge_tasks')::integer then 'candidate'
   when (v_counts->>'authenticator_grades')::integer<(v_counts->>'candidate_answers')::integer then 'authentication'
   when coalesce(v_run.metadata->>'checkpoint_stage','')='adjudicated_task' then 'adjudication'
   when coalesce(v_run.metadata->>'checkpoint_stage','')='authenticated_task' then 'adjudication_or_completion'
   else 'adjudication_or_completion' end;
 v_hash:=encode(sha256(convert_to(jsonb_build_object(
  'challenge',coalesce(v_run.challenge_packet,'{}'::jsonb),
  'answers',coalesce(v_run.candidate_answers,'[]'::jsonb),
  'authenticator',coalesce(v_run.authenticator_grades,'[]'::jsonb),
  'adjudicator',coalesce(v_run.adjudicator_grades,'[]'::jsonb))::text,'UTF8')),'hex');
 update agent_lab.expertise_verification_runs
 set status=v_status,updated_at=now(),
 metadata=(coalesce(metadata,'{}'::jsonb)-'claim_expires_at'-'retry_after_at')
  ||jsonb_build_object(
   'last_error_code',left(coalesce(p_error_code,'verification_error'),200),
   'last_error_message',left(coalesce(p_error_message,''),2000),
   'last_error_at',now(),'last_executor_id',p_executor_id,
   'retry_after_at',case when v_status='pending'
      then now()+make_interval(secs=>least(greatest(p_retry_after_seconds,30),3600)) else null end,
   'manual_required_at',case when v_status='manual_required' then now() else null end,
   'manual_failure_stage',case when v_status='manual_required' then v_stage else null end,
   'manual_checkpoint_hash',case when v_status='manual_required' then v_hash else null end,
   'retry_policy','verification_bounded_retry_v0_1','max_automatic_attempts',2)
 where verification_run_id=p_verification_run_id;
 if v_status='manual_required' then
  insert into agent_lab.verification_intervention_alerts(
   verification_run_id,agent_id,expertise_artifact_id,
   status,failed_stage,error_code,error_message,automatic_attempts,evidence_sha256,
   checkpoint_counts,metadata
  ) values (
    v_run.verification_run_id,v_run.agent_id,v_run.expertise_artifact_id,
    'open',v_stage,left(coalesce(p_error_code,'verification_error'),200),
    left(coalesce(p_error_message,''),2000),v_attempts,v_hash,v_counts,
    jsonb_build_object('source','expertise_verification_worker','verdict','not_produced',
     'operator_action','Inspect the frozen checkpoint, then explicitly request manual resumption.')
  )
  on conflict (verification_run_id) do update
   set status='open',updated_at=now(),resolved_at=null,
       failed_stage=excluded.failed_stage,error_code=excluded.error_code,
       error_message=excluded.error_message,automatic_attempts=excluded.automatic_attempts,
       evidence_sha256=excluded.evidence_sha256,checkpoint_counts=excluded.checkpoint_counts,
       metadata=agent_lab.verification_intervention_alerts.metadata||
         jsonb_build_object('reopened_at',now(),'verdict','not_produced');
 end if;
 return jsonb_build_object('ok',true,'verification_run_id',v_run.verification_run_id,
   'status',v_status,'failed_stage',v_stage,'attempt_count',v_attempts,
   'manual_alert',v_status='manual_required','retry_policy','verification_bounded_retry_v0_1');
end $function$


CREATE OR REPLACE FUNCTION public.aau_bridge_complete_expertise_verification(p_bridge_token text, p_verification_run_id uuid, p_executor_id text, p_overall_result text, p_overall_score numeric, p_challenge_packet jsonb, p_candidate_answers jsonb, p_authenticator_grades jsonb, p_adjudicator_grades jsonb, p_final_report jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab', 'extensions'
AS $function$
declare
  v_run agent_lab.expertise_verification_runs%rowtype;
  v_domain text;
  v_gate jsonb;
  v_gate_pass boolean:=false;
  v_authoritative_result text;
  v_authoritative_score numeric:=0;
  v_final_report jsonb;
  v_badge_id uuid;
  v_manual_review boolean:=false;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  if p_overall_result not in ('verified_pass','verified_fail') then raise exception 'invalid_verification_result'; end if;
  if p_overall_score is null or p_overall_score<0 or p_overall_score>1 then raise exception 'invalid_overall_score'; end if;
  select * into v_run from agent_lab.expertise_verification_runs where verification_run_id=p_verification_run_id for update;
  if not found then raise exception 'verification_run_not_found'; end if;
  if v_run.status not in ('claimed','running') then raise exception 'verification_run_not_claimed'; end if;
  if coalesce(v_run.metadata->>'claimed_by','')<>coalesce(p_executor_id,'') then raise exception 'verification_claim_owner_mismatch'; end if;
  select domain into v_domain from agent_lab.expertise_artifacts where expertise_artifact_id=v_run.expertise_artifact_id;
  v_manual_review:=exists(select 1 from jsonb_array_elements(coalesce(p_authenticator_grades,'[]'::jsonb)) where value->>'source'='operator_attested_model_review_v0_1')
     or exists(select 1 from jsonb_array_elements(coalesce(p_adjudicator_grades,'[]'::jsonb)) where value->>'source'='operator_attested_model_review_v0_1');

  v_gate:=agent_lab.evaluate_masters_equivalent_gate_v0_1(coalesce(p_challenge_packet,'{}'::jsonb),coalesce(p_final_report,'{}'::jsonb));
  begin v_gate_pass:=coalesce((v_gate->>'passed')::boolean,false); exception when others then v_gate_pass:=false; end;
  begin v_authoritative_score:=coalesce((v_gate->>'mean_score')::numeric,0); exception when others then v_authoritative_score:=0; end;
  v_authoritative_result:=case when p_overall_result='verified_pass' and v_gate_pass then 'verified_pass' else 'verified_fail' end;
  v_final_report:=coalesce(p_final_report,'{}'::jsonb)||jsonb_build_object(
    'worker_reported_result',p_overall_result,'worker_reported_score',p_overall_score,
    'overall_result',v_authoritative_result,'overall_score',v_authoritative_score,
    'runtime_owned_master_gate',v_gate,
    'academic_equivalence_level',case when v_authoritative_result='verified_pass' then 'masters_equivalent' else 'below_masters_equivalent' end,
    'minimum_academic_equivalence','masters_equivalent','equivalence_is_not_academic_credential',true,
    'authenticator_policy_version','expertise_authenticator_v0_2','threshold_authority','runtime_owned',
    'manual_review_used',v_manual_review
  );

  update agent_lab.expertise_verification_runs set
    status=v_authoritative_result,overall_score=v_authoritative_score,challenge_packet=coalesce(p_challenge_packet,'{}'::jsonb),candidate_answers=coalesce(p_candidate_answers,'[]'::jsonb),
    authenticator_grades=coalesce(p_authenticator_grades,'[]'::jsonb),adjudicator_grades=coalesce(p_adjudicator_grades,'[]'::jsonb),final_report=v_final_report,
    verified_at=now(),updated_at=now(),metadata=(metadata-'claim_expires_at')||jsonb_build_object(
      'completed_by',p_executor_id,'completed_at',now(),'authenticator_policy_version','expertise_authenticator_v0_2',
      'minimum_academic_equivalence','masters_equivalent','threshold_authority','runtime_owned','worker_reported_result',p_overall_result,'worker_reported_score',p_overall_score,'manual_review_used',v_manual_review
    )
  where verification_run_id=p_verification_run_id;

  update agent_lab.expertise set
    actual_competence=round((v_authoritative_score*10)::numeric,4),last_assessed_at=now(),assessment_method=case when v_manual_review then 'external_independent_manual_review_v0_1_masters_equivalent' else 'external_nvidia_multi_model_verification_v0_2_masters_equivalent' end,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('verification_run_id',p_verification_run_id,'verification_status',v_authoritative_result,'verified_score',v_authoritative_score,'academic_equivalence_level',case when v_authoritative_result='verified_pass' then 'masters_equivalent' else 'below_masters_equivalent' end,'authenticator_model',v_run.authenticator_model,'authenticator_policy_version','expertise_authenticator_v0_2','manual_review_used',v_manual_review)
  where agent_id=v_run.agent_id and domain=v_domain;

  update agent_lab.expertise_artifacts set
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('latest_verification_run_id',p_verification_run_id,'verification_status',v_authoritative_result,'verified_score',v_authoritative_score,'academic_equivalence_level',case when v_authoritative_result='verified_pass' then 'masters_equivalent' else 'below_masters_equivalent' end,'verified_at',now(),'authenticator_model',v_run.authenticator_model,'authenticator_policy_version','expertise_authenticator_v0_2'),updated_at=now()
  where expertise_artifact_id=v_run.expertise_artifact_id;

  update agent_lab.verification_intervention_alerts
    set status='resolved',updated_at=now(),resolved_at=now(),
        metadata=metadata||jsonb_build_object(
          'final_verdict',v_authoritative_result,
          'resolved_by',p_executor_id,
          'final_report_sha256',encode(sha256(convert_to(v_final_report::text,'UTF8')),'hex'))
    where verification_run_id=p_verification_run_id
      and status in ('open','operator_requested');

  select badge_id into v_badge_id from agent_lab.universe_recognition_badges where verification_run_id=p_verification_run_id;
  return jsonb_build_object('ok',true,'verification_run_id',p_verification_run_id,'result',v_authoritative_result,'score',v_authoritative_score,'academic_equivalence_level',case when v_authoritative_result='verified_pass' then 'masters_equivalent' else 'below_masters_equivalent' end,'universe_badge_id',v_badge_id,'runtime_owned_master_gate',v_gate);
end;
$function$


CREATE OR REPLACE FUNCTION public.aau_control_room_verification_alerts(p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
 select agent_lab.operator_verification_alerts_v0_1(p_limit);
$function$


CREATE OR REPLACE FUNCTION public.aau_control_room_verification_evidence(p_verification_run_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
 select agent_lab.operator_verification_evidence_v0_1(p_verification_run_id);
$function$



revoke all on function agent_lab.record_expired_verification_alert_v0_1(uuid,text) from public,anon,authenticated;
revoke all on function agent_lab.operator_verification_alerts_v0_1(integer) from public,anon,authenticated;
revoke all on function agent_lab.operator_verification_evidence_v0_1(uuid) from public,anon,authenticated;
revoke all on function agent_lab.operator_resume_expertise_verification_v0_1(uuid,text,text) from public,anon,authenticated;
revoke all on function agent_lab.operator_begin_manual_grade_review_v0_1(uuid,text,text) from public,anon,authenticated;
revoke all on function agent_lab.operator_submit_expertise_grade_v0_1(uuid,text,text,text,jsonb,text,numeric,boolean,text,text) from public,anon,authenticated;
revoke all on function agent_lab.operator_finalize_manual_grades_v0_1(uuid,text) from public,anon,authenticated;
revoke all on function public.aau_control_room_verification_alerts(integer) from public,anon,authenticated;
revoke all on function public.aau_control_room_verification_evidence(uuid) from public,anon,authenticated;
grant execute on function agent_lab.operator_verification_alerts_v0_1(integer) to service_role;
grant execute on function agent_lab.operator_verification_evidence_v0_1(uuid) to service_role;
grant execute on function agent_lab.operator_resume_expertise_verification_v0_1(uuid,text,text) to service_role;
grant execute on function agent_lab.operator_begin_manual_grade_review_v0_1(uuid,text,text) to service_role;
grant execute on function agent_lab.operator_submit_expertise_grade_v0_1(uuid,text,text,text,jsonb,text,numeric,boolean,text,text) to service_role;
grant execute on function agent_lab.operator_finalize_manual_grades_v0_1(uuid,text) to service_role;
grant execute on function public.aau_control_room_verification_alerts(integer) to service_role;
grant execute on function public.aau_control_room_verification_evidence(uuid) to service_role;

-- Operator workflow:
-- 1. Read public.aau_control_room_verification_alerts() in authenticated Control Room
--    or agent_lab.operator_verification_alerts_v0_1() via connected operator SQL.
-- 2. Inspect frozen evidence via agent_lab.operator_verification_evidence_v0_1(run_id).
-- 3. Explicit operator choice:
--    (a) agent_lab.operator_resume_expertise_verification_v0_1(run_id, operator, reason)
--        retries saved stage through approved worker model chain; OR
--    (b) agent_lab.operator_begin_manual_grade_review_v0_1(run_id, operator, reason);
--        operator independently evaluates saved answers with a separately named model;
--        submits one grade per missing authenticator/required adjudicator task via
--        agent_lab.operator_submit_expertise_grade_v0_1; then
--        agent_lab.operator_finalize_manual_grades_v0_1(run_id, operator).
-- 4. Existing worker reclaims the pending run and applies deterministic master gate.
-- Manual evidence is an operator-attested model review, not a cryptographic attestation.
-- Do not expose operator functions directly to anon/authenticated or fabricate grades.
