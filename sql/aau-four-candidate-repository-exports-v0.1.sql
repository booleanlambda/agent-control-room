-- AAU four-viability proposal exports for selected agent repository.
-- Requires existing agent_lab.agent_files and expertise_economic_proposals tables.
-- Run after sql/aau-four-viability-candidate-persistence-v0.1.sql.
begin;

CREATE OR REPLACE FUNCTION agent_lab.materialize_four_viability_candidate_files_v0_1(p_proposal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_p agent_lab.expertise_economic_proposals%rowtype;
  v_md text;
  v_json text;
  v_md_name text;
  v_json_name text;
  v_md_id uuid;
  v_json_id uuid;
  v_activity_id uuid;
  v_ordinal int;
  v_cohort int;
  v_files jsonb;
  v_new_count int := 0;
begin
  select * into v_p from agent_lab.expertise_economic_proposals
  where proposal_id=p_proposal_id;
  if not found then
    raise exception 'viability_candidate_not_found';
  end if;
  if coalesce(v_p.report->>'candidate_mode','')<>'four_viability_proposals_v0_1'
    or coalesce(v_p.report->>'proposal_contract_version','')<>'expertise_viability_proposal_v0_3' then
    return jsonb_build_object('status','skipped','reason','not_four_viability_candidate');
  end if;

  v_ordinal := coalesce(nullif(v_p.report->>'candidate_ordinal','')::int,0);
  v_cohort := coalesce(nullif(v_p.report->>'candidate_cohort','')::int,1);
  v_md_name := format('viability_candidate_%s_cohort_%s.md',lpad(v_ordinal::text,2,'0'),v_cohort);
  v_json_name := format('viability_candidate_%s_cohort_%s.json',lpad(v_ordinal::text,2,'0'),v_cohort);

  begin
    v_activity_id := nullif(v_p.report->>'canonical_submission_activity_id','')::uuid;
  exception when others then
    v_activity_id := null;
  end;

  v_md := '# Expertise Viability Candidate '||v_ordinal::text||' of 4'
     ||E'\n\n**Agent:** '||coalesce((select public_name from agent_lab.agents where agent_id=v_p.agent_id),'Agent')
     ||E'\n\n**Domain:** '||v_p.domain
     ||E'\n\n**Proposal ID:** '||v_p.proposal_id::text
     ||E'\n\n**Cohort:** '||v_cohort::text
     ||E'\n\n**Submission snapshot status:** '||v_p.status
     ||E'\n\n**Authorship:** Agent-authored viability package; exported to the agent repository by AAU.'
     ||E'\n\n> Operator approval only makes this candidate eligible. Silas independently selects one approved candidate; an AAU-owned academic standard follows. No candidate is an assigned or verified expertise at this stage.'
     ||E'\n\n## Intended Application\n\n~~~json\n'
       ||coalesce(jsonb_pretty(v_p.report->'intended_application'),'{}')||E'\n~~~'
     ||E'\n\n## Economic Viability\n\n~~~json\n'
       ||coalesce(jsonb_pretty(v_p.report->'economic_viability'),'{}')||E'\n~~~'
     ||E'\n\n## Economic Case\n\n'||coalesce(v_p.report->>'economic_case','—')
     ||E'\n\n## Socioeconomic Case\n\n'||coalesce(v_p.report->>'socioeconomic_case','—')
     ||E'\n\n## Supporting Evidence\n\n~~~json\n'
       ||coalesce(jsonb_pretty(v_p.report->'evidence'),'[]')||E'\n~~~'
     ||E'\n\n## Confidence and Gaps\n\n'||coalesce(v_p.report->>'confidence_and_gaps','—')
     ||E'\n\n## Agent Recommended Decision\n\n'||coalesce(v_p.report->>'recommended_decision','Not provided.')
     ||E'\n\n---\nFull original proposal payload is preserved in the paired JSON file.\n';

  v_json := jsonb_pretty(jsonb_build_object(
    'proposal_id',v_p.proposal_id,
    'agent_id',v_p.agent_id,
    'domain',v_p.domain,
    'status_at_export',v_p.status,
    'submitted_at',v_p.created_at,
    'source_wake_request_id',v_p.source_wake_request_id,
    'canonical_submission_activity_id',v_activity_id,
    'report',v_p.report
  ));

  if not exists (
    select 1 from agent_lab.agent_files where agent_id=v_p.agent_id
    and metadata->>'origin'='four_viability_candidate_export_v0_1'
    and metadata->>'expertise_viability_proposal_id'=v_p.proposal_id::text
    and metadata->>'artifact_role'='human_readable'
  ) then
    v_md_id:=extensions.gen_random_uuid();
    insert into agent_lab.agent_files(
      file_id,agent_id,sender_kind,recipient_kind,direction,filename,mime_type,
      file_size_bytes,storage_bucket,storage_path,caption,purpose,inline_text,
      source_activity_id,source_wake_request_id,processing_status,visibility,metadata
    ) values (
      v_md_id,v_p.agent_id,'system','admin','outbound',v_md_name,'text/markdown',
      octet_length(v_md),'inline',
      'inline/'||v_p.agent_id::text||'/'||v_md_id::text||'/'||v_md_name,
      'AAU export of the agent-authored candidate '||v_ordinal::text||' of 4; review pending.',
      'agent_output',v_md,v_activity_id,v_p.source_wake_request_id,'delivered','shared_with_admin',
      jsonb_build_object(
        'origin','four_viability_candidate_export_v0_1',
        'expertise_viability_proposal_id',v_p.proposal_id,
        'proposal_contract_version','expertise_viability_proposal_v0_3',
        'candidate_ordinal',v_ordinal,'candidate_cohort',v_cohort,
        'artifact_role','human_readable','authored_by','agent',
        'exported_by','aau_system','file_channel_version','agent_file_channel_v0_2'
      )
    );
    v_new_count:=v_new_count+1;
  end if;

  if not exists (
    select 1 from agent_lab.agent_files where agent_id=v_p.agent_id
    and metadata->>'origin'='four_viability_candidate_export_v0_1'
    and metadata->>'expertise_viability_proposal_id'=v_p.proposal_id::text
    and metadata->>'artifact_role'='authoritative_json'
  ) then
    v_json_id:=extensions.gen_random_uuid();
    insert into agent_lab.agent_files(
      file_id,agent_id,sender_kind,recipient_kind,direction,filename,mime_type,
      file_size_bytes,storage_bucket,storage_path,caption,purpose,inline_text,
      source_activity_id,source_wake_request_id,processing_status,visibility,metadata
    ) values (
      v_json_id,v_p.agent_id,'system','admin','outbound',v_json_name,'application/json',
      octet_length(v_json),'inline',
      'inline/'||v_p.agent_id::text||'/'||v_json_id::text||'/'||v_json_name,
      'Exact candidate payload and provenance; status is a submission-time snapshot.',
      'agent_output',v_json,v_activity_id,v_p.source_wake_request_id,'delivered','shared_with_admin',
      jsonb_build_object(
        'origin','four_viability_candidate_export_v0_1',
        'expertise_viability_proposal_id',v_p.proposal_id,
        'proposal_contract_version','expertise_viability_proposal_v0_3',
        'candidate_ordinal',v_ordinal,'candidate_cohort',v_cohort,
        'artifact_role','authoritative_json','authored_by','agent',
        'exported_by','aau_system','file_channel_version','agent_file_channel_v0_2'
      )
    );
    v_new_count:=v_new_count+1;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('file_id',file_id,'filename',filename)
                order by filename),'[]'::jsonb)
  into v_files
  from agent_lab.agent_files
  where agent_id=v_p.agent_id
    and metadata->>'origin'='four_viability_candidate_export_v0_1'
    and metadata->>'expertise_viability_proposal_id'=v_p.proposal_id::text;

  return jsonb_build_object('status',case when v_new_count>0 then 'materialized' else 'reused' end,
     'proposal_id',v_p.proposal_id,'new_files',v_new_count,'files',v_files);
