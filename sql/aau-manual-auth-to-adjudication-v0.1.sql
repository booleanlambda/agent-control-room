-- AAU manual authentication -> distinct adjudication handoff v0.1
-- Preserves frozen candidate evidence and operator-attested authenticator grades.
-- Allows the normal worker to perform only required distinct adjudication.

CREATE OR REPLACE FUNCTION agent_lab.operator_resume_manual_authentication_to_adjudication_v0_1(p_verification_run_id uuid, p_operator_id text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v agent_lab.expertise_verification_runs%rowtype;
  a agent_lab.verification_intervention_alerts%rowtype;
  v_hash text;
  v_tasks int;
  v_auth int;
  v_flagged int:=0;
  g jsonb;
begin
  if nullif(btrim(coalesce(p_operator_id,'')),'') is null
     or length(btrim(coalesce(p_reason,'')))<10
  then raise exception 'operator_identity_and_substantive_reason_required'; end if;

  select * into v from agent_lab.expertise_verification_runs
  where verification_run_id=p_verification_run_id for update;
  if not found then raise exception 'verification_run_not_found'; end if;

  select * into a from agent_lab.verification_intervention_alerts
  where verification_run_id=p_verification_run_id for update;
  if not found then raise exception 'manual_intervention_alert_not_found'; end if;

  if v.status<>'manual_required'
     or a.status<>'operator_requested'
     or coalesce((v.metadata->>'manual_review_active')::boolean,false)=false
     or v.metadata->>'manual_review_operator'<>p_operator_id
  then raise exception 'manual_authentication_handoff_not_owned_or_active'; end if;

  v_hash:=encode(sha256(convert_to(jsonb_build_object(
    'challenge',v.challenge_packet,'answers',v.candidate_answers)::text,'UTF8')),'hex');
  if v_hash<>v.metadata->>'manual_candidate_snapshot_sha256'
  then raise exception 'candidate_evidence_changed_since_manual_claim'; end if;

  v_tasks:=jsonb_array_length(v.challenge_packet->'tasks');
  v_auth:=jsonb_array_length(coalesce(v.authenticator_grades,'[]'::jsonb));
  if v_auth<>v_tasks then raise exception 'manual_authentication_incomplete:%/%',v_auth,v_tasks; end if;

  for g in select value from jsonb_array_elements(v.authenticator_grades) loop
    if (g->>'score')::numeric between 0.75 and 0.85
       or nullif(g->>'critical_error','') is not null
       or coalesce((g->>'unsupported')::boolean,false)
       or coalesce((g->>'confidence')::numeric,0)<0.70
    then v_flagged:=v_flagged+1; end if;
  end loop;

  if v_flagged=0 then
    raise exception 'no_adjudication_required_use_manual_finalize';
  end if;

  update agent_lab.expertise_verification_runs
  set status='pending',
      updated_at=now(),
      metadata=(metadata-'claim_expires_at'-'retry_after_at'-'claimed_by'-'claimed_at')
        ||jsonb_build_object(
          'manual_resume_active',true,
          'manual_review_stage','adjudication_pending',
          'manual_authentication_completed_at',now(),
          'manual_authentication_operator',left(p_operator_id,180),
          'manual_adjudication_required_count',v_flagged,
          'manual_adjudication_handoff_reason',left(p_reason,1000),
          'manual_adjudication_handoff_policy','operator_auth_to_distinct_worker_adjudicator_v0_1'
        )
  where verification_run_id=p_verification_run_id;

  update agent_lab.verification_intervention_alerts
  set updated_at=now(),
      metadata=metadata||jsonb_build_object(
        'manual_authentication_completed_at',now(),
        'manual_adjudication_handoff_at',now(),
        'manual_adjudication_required_count',v_flagged,
        'operator_id',left(p_operator_id,180)
      )
  where verification_run_id=p_verification_run_id;

  return jsonb_build_object(
    'ok',true,
    'status','adjudication_pending',
    'verification_run_id',p_verification_run_id,
    'authenticated_tasks',v_auth,
    'adjudication_required_tasks',v_flagged,
    'candidate_snapshot_sha256',v_hash,
    'next_step','Distinct worker adjudicator reviews only flagged frozen tasks; candidate answers are not regenerated.'
  );
end
$function$;

revoke all on function agent_lab.operator_resume_manual_authentication_to_adjudication_v0_1(uuid,text,text)
  from public, anon, authenticated;
