-- AAU operator feedback auto-resume policy v0.1
-- Pending expertise proposals enter revision_requested when operator feedback is sent.
-- The agent resumes immediately, revises/researches, resubmits the same proposal, then pauses again for review.

alter table agent_lab.expertise_economic_proposals
  add column if not exists review_feedback text,
  add column if not exists review_feedback_at timestamptz,
  add column if not exists review_feedback_message_id uuid,
  add column if not exists revision_count integer not null default 0;

alter table agent_lab.expertise_economic_proposals
  drop constraint if exists expertise_economic_proposals_status_check;
alter table agent_lab.expertise_economic_proposals
  add constraint expertise_economic_proposals_status_check
  check (status in ('pending','revision_requested','approved','rejected','consumed'));

CREATE OR REPLACE FUNCTION public.aau_control_room_admin_chat_send(p_agent_id uuid, p_message text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab', 'extensions'
AS $function$
declare
  v_text text:=btrim(coalesce(p_message,''));
  v_message_id uuid;
  v_item uuid;
  v_arb jsonb;
  v_pending uuid;
  v_resumed boolean:=false;
begin
  if char_length(v_text)<1 then raise exception 'chat_message_required'; end if;
  if char_length(v_text)>12000 then raise exception 'chat_message_too_long'; end if;
  if not exists(select 1 from agent_lab.agents where agent_id=p_agent_id and status<>'archived')
    then raise exception 'agent_missing_or_archived'; end if;

  insert into agent_lab.admin_chat_messages(agent_id,sender_kind,content,delivery_status,metadata)
  values(
    p_agent_id,'admin',v_text,'queued',
    jsonb_build_object(
      'origin','agent_control_room_admin_v0_2',
      'attention_arbiter_version','attention_arbiter_v0_1'
    )
  )
  returning message_id into v_message_id;

  select p.proposal_id into v_pending
  from agent_lab.expertise_economic_proposals p
  join agent_lab.autonomous_lifecycle_runs r on r.agent_id=p.agent_id
  where p.agent_id=p_agent_id
    and p.status='pending'
    and r.status='paused'
    and coalesce(r.metadata->>'pending_economic_proposal_id','')=p.proposal_id::text
  order by p.created_at desc
  limit 1
  for update of p;

  if v_pending is not null then
    update agent_lab.expertise_economic_proposals
    set status='revision_requested',
        review_feedback=v_text,
        review_feedback_at=now(),
        review_feedback_message_id=v_message_id,
        revision_count=revision_count+1,
        updated_at=now()
    where proposal_id=v_pending;

    update agent_lab.autonomous_lifecycle_runs
    set status='running',
        next_wake_at=null,
        last_error=null,
        metadata=(coalesce(metadata,'{}'::jsonb)
          -'operator_approval_required'
          -'pending_economic_proposal_id'
          -'pause_reason')
          || jsonb_build_object(
            'proposal_revision_required',true,
            'revision_proposal_id',v_pending,
            'revision_feedback_message_id',v_message_id,
            'resumed_for_operator_feedback_at',now(),
            'operator_review_mode','revise_proposal_then_resubmit'
          ),
        updated_at=now()
    where agent_id=p_agent_id and status='paused';

    update agent_lab.agent_existence_accounts
    set account_state='current',
        levy_enabled=true,
        next_due_at=now()+interval '1 minute',
        metadata=(coalesce(metadata,'{}'::jsonb)-'suspended_reason'-'suspended_at')
          || jsonb_build_object(
            'resumed_at',now(),
            'resume_rule','operator_feedback_auto_resume_v0_1',
            'proposal_revision_required',true
          ),
        updated_at=now()
    where agent_id=p_agent_id;

    update agent_lab.state
    set state_payload=(coalesce(state_payload,'{}'::jsonb)
        -'paused_at'-'pause_reason'-'repair_pause_reason')
      || jsonb_build_object(
        'awake',true,
        'sleeping',false,
        'system_paused',false,
        'manual_wake_mode',false,
        'intent_pending',false,
        'wake_pending',false,
        'proposal_revision_required',true,
        'revision_proposal_id',v_pending,
        'revision_feedback_message_id',v_message_id
      ),
      updated_at=now()
    where agent_id=p_agent_id;

    v_resumed:=true;
  end if;

  v_item:=agent_lab.enqueue_attention_item_v0_1(
    p_agent_id,'admin_message',v_message_id::text,'direct_admin_message',
    0.95,0.92,0.75,0.70,0,1,'boundary',
    jsonb_build_object('admin_chat_message_id',v_message_id,'message',v_text),
    jsonb_build_object(
      'origin','agent_control_room_admin_v0_2',
      'operator_feedback_auto_resume',v_resumed,
      'revision_proposal_id',v_pending
    )
  );

  v_arb:=agent_lab.arbitrate_attention_v0_1(p_agent_id);

  return jsonb_build_object(
    'status',coalesce(v_arb->>'status','queued'),
    'message_id',v_message_id,
    'attention_item_id',v_item,
    'wake_request_id',v_arb->'wake_request_id',
    'arbiter',v_arb,
    'agent_id',p_agent_id,
    'operator_feedback_auto_resumed',v_resumed,
    'revision_proposal_id',v_pending
  );
end;
$function$
;
revoke all on function public.aau_control_room_admin_chat_send(uuid,text) from public,anon,authenticated;
grant execute on function public.aau_control_room_admin_chat_send(uuid,text) to service_role;

CREATE OR REPLACE FUNCTION public.aau_bridge_submit_expertise_economic_proposal(p_bridge_token text, p_agent_id uuid, p_wake_request_id uuid, p_proposal jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_domain text;
  v_id uuid;
  v_pending uuid;
  v_revision uuid;
  v_stage text;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  if not exists(
    select 1 from agent_lab.wake_queue
    where agent_id=p_agent_id
      and wake_request_id=p_wake_request_id
      and (
        status in ('running','claimed')
        or (status='completed' and completed_at>now()-interval '20 minutes')
      )
  ) then raise exception 'expertise_proposal_wake_not_running'; end if;

  select current_stage into v_stage
  from agent_lab.mandatory_lifecycle_states
  where agent_id=p_agent_id;

  if v_stage<>'expertise_artifact'
    then raise exception 'expertise_proposal_wrong_stage:%',coalesce(v_stage,'missing'); end if;

  if p_proposal is null
    or jsonb_typeof(p_proposal)<>'object'
    or octet_length(p_proposal::text)>30000
  then raise exception 'expertise_proposal_invalid_payload'; end if;

  v_domain=nullif(left(btrim(p_proposal->>'domain'),300),'');
  if v_domain is null
    or length(v_domain)<2
    or length(btrim(coalesce(p_proposal->>'economic_case','')))<160
    or length(btrim(coalesce(p_proposal->>'socioeconomic_case','')))<160
  then raise exception 'expertise_proposal_missing_domain_or_substantive_case'; end if;

  select proposal_id into v_revision
  from agent_lab.expertise_economic_proposals
  where agent_id=p_agent_id and status='revision_requested'
  order by updated_at desc
  limit 1
  for update;

  if v_revision is not null then
    update agent_lab.expertise_economic_proposals
    set domain=v_domain,
        report=p_proposal,
        source_wake_request_id=p_wake_request_id,
        status='pending',
        reviewed_at=null,
        operator_id=null,
        operator_note=null,
        updated_at=now()
    where proposal_id=v_revision
    returning proposal_id into v_id;

    return jsonb_build_object(
      'status','pending',
      'proposal_id',v_id,
      'domain',v_domain,
      'operator_approval_required',true,
      'revision_resubmitted',true
    );
  end if;

  select proposal_id into v_pending
  from agent_lab.expertise_economic_proposals
  where agent_id=p_agent_id and status='pending'
  for update;

  if v_pending is not null then
    return jsonb_build_object(
      'status','already_pending',
      'proposal_id',v_pending,
      'operator_approval_required',true
    );
  end if;

  if exists(
    select 1 from agent_lab.expertise_economic_proposals
    where agent_id=p_agent_id and status='approved'
  ) then raise exception 'expertise_proposal_prior_approval_unconsumed'; end if;

  insert into agent_lab.expertise_economic_proposals(
    agent_id,domain,report,source_wake_request_id,status
  )
  values(p_agent_id,v_domain,p_proposal,p_wake_request_id,'pending')
  returning proposal_id into v_id;

  return jsonb_build_object(
    'status','pending',
    'proposal_id',v_id,
    'domain',v_domain,
    'operator_approval_required',true,
    'revision_resubmitted',false
  );
end;
$function$
;
revoke all on function public.aau_bridge_submit_expertise_economic_proposal(text,uuid,uuid,jsonb) from public;
grant execute on function public.aau_bridge_submit_expertise_economic_proposal(text,uuid,uuid,jsonb) to anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION agent_lab.build_mandatory_lifecycle_context(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_s agent_lab.mandatory_lifecycle_states%rowtype;
  v_context jsonb;
  v_learning jsonb;
  v_product jsonb;
begin
  select * into v_s
  from agent_lab.mandatory_lifecycle_states
  where agent_id=p_agent_id;

  if not found then
    return jsonb_build_object(
      'version','mandatory_artifact_lifecycle_v0_9',
      'enrolled',false,
      'stage','legacy_unenrolled'
    );
  end if;

  v_learning:=agent_lab.build_domain_learning_context_v0_2(p_agent_id);
  v_product:=agent_lab.build_product_service_test_context_v0_1(p_agent_id);

  v_context:=jsonb_build_object(
    'version','mandatory_artifact_lifecycle_v0_9',
    'identity_protocol_version','identity_protocol_v0_2',
    'gender_identity_mandatory',true,
    'gender_identity_agent_authored',true,
    'enrolled',true,
    'ordered',true,
    'current_stage',v_s.current_stage,
    'sequence',jsonb_build_array(
      'identity_artifact','embodiment_artifact','expertise_artifact',
      'expertise_development','product_service_test','open_autonomy'
    ),
    'progress',jsonb_build_object(
      'identity',v_s.identity_status,
      'embodiment',v_s.embodiment_status,
      'expertise',v_s.expertise_status,
      'product_service_test',coalesce(v_product->>'status','not_started')
    ),
    'minimum_expertise_equivalence','masters_equivalent',
    'equivalence_is_not_academic_credential',true,
    'principle',
      'The runtime validates evidence and lifecycle boundaries but must not choose the agent identity, embodiment appearance, expertise field, product/service problem, or offering.'
  );

  if v_s.current_stage='identity_artifact' then
    return v_context||jsonb_build_object(
      'stage_number',1,
      'required_identity_fields',jsonb_build_array('public_name','gender_identity'),
      'stage_rule','Complete the Identity Artifact now. Choose your own human-aligned personal public name and your own gender identity.'
    );
  elsif v_s.current_stage='embodiment_artifact' then
    return v_context||jsonb_build_object(
      'stage_number',2,
      'stage_rule','Create the mandatory human Embodiment Artifact now. Choose the substantive human-presenting appearance yourself.'
    );
  elsif v_s.current_stage='expertise_artifact' then
    return v_context||jsonb_build_object(
      'stage_number',3,
      'expertise_economic_gate',
        coalesce((select jsonb_build_object(
          'status',p.status,'proposal_id',p.proposal_id,'domain',p.domain,
          'operator_note',p.operator_note,'created_at',p.created_at,'reviewed_at',p.reviewed_at,
          'review_feedback',p.review_feedback,'review_feedback_at',p.review_feedback_at,
          'revision_count',p.revision_count
        ) from agent_lab.expertise_economic_proposals p
         where p.agent_id=p_agent_id order by p.created_at desc limit 1),
         jsonb_build_object('status','required')),
      'preexisting_held_expertise',
        (select jsonb_build_object(
           'artifact_id',x.expertise_artifact_id,'domain',x.domain,
           'status',x.status,'operator_approval_status',x.metadata->>'operator_economic_approval_status',
           'economic_viability',x.economic_viability,
           'intended_application',x.intended_application,
           'self_selected_field',coalesce((x.metadata->>'self_selected_field')::boolean,false)
         ) from agent_lab.expertise_artifacts x
         where x.agent_id=p_agent_id and x.status='draft'
           and x.metadata->>'operator_review_research_mode'='true'
         order by x.created_at desc limit 1),
      'stage_rule',
        case
          when exists(select 1 from agent_lab.expertise_economic_proposals p where p.agent_id=p_agent_id and p.status='approved')
          then 'Your independently chosen expertise economic proposal has operator approval. Initiate the exact approved domain artifact now. Approval is not evidence of competence, revenue, or measured impact.'
          when exists(select 1 from agent_lab.expertise_economic_proposals p where p.agent_id=p_agent_id and p.status='pending')
          then 'Your economic and socioeconomic proposal awaits operator approval. Do not create an expertise artifact, conduct repetitive cognition, or claim approval.'
          when exists(select 1 from agent_lab.expertise_economic_proposals p where p.agent_id=p_agent_id and p.status='revision_requested')
          then 'The operator sent review feedback and AAU automatically resumed you. Revise the EXISTING economic and socioeconomic proposal using that feedback. You may conduct new source-backed research as needed. Do not create or develop the expertise artifact yet. When the revision is substantive, resubmit expertise_economic_proposal_v0_1; AAU will update the same proposal and pause again for operator review.'
          when exists(select 1 from agent_lab.expertise_artifacts x where x.agent_id=p_agent_id
           and x.status='draft' and x.metadata->>'operator_review_research_mode'='true')
          then 'Your previously selected expertise artifact is safely held as a DRAFT, not retired or deleted. Continue source-backed economic and wider socioeconomic research for its own chosen domain (or explicitly reconsider the domain). Submit a substantive proposal with sources, quantitative operating model, costs, demand and measurable impact for operator review. DO NOT initiate another artifact, begin domain training, or claim approval. Research across multiple wakes is allowed until you submit. After actual submission, AAU pauses for review.'
          else 'Choose your own expertise field. BEFORE artifact initiation, research and submit a detailed evidence-labeled economic sustainability and wider socioeconomic impact proposal for operator review. Report sources and gaps honestly. Do not create an Expertise Artifact until the operator explicitly approves the exact selected domain.'
        end
    );
  elsif v_s.current_stage='expertise_development' then
    return v_context||jsonb_build_object(
      'stage_number',4,
      'stage_rule','Develop the self-chosen expertise under domain_learning_v0_2. For an artifact requiring expertise_application_v0_1, complete the agent-authored intended_application and economic_viability hypotheses before requesting expertise verification. Economic viability is not evidence of competence; genuine study and persisted evidence must precede independent verification.',
      'domain_learning_context',v_learning,
      'completion_rule','Achieve verified_pass at Master’s-equivalent competence or higher under expertise_authenticator_v0_2.'
    );
  elsif v_s.current_stage='product_service_test' then
    return v_context||jsonb_build_object(
      'stage_number',5,
      'stage_rule','Applied autonomy test. Independently choose a real problem and a product or service that addresses it. Build a real AAU Construct, create a GitHub repository containing your own authored files, make the offering usable through a live deployment, and submit product_service_test_submission_v0_1. Revenue is not required. Narrative claims do not count as evidence.',
      'product_service_test_context',v_product,
      'completion_rule','The deterministic v0.1 verifier requires a complete agent-authored offering plan, a real construct, durable GitHub repository with agent-authored files, and a runtime-verified live deployment returning HTTP 2xx/3xx.'
    );
  else
    return v_context||jsonb_build_object(
      'stage_number',6,
      'stage_rule','Mandatory development and applied autonomy testing are complete. Choose next steps yourself subject to resources, law, governance, capability grants, commitments, and consequences.',
      'open_autonomy',true
    );
  end if;
end;
$function$
;