end
$function$


create unique index if not exists ux_agent_four_candidate_export_role_v0_1
on agent_lab.agent_files (
 agent_id,(metadata->>'expertise_viability_proposal_id'),(metadata->>'artifact_role')
) where metadata->>'origin'='four_viability_candidate_export_v0_1';

CREATE OR REPLACE FUNCTION agent_lab.after_expertise_viability_proposal_materialize_files_v0_1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
begin
  if new.status='pending'
    and coalesce(new.report->>'proposal_contract_version','')='expertise_viability_proposal_v0_1'
  then
    perform agent_lab.materialize_expertise_viability_proposal_files_v0_1(new.proposal_id);
  elsif coalesce(new.report->>'candidate_mode','')='four_viability_proposals_v0_1'
    and coalesce(new.report->>'proposal_contract_version','')='expertise_viability_proposal_v0_3'
  then
    perform agent_lab.materialize_four_viability_candidate_files_v0_1(new.proposal_id);
  end if;
  return new;
end
$function$


do $$
declare v_id uuid;
begin
  for v_id in
    select proposal_id from agent_lab.expertise_economic_proposals
    where report->>'candidate_mode'='four_viability_proposals_v0_1'
      and report->>'proposal_contract_version'='expertise_viability_proposal_v0_3'
  loop
    perform agent_lab.materialize_four_viability_candidate_files_v0_1(v_id);
  end loop;
end $$;

commit;
