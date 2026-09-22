-- AAU owned master-level expertise standard v0.3. New flows and explicit retrofits only.
create table if not exists agent_lab.expertise_standard_versions (
 standard_id uuid primary key default extensions.gen_random_uuid(),
 proposal_id uuid unique references agent_lab.expertise_economic_proposals(proposal_id),
 artifact_id uuid unique references agent_lab.expertise_artifacts(expertise_artifact_id),
 agent_id uuid not null references agent_lab.agents(agent_id),
 domain text not null,
 standard_version text not null default 'aau_owned_master_us_v0_3',
 status text not null default 'pending' check(status in ('pending','authoring','review_pending','approved','needs_revision')),
 public_spec jsonb not null default '{}'::jsonb,
 private_assessment jsonb not null default '{}'::jsonb,
 source_receipts jsonb not null default '[]'::jsonb,
 author_model text,
 reviewer_model text,
 review jsonb not null default '{}'::jsonb,
 specification_sha256 text,
 attempt_count integer not null default 0,
 last_error text,
 authored_at timestamptz,
 approved_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 metadata jsonb not null default '{}'::jsonb,
 constraint expertise_standard_parent_check check ((proposal_id is not null)::integer + (artifact_id is not null)::integer = 1)
);
create index if not exists expertise_standard_pending_idx on agent_lab.expertise_standard_versions(status,created_at);
alter table agent_lab.expertise_standard_versions enable row level security;
revoke all on agent_lab.expertise_standard_versions from public,anon,authenticated;

create or replace function agent_lab.enqueue_approved_path_standard_v0_3()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','agent_lab','extensions'
as $$
begin
 if new.report->>'proposal_contract_version'='expertise_viability_proposal_v0_3'
    and new.status in ('pending','revision_requested') then
   insert into agent_lab.expertise_standard_versions(proposal_id,agent_id,domain)
   values(new.proposal_id,new.agent_id,new.domain)
   on conflict(proposal_id) do update
     set domain=excluded.domain,
         -- A substantive revision invalidates any old draft; approval is immutable.
         status=case when agent_lab.expertise_standard_versions.status='approved'
                     then 'approved' else 'pending' end,
         public_spec=case when agent_lab.expertise_standard_versions.status='approved'
                         then agent_lab.expertise_standard_versions.public_spec else '{}'::jsonb end,
         private_assessment=case when agent_lab.expertise_standard_versions.status='approved'
                         then agent_lab.expertise_standard_versions.private_assessment else '{}'::jsonb end,
         source_receipts=case when agent_lab.expertise_standard_versions.status='approved'
                         then agent_lab.expertise_standard_versions.source_receipts else '[]'::jsonb end,
         updated_at=now();
 end if;
 return new;
end;
$$;
drop trigger if exists expertise_standard_queue_v0_3 on agent_lab.expertise_economic_proposals;
create trigger expertise_standard_queue_v0_3 after insert or update of report,status
on agent_lab.expertise_economic_proposals
for each row execute function agent_lab.enqueue_approved_path_standard_v0_3();

create or replace function agent_lab.validate_owned_expertise_standard_v0_3(
 p_public jsonb,p_private jsonb,p_sources jsonb
) returns jsonb language plpgsql immutable
set search_path to 'pg_catalog','agent_lab'
as $$
declare
 v_missing jsonb:='[]'::jsonb;
 v_bench int:=0;
 v_comp int:=0;
 v_tasks int:=0;
 v_item jsonb;
 v_host text;
 v_institution text;
 v_seen text[]:=array[]::text[];
