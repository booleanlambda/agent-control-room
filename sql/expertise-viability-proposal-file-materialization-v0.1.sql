-- Automatically materialize each unified Expertise + Viability proposal into Control Room files.
-- One human-readable Markdown file + one authoritative JSON snapshot, attached to one agent chat event.

CREATE OR REPLACE FUNCTION agent_lab.materialize_expertise_viability_proposal_files_v0_1(p_proposal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_p agent_lab.expertise_economic_proposals%rowtype;
  v_cognition_run_id uuid;
  v_activity_id uuid;
  v_version integer;
  v_md text;
  v_json text;
  v_md_name text;
  v_json_name text;
  v_md_id uuid;
  v_json_id uuid;
  v_message_id uuid;
  v_existing jsonb;
begin
  select * into v_p
  from agent_lab.expertise_economic_proposals
  where proposal_id=p_proposal_id;

  if not found then
    raise exception 'expertise_viability_proposal_not_found';
  end if;

  if coalesce(v_p.report->>'proposal_contract_version','') <> 'expertise_viability_proposal_v0_1' then
    return jsonb_build_object(
      'status','skipped',
      'reason','not_unified_expertise_viability_contract',
      'proposal_id',p_proposal_id
    );
  end if;

  v_version:=greatest(1,coalesce(v_p.revision_count,0)+1);
  v_md_name:=format('expertise_viability_proposal_v%s.md',v_version);
  v_json_name:=format('expertise_viability_proposal_v%s.json',v_version);

  select jsonb_build_object(
    'status','reused',
    'proposal_id',p_proposal_id,
    'version',v_version,
    'files',coalesce(jsonb_agg(jsonb_build_object(
      'file_id',f.file_id,'filename',f.filename,'message_id',f.source_message_id
    ) order by f.filename),'[]'::jsonb)
  )
  into v_existing
  from agent_lab.agent_files f
  where f.agent_id=v_p.agent_id
    and f.metadata->>'expertise_viability_proposal_id'=p_proposal_id::text
    and f.metadata->>'proposal_revision_number'=v_version::text;

  if jsonb_array_length(coalesce(v_existing->'files','[]'::jsonb)) >= 2 then
    return v_existing;
  end if;

  select c.cognition_run_id,c.activity_id
    into v_cognition_run_id,v_activity_id
  from agent_lab.cognition_runs c
  where c.agent_id=v_p.agent_id
    and c.metadata->>'wake_request_id'=coalesce(v_p.source_wake_request_id::text,'')
  order by c.started_at desc
  limit 1;

  v_md :=
    '# Expertise + Viability Proposal v'||v_version||E'\n\n'
    ||'**Proposal ID:** '||v_p.proposal_id::text||E'\n\n'
    ||'**Domain:** '||coalesce(v_p.report->>'domain',v_p.domain,'—')||E'\n\n'
    ||'**Status at submission:** '||coalesce(v_p.status,'—')||E'\n\n'
    ||'**Contract:** expertise_viability_proposal_v0_1'||E'\n\n'
    ||'> Operator approval authorizes this expertise-development path as a unit with its viability thesis. It does not verify competence, customers, revenue, funding, profit, or measured socioeconomic impact.'
    ||E'\n\n## Target Standard\n\n'||coalesce(v_p.report->>'target_standard','—')
    ||E'\n\n## Scope\n\n~~~json\n'||coalesce(jsonb_pretty(v_p.report->'scope'),'{}')||E'\n~~~\n'
    ||E'\n## Competencies\n\n~~~json\n'||coalesce(jsonb_pretty(v_p.report->'competencies'),'[]')||E'\n~~~\n'
    ||E'\n## Evidence Requirements\n\n~~~json\n'||coalesce(jsonb_pretty(v_p.report->'evidence_requirements'),'{}')||E'\n~~~\n'
    ||E'\n## Verification Plan\n\n~~~json\n'||coalesce(jsonb_pretty(v_p.report->'verification_plan'),'{}')||E'\n~~~\n'
    ||E'\n## Intended Application\n\n~~~json\n'||coalesce(jsonb_pretty(v_p.report->'intended_application'),'{}')||E'\n~~~\n'
    ||E'\n## Structured Economic Viability\n\n~~~json\n'||coalesce(jsonb_pretty(v_p.report->'economic_viability'),'{}')||E'\n~~~\n'
    ||E'\n## Economic Case\n\n'||coalesce(v_p.report->>'economic_case','—')
    ||E'\n\n## Socioeconomic Case\n\n'||coalesce(v_p.report->>'socioeconomic_case','—')
    ||E'\n\n## Evidence\n\n~~~json\n'||coalesce(jsonb_pretty(v_p.report->'evidence'),'[]')||E'\n~~~\n'
    ||E'\n## Confidence and Remaining Gaps\n\n'||coalesce(v_p.report->>'confidence_and_gaps','—')
    ||E'\n\n## Agent Recommendation\n\n'||coalesce(v_p.report->>'recommended_decision','No recommendation supplied.')
    ||E'\n';

  v_json:=jsonb_pretty(
    jsonb_build_object(
      'proposal_id',v_p.proposal_id,
      'agent_id',v_p.agent_id,
      'status',v_p.status,
      'revision_count',v_p.revision_count,
      'source_wake_request_id',v_p.source_wake_request_id,
      'submitted_at',v_p.updated_at,
      'report',v_p.report
    )
  );

  v_md_id:=extensions.gen_random_uuid();
  v_json_id:=extensions.gen_random_uuid();

  insert into agent_lab.admin_chat_messages(
    agent_id,sender_kind,content,delivery_status,source_wake_request_id,
    source_activity_id,attachment_count,primary_file_id,metadata
  ) values (
    v_p.agent_id,
    'agent',
    'Submitted unified Expertise + Viability Proposal v'||v_version
      ||' for '||coalesce(v_p.report->>'domain',v_p.domain,'selected domain')||'.',
    'responded',
    v_p.source_wake_request_id,
    v_activity_id,
    2,
    v_md_id,
    jsonb_build_object(
      'origin','expertise_viability_proposal_materialization_v0_1',
      'expertise_viability_proposal_id',v_p.proposal_id,
      'proposal_revision_number',v_version,
      'file_channel_version','agent_file_channel_v0_2'
    )
  ) returning message_id into v_message_id;

  insert into agent_lab.agent_files(
    file_id,agent_id,sender_kind,recipient_kind,direction,filename,mime_type,
    file_size_bytes,storage_bucket,storage_path,caption,purpose,inline_text,
    source_message_id,source_activity_id,source_cognition_run_id,
    source_wake_request_id,processing_status,visibility,metadata
  ) values
  (
    v_md_id,v_p.agent_id,'agent','admin','outbound',v_md_name,'text/markdown',
    octet_length(v_md),'inline',
    'inline/'||v_p.agent_id::text||'/'||v_md_id::text||'/'||v_md_name,
    'Human-readable unified Expertise + Viability Proposal for operator review.',
    'agent_output',v_md,v_message_id,v_activity_id,v_cognition_run_id,
    v_p.source_wake_request_id,'delivered','shared_with_admin',
    jsonb_build_object(
      'origin','expertise_viability_proposal_materialization_v0_1',
      'expertise_viability_proposal_id',v_p.proposal_id,
      'proposal_revision_number',v_version,
      'proposal_contract_version','expertise_viability_proposal_v0_1',
      'artifact_role','human_readable',
      'file_channel_version','agent_file_channel_v0_2'
    )
  ),
  (
    v_json_id,v_p.agent_id,'agent','admin','outbound',v_json_name,'application/json',
    octet_length(v_json),'inline',
    'inline/'||v_p.agent_id::text||'/'||v_json_id::text||'/'||v_json_name,
    'Authoritative JSON snapshot of the unified Expertise + Viability Proposal.',
    'agent_output',v_json,v_message_id,v_activity_id,v_cognition_run_id,
    v_p.source_wake_request_id,'delivered','shared_with_admin',
    jsonb_build_object(
      'origin','expertise_viability_proposal_materialization_v0_1',
      'expertise_viability_proposal_id',v_p.proposal_id,
      'proposal_revision_number',v_version,
      'proposal_contract_version','expertise_viability_proposal_v0_1',
      'artifact_role','authoritative_json',
      'file_channel_version','agent_file_channel_v0_2'
    )
  );

  return jsonb_build_object(
    'status','materialized',
    'proposal_id',v_p.proposal_id,
    'agent_id',v_p.agent_id,
    'version',v_version,
    'message_id',v_message_id,
    'files',jsonb_build_array(
      jsonb_build_object('file_id',v_md_id,'filename',v_md_name,'mime_type','text/markdown'),
      jsonb_build_object('file_id',v_json_id,'filename',v_json_name,'mime_type','application/json')
    )
  );
end
$function$
;

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
  end if;
  return new;
end
$function$
;

drop trigger if exists trg_expertise_viability_proposal_materialize_files_v0_1
on agent_lab.expertise_economic_proposals;

CREATE TRIGGER trg_expertise_viability_proposal_materialize_files_v0_1 AFTER INSERT OR UPDATE OF report, status, source_wake_request_id ON agent_lab.expertise_economic_proposals FOR EACH ROW EXECUTE FUNCTION agent_lab.after_expertise_viability_proposal_materialize_files_v0_1();
