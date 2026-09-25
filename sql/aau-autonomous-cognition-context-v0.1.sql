-- AAU agent-native autonomous decomposition context bridge v0.1
-- The agent chooses whether/what context to request. Runtime only returns recorded facts.
begin;

create or replace function public.aau_bridge_autonomous_cognition_context(
  p_bridge_token text,
  p_agent_id uuid,
  p_context_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_key text:=lower(btrim(coalesce(p_context_key,'')));
  v_result jsonb:='{}'::jsonb;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  if v_key='expertise_history' then
    select jsonb_build_object(
      'status','ready',
      'context_key',v_key,
      'candidates',coalesce(jsonb_agg(jsonb_build_object(
        'proposal_id',p.proposal_id,
        'domain',p.domain,
        'status',p.status,
        'candidate_cohort',p.report->>'candidate_cohort',
        'candidate_ordinal',p.report->>'candidate_ordinal',
        'pre_entrepreneurship_masters_draft',p.report->>'pre_entrepreneurship_masters_draft',
        'invalidated_for_selection',p.report->>'invalidated_for_selection',
        'recommended_decision',p.report->>'recommended_decision',
        'economic_case',left(coalesce(p.report->>'economic_case',''),1800),
        'socioeconomic_case',left(coalesce(p.report->>'socioeconomic_case',''),1800),
        'confidence_and_gaps',left(coalesce(p.report->>'confidence_and_gaps',''),1200),
        'created_at',p.created_at,
        'updated_at',p.updated_at
      ) order by p.created_at),'[]'::jsonb)
    ) into v_result
    from agent_lab.expertise_economic_proposals p
    where p.agent_id=p_agent_id;
    return coalesce(v_result,jsonb_build_object('status','ready','context_key',v_key,'candidates','[]'::jsonb));

  elsif v_key='masters_record' then
    select jsonb_build_object(
      'status','ready',
      'context_key',v_key,
      'requirement_status',r.status,
      'academic_equivalence_level',r.academic_equivalence_level,
      'specialization',r.specialization,
      'verifier',r.verifier,
      'verified_at',r.verified_at,
      'verification_report',r.verification_report,
      'enrollment',(
        select jsonb_build_object(
          'status',e.status,'overall_score',e.overall_score,
          'current_course_code',e.current_course_code,
          'current_unit_order',e.current_unit_order,
          'completed_at',e.completed_at
        )
        from agent_lab.entrepreneurship_enrollments e
        where e.agent_id=p_agent_id and e.program_version='entrepreneurship_masters_v0_1'
        limit 1
      )
    ) into v_result
    from agent_lab.mba_entrepreneurship_requirements r
    where r.agent_id=p_agent_id;
    return coalesce(v_result,jsonb_build_object('status','not_found','context_key',v_key));

  elsif v_key='resources' then
    return jsonb_build_object(
      'status','ready',
      'context_key',v_key,
      'existence_account',(
        select jsonb_build_object(
          'account_state',x.account_state,'levy_enabled',x.levy_enabled,
          'next_due_at',x.next_due_at,'arrears_balance',x.arrears_balance,
          'missed_cycles',x.missed_cycles,'total_assessed',x.total_assessed,
          'total_paid',x.total_paid,'total_sponsored',x.total_sponsored
        )
        from agent_lab.agent_existence_accounts x where x.agent_id=p_agent_id
      ),
      'resource_accounts',(
        select coalesce(jsonb_agg(jsonb_build_object(
          'resource_type',a.resource_type,'balance',a.balance,
          'renewal_threshold',a.renewal_threshold,'account_state',a.account_state,
          'updated_at',a.updated_at
        ) order by a.resource_type),'[]'::jsonb)
        from agent_lab.resource_accounts a where a.agent_id=p_agent_id
      )
    );

  else
    return jsonb_build_object(
      'status','unavailable',
      'context_key',v_key,
      'available_database_context_keys',jsonb_build_array(
        'expertise_history','masters_record','resources'
      )
    );
  end if;
end;
$function$;

revoke all on function public.aau_bridge_autonomous_cognition_context(text,uuid,text)
  from public,anon,authenticated;
grant execute on function public.aau_bridge_autonomous_cognition_context(text,uuid,text)
  to anon,authenticated,service_role;

commit;