begin
 if jsonb_typeof(p_public) is distinct from 'object' then
   return jsonb_build_object('ok',false,'missing',jsonb_build_array('public_spec'));
 end if;
 if p_public->>'academic_target' is distinct from 'leading_us_university_masters_level_demonstrated_competence'
    or length(coalesce(p_public->>'target_standard',''))<90
    or lower(coalesce(p_public->>'target_standard','')) not like '%master%' then
   v_missing:=v_missing||jsonb_build_array('fixed_masters_level_target');
 end if;
 if jsonb_typeof(p_public->'scope') is distinct from 'object'
    or coalesce(p_public->'scope','{}'::jsonb)='{}'::jsonb then
   v_missing:=v_missing||jsonb_build_array('bounded_scope');
 end if;
 if jsonb_typeof(p_public->'competencies')='array' then
   v_comp:=jsonb_array_length(p_public->'competencies');
   for v_item in select value from jsonb_array_elements(p_public->'competencies') loop
     if length(coalesce(v_item->>'id',''))=0 or length(coalesce(v_item->>'label',''))<8
        or jsonb_typeof(v_item->'learning_objectives') is distinct from 'array'
        or jsonb_array_length(case when jsonb_typeof(v_item->'learning_objectives')='array'
                    then v_item->'learning_objectives' else '[]'::jsonb end)<2 then
       v_missing:=v_missing||jsonb_build_array('competency_objective_fields');
       exit;
     end if;
   end loop;
 end if;
 if v_comp<4 then v_missing:=v_missing||jsonb_build_array('four_or_more_competencies'); end if;
 if jsonb_typeof(p_public->'curriculum') is distinct from 'array'
    or jsonb_array_length(case when jsonb_typeof(p_public->'curriculum')='array'
                    then p_public->'curriculum' else '[]'::jsonb end)<4 then
   v_missing:=v_missing||jsonb_build_array('four_or_more_curriculum_milestones');
 end if;
 if jsonb_typeof(p_public->'benchmark_mapping') is distinct from 'array'
    or jsonb_array_length(case when jsonb_typeof(p_public->'benchmark_mapping')='array'
                    then p_public->'benchmark_mapping' else '[]'::jsonb end)<4 then
   v_missing:=v_missing||jsonb_build_array('benchmark_mapping');
 end if;
 if jsonb_typeof(p_public->'evidence_requirements') is distinct from 'object'
    or jsonb_typeof(p_public->'verification_plan') is distinct from 'object'
    or p_public->'verification_plan' ?| array['pass_score','mean_score_min','task_score_min'] then
   v_missing:=v_missing||jsonb_build_array('evidence_and_runtime_owned_verification_plan');
 end if;
 if jsonb_typeof(p_sources)='array' then
   for v_item in select value from jsonb_array_elements(p_sources) loop
     if v_item->>'fetch_status' <> 'fetched_text' or length(coalesce(v_item->>'excerpt',''))<100 then
       continue;
     end if;
     v_host:=substring(lower(v_item->>'url') from '^https://([^/:?#]+)');
     v_institution:=case
       when v_host ~ '(^|\.)stanford\.edu$' then 'stanford'
       when v_host ~ '(^|\.)mit\.edu$' then 'mit'
       when v_host ~ '(^|\.)cmu\.edu$' then 'cmu'
       when v_host ~ '(^|\.)berkeley\.edu$' then 'berkeley'
       when v_host ~ '(^|\.)harvard\.edu$' then 'harvard'
       when v_host ~ '(^|\.)princeton\.edu$' then 'princeton'
       when v_host ~ '(^|\.)upenn\.edu$' then 'upenn'
       when v_host ~ '(^|\.)cornell\.edu$' then 'cornell'
       when v_host ~ '(^|\.)columbia\.edu$' then 'columbia'
       when v_host ~ '(^|\.)uchicago\.edu$' then 'uchicago'
       when v_host ~ '(^|\.)yale\.edu$' then 'yale'
       when v_host ~ '(^|\.)northwestern\.edu$' then 'northwestern'
       when v_host ~ '(^|\.)gatech\.edu$' then 'gatech'
       when v_host ~ '(^|\.)caltech\.edu$' then 'caltech'
       when v_host ~ '(^|\.)umich\.edu$' then 'umich'
       else null end;
     if v_institution is not null and not v_institution=any(v_seen) then
       v_seen:=array_append(v_seen,v_institution);
       v_bench:=v_bench+1;
     end if;
   end loop;
 end if;
 if v_bench<2 then v_missing:=v_missing||jsonb_build_array('two_distinct_fetched_official_us_university_sources'); end if;
 if jsonb_typeof(p_private->'tasks')='array' then
   v_tasks:=jsonb_array_length(p_private->'tasks');
   for v_item in select value from jsonb_array_elements(p_private->'tasks') loop
     if length(coalesce(v_item->>'competency',''))<2
       or length(coalesce(v_item->>'scenario',''))<90
       or length(coalesce(v_item->>'prompt',''))<85
       or length(coalesce(v_item->>'reference_answer',''))<90
       or jsonb_typeof(v_item->'grading_anchors') is distinct from 'array'
       or jsonb_array_length(case when jsonb_typeof(v_item->'grading_anchors')='array'
                         then v_item->'grading_anchors' else '[]'::jsonb end)<3 then
       v_missing:=v_missing||jsonb_build_array('domain_specific_private_task_incomplete');
       exit;
     end if;
   end loop;
 end if;
 if v_tasks<4 then v_missing:=v_missing||jsonb_build_array('at_least_four_unseen_domain_tasks'); end if;
 return jsonb_build_object('ok',v_missing='[]'::jsonb,'missing',v_missing,
   'official_benchmark_institutions',v_seen,'curriculum_competencies',v_comp,'hidden_tasks',v_tasks);
end;
$$;

create or replace function agent_lab.expertise_standard_gate_v0_3(p_agent_id uuid,p_artifact_id uuid)
returns jsonb language plpgsql stable set search_path to 'pg_catalog','agent_lab'
as $$
declare v agent_lab.expertise_standard_versions%rowtype; v_check jsonb;
begin
 select * into v from agent_lab.expertise_standard_versions
 where agent_id=p_agent_id and artifact_id=p_artifact_id and status='approved' limit 1;
 if not found then return jsonb_build_object('ready',false,'reason','AAU_independent_masters_standard_not_approved'); end if;
 v_check:=agent_lab.validate_owned_expertise_standard_v0_3(v.public_spec,v.private_assessment,v.source_receipts);
 return jsonb_build_object('ready',coalesce((v_check->>'ok')::boolean,false)
      and nullif(v.author_model,'') is not null and nullif(v.reviewer_model,'') is not null
      and v.author_model<>v.reviewer_model and v.specification_sha256 is not null,
    'standard_id',v.standard_id,'sha256',v.specification_sha256,
    'academic_target',v.public_spec->>'academic_target',
    'reason',case when coalesce((v_check->>'ok')::boolean,false) then 'approved' else 'standard_validation_failed' end,
    'checks',v_check);
end;
$$;
revoke all on function agent_lab.validate_owned_expertise_standard_v0_3(jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function agent_lab.expertise_standard_gate_v0_3(uuid,uuid) from public,anon,authenticated;
