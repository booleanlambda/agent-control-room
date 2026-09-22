-- AAU four-viability-candidate persistence bridge v0.1
-- Keeps canonical cognition/activity as the durable submission authority while
-- remaining compatible with workers that do or do not execute the post-apply
-- expertise proposal RPC.

begin;

alter table agent_lab.expertise_economic_proposals
  drop constraint if exists expertise_economic_proposals_status_check;

alter table agent_lab.expertise_economic_proposals
  add constraint expertise_economic_proposals_status_check
  check (status = any (array[
    'pending'::text,
    'revision_requested'::text,
    'approved'::text,
    'rejected'::text,
    'consumed'::text,
    'candidate_pending'::text,
    'candidate_approved'::text,
    'candidate_rejected'::text,
    'candidate_not_selected'::text
  ]));

create or replace function agent_lab.persist_four_viability_candidate_from_activity_v0_1(p_activity_id uuid)
returns jsonb
language plpgsql
set search_path to 'pg_catalog','agent_lab'
as $$
declare
  v_activity agent_lab.activity_log%rowtype;
  v_state jsonb:='{}'::jsonb;
  v_proposal jsonb;
  v_normalized jsonb;
  v_check jsonb;
  v_domain text;
  v_wake uuid;
  v_cohort int:=1;
  v_target int:=4;
  v_count int:=0;
  v_id uuid;
begin
  select * into v_activity
  from agent_lab.activity_log
  where activity_id=p_activity_id;

  if not found then
    return jsonb_build_object('status','ignored','reason','activity_not_found');
  end if;

  select coalesce(state_payload,'{}'::jsonb) into v_state
  from agent_lab.state
  where agent_id=v_activity.agent_id;

  if coalesce(v_state->>'expertise_candidate_mode','')<>'four_viability_proposals_v0_1'
     or coalesce(v_state->>'expertise_candidate_phase','collecting') not in ('collecting','review_pending') then
    return jsonb_build_object('status','ignored','reason','candidate_mode_not_collecting');
  end if;

  select x.value into v_proposal
  from jsonb_array_elements(coalesce(v_activity.outcome->'associations','[]'::jsonb)) x(value)
  where x.value->>'origin'='expertise_viability_proposal_v0_1'
  limit 1;

  if v_proposal is null then
    return jsonb_build_object('status','ignored','reason','no_viability_proposal_association');
  end if;

  v_normalized:=(v_proposal - 'target_standard' - 'scope' - 'competencies'
      - 'evidence_requirements' - 'verification_plan')
      || jsonb_build_object(
        'proposal_contract_version','expertise_viability_proposal_v0_3',
        'standard_authority','aau_independent_author_and_reviewer'
      );

  v_check:=agent_lab.validate_expertise_viability_proposal_v0_1(v_normalized);
  if not coalesce((v_check->>'ok')::boolean,false) then
    return jsonb_build_object(
      'status','rejected',
      'reason','proposal_failed_canonical_validation',
      'validation',v_check
    );
  end if;

  v_domain:=left(btrim(v_normalized->>'domain'),300);
  v_cohort:=greatest(1,coalesce(nullif(v_state->>'expertise_candidate_cohort','')::int,1));
  v_target:=greatest(1,coalesce(nullif(v_state->>'expertise_candidate_target_count','')::int,4));

  begin
    v_wake:=nullif(btrim(coalesce(v_activity.input_payload->>'wake_request_id','')),'')::uuid;
  exception when others then
    v_wake:=null;
  end;

  select proposal_id into v_id
  from agent_lab.expertise_economic_proposals
  where agent_id=v_activity.agent_id
    and lower(btrim(domain))=lower(btrim(v_domain))
    and coalesce(report->>'candidate_mode','')='four_viability_proposals_v0_1'
    and coalesce(nullif(report->>'candidate_cohort','')::int,1)=v_cohort
    and status in ('candidate_pending','candidate_approved','candidate_rejected','candidate_not_selected','approved','consumed')
  order by created_at desc limit 1;

  if v_id is not null then
    return jsonb_build_object(
      'status','already_present',
      'proposal_id',v_id,
      'domain',v_domain,
      'candidate_cohort',v_cohort
    );
  end if;

  select count(*)::int into v_count
  from agent_lab.expertise_economic_proposals
  where agent_id=v_activity.agent_id
    and coalesce(report->>'candidate_mode','')='four_viability_proposals_v0_1'
    and coalesce(nullif(report->>'candidate_cohort','')::int,1)=v_cohort
    and status in ('candidate_pending','candidate_approved','candidate_rejected','candidate_not_selected','approved','consumed');

  if v_count>=v_target then
    return jsonb_build_object('status','ignored','reason','candidate_target_already_reached','target_count',v_target);
  end if;

  insert into agent_lab.expertise_economic_proposals(
    agent_id,domain,report,source_wake_request_id,status
  ) values(
    v_activity.agent_id,
    v_domain,
    v_normalized||jsonb_build_object(
      'unit_approval_required',true,
      'candidate_mode','four_viability_proposals_v0_1',
      'candidate_cohort',v_cohort,
      'candidate_ordinal',v_count+1,
      'candidate_submission_semantics','approval_makes_eligible_selection_by_agent_materializes_only_one',
      'canonical_submission_activity_id',p_activity_id,
      'persistence_bridge','activity_log_candidate_persistence_v0_1'
    ),
    v_wake,
    'candidate_pending'
  )
  returning proposal_id into v_id;

  v_count:=v_count+1;

  if v_count>=v_target then
    update agent_lab.state
    set state_payload=(coalesce(state_payload,'{}'::jsonb)
        -'repair_pause_reason'-'boundary_interrupt_pending'-'boundary_attention_item_id')
        ||jsonb_build_object(
          'expertise_candidate_phase','review_pending',
          'system_paused',true,
          'awake',false,
          'sleeping',false,
          'wake_pending',false,
          'intent_pending',false,
          'expertise_candidate_review_started_at',now(),
          'expertise_candidate_persistence_bridge','activity_log_candidate_persistence_v0_1'
        ),
        updated_at=now()
    where agent_id=v_activity.agent_id;

    update agent_lab.autonomous_lifecycle_runs
    set status='paused',next_wake_at=null,last_error=null,
        metadata=(coalesce(metadata,'{}'::jsonb)
          -'repair_required'-'repair_required_at'-'last_failure_details'
          -'last_failure_details_at'-'last_failure_intent_execution_id')
          ||jsonb_build_object(
            'operator_approval_required',true,
            'pause_reason','Await operator review of four expertise viability candidates',
            'expertise_candidate_phase','review_pending',
            'expertise_candidate_cohort',v_cohort,
            'expertise_candidate_target_count',v_target,
            'candidate_mode','four_viability_proposals_v0_1',
            'persistence_bridge','activity_log_candidate_persistence_v0_1'
          ),
        updated_at=now()
    where agent_id=v_activity.agent_id;

    update agent_lab.agent_existence_accounts
    set account_state='suspended',
        levy_enabled=false,
        next_due_at=coalesce(next_due_at,now()+interval '1 minute'),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'suspended_reason','awaiting_four_candidate_viability_review',
          'suspended_at',now(),
          'persistence_bridge','activity_log_candidate_persistence_v0_1'
        ),
        updated_at=now()
    where agent_id=v_activity.agent_id;

    update agent_lab.wake_queue
    set status='cancelled',
        completed_at=coalesce(completed_at,now()),
        last_error='awaiting_four_candidate_viability_review',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'candidate_mode','four_viability_proposals_v0_1',
          'candidate_cohort',v_cohort,
          'cancelled_by','activity_log_candidate_persistence_v0_1'
        )
    where agent_id=v_activity.agent_id and status='queued';
  end if;

  return jsonb_build_object(
    'status','candidate_persisted',
    'proposal_id',v_id,
    'domain',v_domain,
    'candidate_ordinal',v_count,
    'candidate_count',v_count,
    'target_count',v_target,
    'candidate_cohort',v_cohort,
    'review_pending',v_count>=v_target
  );
end
$$;

create or replace function agent_lab.after_activity_persist_four_viability_candidate_v0_1()
returns trigger
language plpgsql
set search_path to 'pg_catalog','agent_lab'
as $$
begin
  perform agent_lab.persist_four_viability_candidate_from_activity_v0_1(new.activity_id);
  return new;
end
$$;

drop trigger if exists trg_activity_persist_four_viability_candidate_v0_1
on agent_lab.activity_log;

create trigger trg_activity_persist_four_viability_candidate_v0_1
after insert on agent_lab.activity_log
for each row
execute function agent_lab.after_activity_persist_four_viability_candidate_v0_1();

-- Make the post-apply proposal RPC idempotent when the activity trigger
-- already persisted the same wake/domain candidate.
do $$
declare
  v_def text;
  v_anchor text;
  v_insert text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='aau_bridge_submit_expertise_viability_proposal'
    and pg_get_function_identity_arguments(p.oid)='p_bridge_token text, p_agent_id uuid, p_wake_request_id uuid, p_proposal jsonb';

  if v_def is not null and position('idempotent_activity_bridge_replay' in v_def)=0 then
    v_anchor := E'  v_target:=greatest(1,coalesce(nullif(v_state->>''expertise_candidate_target_count'','''')::int,4));\n\n';
    v_insert := v_anchor
      || E'  -- idempotent_activity_bridge_replay\n'
      || E'  if v_phase in (''collecting'',''review_pending'') then\n'
      || E'    select proposal_id into v_id from agent_lab.expertise_economic_proposals\n'
      || E'    where agent_id=p_agent_id and source_wake_request_id=p_wake_request_id\n'
      || E'      and lower(btrim(domain))=lower(btrim(v_domain))\n'
      || E'      and status=''candidate_pending''\n'
      || E'      and coalesce(report->>''candidate_mode'','''')=''four_viability_proposals_v0_1''\n'
      || E'      and coalesce(nullif(report->>''candidate_cohort'','''')::int,1)=v_cohort\n'
      || E'    order by created_at desc limit 1;\n'
      || E'    if v_id is not null then\n'
      || E'      select count(*)::int into v_count from agent_lab.expertise_economic_proposals\n'
      || E'      where agent_id=p_agent_id\n'
      || E'        and coalesce(report->>''candidate_mode'','''')=''four_viability_proposals_v0_1''\n'
      || E'        and coalesce(nullif(report->>''candidate_cohort'','''')::int,1)=v_cohort\n'
      || E'        and status in (''candidate_pending'',''candidate_approved'',''candidate_rejected'',''candidate_not_selected'',''approved'',''consumed'');\n'
      || E'      return jsonb_build_object(''status'',''candidate_pending'',''proposal_id'',v_id,''domain'',v_domain,\n'
      || E'        ''candidate_count'',v_count,''target_count'',v_target,''candidate_cohort'',v_cohort,\n'
      || E'        ''paused_for_operator_review'',v_phase=''review_pending'',\n'
      || E'        ''operator_approval_required'',v_phase=''review_pending'',\n'
      || E'        ''idempotent_activity_bridge_replay'',true,\n'
      || E'        ''contract_version'',''four_viability_proposals_v0_1'');\n'
      || E'    end if;\n'
      || E'  end if;\n\n';
    if position(v_anchor in v_def)>0 then
      v_def:=replace(v_def,v_anchor,v_insert);
      v_def:=replace(v_def,
        'account_state=''suspended'',levy_enabled=false,next_due_at=null,',
        'account_state=''suspended'',levy_enabled=false,next_due_at=coalesce(next_due_at,now()+interval ''1 minute''),'
      );
      execute v_def;
    end if;
  end if;
end $$;

commit;
