-- AAU compute renewal threshold v0.1, deployed 2026-09-20.
-- Creates a system-initiated review when compute <= active threshold, not an
-- agent-authored request or an approved grant. Approval remains independent.
-- Applies through both single and batched minute existence-levy assessors.
-- Request is idempotent within a depleted-funding episode.
-- The terminal NVIDIA timeout pause remains independent of resource review.
CREATE OR REPLACE FUNCTION agent_lab.ensure_existence_renewal_review_v0_1(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
DECLARE
  v_policy agent_lab.existence_credit_policies%rowtype;
  v_balance numeric;
  v_anchor timestamptz;
  v_request jsonb;
BEGIN
  SELECT * INTO v_policy
    FROM agent_lab.existence_credit_policies
   WHERE active=true AND effective_from<=now() AND (effective_to IS NULL OR effective_to>now())
   ORDER BY effective_from DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','active_credit_policy_missing'); END IF;

  SELECT balance INTO v_balance FROM agent_lab.resource_accounts
   WHERE agent_id=p_agent_id AND resource_type='compute' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','compute_account_missing'); END IF;
  IF v_balance > v_policy.renewal_threshold_credits THEN
    RETURN jsonb_build_object('status','above_renewal_threshold','balance',v_balance);
  END IF;

  -- One review request per low-balance episode. A new episode begins only
  -- after funding/restoration lifts balance above the policy threshold.
  SELECT COALESCE(
      (SELECT max(l.created_at) FROM agent_lab.resource_ledger l
        WHERE l.agent_id=p_agent_id AND l.resource_type='compute'
          AND l.delta>0 AND l.balance_after>v_policy.renewal_threshold_credits),
      (SELECT created_at FROM agent_lab.resource_accounts
        WHERE agent_id=p_agent_id AND resource_type='compute'),
      '-infinity'::timestamptz)
    INTO v_anchor;

  IF EXISTS(
    SELECT 1 FROM agent_lab.existence_credit_requests r
     WHERE r.agent_id=p_agent_id AND r.request_kind='renewal' AND r.created_at>=v_anchor
  ) THEN
    RETURN jsonb_build_object('status','renewal_already_recorded_for_low_balance_episode',
      'balance',v_balance,'episode_anchor',v_anchor);
  END IF;

  v_request:=agent_lab.submit_existence_credit_request(
    p_agent_id,'renewal',NULL,NULL,
    'AAU SYSTEM-GENERATED renewal review: compute balance reached '
      ||v_balance::text||' at or below the active policy threshold '
      ||v_policy.renewal_threshold_credits::text
      ||'. This is not an agent-authored request and does not authorize a grant. '
      ||'Independent usefulness and legal review are required before reset.',
    NULL,NULL
  );
  RETURN coalesce(v_request,'{}'::jsonb)||jsonb_build_object(
    'origin','automatic_resource_threshold_v0_1',
    'system_authored',true,'not_agent_authored',true);
END
$function$;

REVOKE ALL ON FUNCTION agent_lab.ensure_existence_renewal_review_v0_1(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION agent_lab.assess_existence_levy(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'agent_lab', 'public', 'extensions', 'pg_temp'
AS $function$ declare v_ea agent_lab.agent_existence_accounts%rowtype; v_policy agent_lab.existence_policies%rowtype; v_agent_status text; v_amount numeric; v_sponsor agent_lab.existence_sponsorships%rowtype; v_sponsor_balance numeric:=0; v_sponsor_pay numeric:=0; v_self_balance numeric:=0; v_self_pay numeric:=0; v_due numeric:=0; v_event_id uuid; v_period_start timestamptz; v_period_end timestamptz; v_new_arrears numeric:=0; v_state text; v_resource_type text; v_interval_minutes integer; v_grace_cycles integer; v_dormancy_cycles integer; begin select * into v_ea from agent_lab.agent_existence_accounts where agent_id=p_agent_id for update; if not found or not v_ea.levy_enabled then return jsonb_build_object('status','disabled_or_missing'); end if; if v_ea.next_due_at>now() then return jsonb_build_object('status','not_due','next_due_at',v_ea.next_due_at); end if; select * into v_policy from agent_lab.existence_policies where existence_policy_id=v_ea.existence_policy_id; select status into v_agent_status from agent_lab.agents where agent_id=p_agent_id; v_resource_type:=v_policy.resource_type; v_interval_minutes:=greatest(1,coalesce(v_policy.levy_interval_minutes,1)); v_amount:=round((v_policy.base_minute_levy*coalesce(nullif(v_policy.status_multipliers->>v_agent_status,'')::numeric,1)*v_interval_minutes)::numeric,12); v_period_end:=v_ea.next_due_at; v_period_start:=v_period_end-make_interval(mins=>v_interval_minutes); v_due:=v_amount+v_ea.arrears_balance; v_grace_cycles:=greatest(1,ceil(v_policy.grace_minutes::numeric/v_interval_minutes)::integer); v_dormancy_cycles:=greatest(v_grace_cycles+1,ceil(v_policy.dormancy_arrears_minutes::numeric/v_interval_minutes)::integer); select s.* into v_sponsor from agent_lab.existence_sponsorships s where s.beneficiary_agent_id=p_agent_id and s.status='active' and s.auto_pay and s.sponsor_kind='agent' and s.resource_type=v_resource_type and s.starts_at<=now() and (s.ends_at is null or s.ends_at>now()) order by s.priority,s.created_at limit 1; if found then select balance into v_sponsor_balance from agent_lab.resource_accounts where agent_id=v_sponsor.sponsor_agent_id and resource_type=v_resource_type for update; v_sponsor_pay:=least(v_due,coalesce(v_sponsor.max_amount_per_cycle,v_due),greatest(coalesce(v_sponsor_balance,0),0)); if v_sponsor_pay>0 then update agent_lab.resource_accounts set balance=balance-v_sponsor_pay,last_spent_at=now(),updated_at=now() where agent_id=v_sponsor.sponsor_agent_id and resource_type=v_resource_type; insert into agent_lab.resource_ledger(agent_id,resource_type,delta,balance_after,action_type,reason,entry_kind,source_type,source_ref,verified,metadata) select v_sponsor.sponsor_agent_id,v_resource_type,-v_sponsor_pay,balance,'existence_sponsorship','Sponsored another agent minute existence levy','spend','existence_sponsorship',v_sponsor.sponsorship_id::text,true,jsonb_build_object('beneficiary_agent_id',p_agent_id,'levy_interval_minutes',v_interval_minutes) from agent_lab.resource_accounts where agent_id=v_sponsor.sponsor_agent_id and resource_type=v_resource_type; v_due:=v_due-v_sponsor_pay; end if; end if; select balance into v_self_balance from agent_lab.resource_accounts where agent_id=p_agent_id and resource_type=v_resource_type for update; v_self_pay:=least(v_due,greatest(coalesce(v_self_balance,0),0)); if v_self_pay>0 then update agent_lab.resource_accounts set balance=balance-v_self_pay,last_spent_at=now(),updated_at=now() where agent_id=p_agent_id and resource_type=v_resource_type; insert into agent_lab.resource_ledger(agent_id,resource_type,delta,balance_after,action_type,reason,entry_kind,source_type,verified,metadata) select p_agent_id,v_resource_type,-v_self_pay,balance,'existence_levy','Minute existence levy: recurring cost of maintained agent existence','spend','existence_levy',true,jsonb_build_object('occupation_independent',true,'levy_interval_minutes',v_interval_minutes,'levy_name','minute existence levy') from agent_lab.resource_accounts where agent_id=p_agent_id and resource_type=v_resource_type; v_due:=v_due-v_self_pay; end if; v_new_arrears:=greatest(v_due,0); v_state:=case when v_new_arrears=0 then 'current' when v_ea.missed_cycles+1<=v_grace_cycles then 'grace' when v_ea.missed_cycles+1>=v_dormancy_cycles then 'dormancy_due' else 'arrears' end; insert into agent_lab.existence_levy_events(agent_id,existence_policy_id,period_start,period_end,resource_type,assessed_amount,paid_amount,self_paid_amount,sponsored_paid_amount,arrears_after,status,settled_at,metadata) values(p_agent_id,v_policy.existence_policy_id,v_period_start,v_period_end,v_resource_type,v_amount,v_self_pay+v_sponsor_pay,v_self_pay,v_sponsor_pay,v_new_arrears,case when v_new_arrears=0 then 'paid' when v_self_pay+v_sponsor_pay>0 then 'partial' else 'unpaid' end,case when v_new_arrears=0 then now() else null end,jsonb_build_object('occupation_independent',true,'agent_status_at_assessment',v_agent_status,'levy_name','minute existence levy','levy_interval_minutes',v_interval_minutes,'minute_rate_basis',v_policy.base_minute_levy)) on conflict(agent_id,period_start,existence_policy_id) do update set paid_amount=excluded.paid_amount,self_paid_amount=excluded.self_paid_amount,sponsored_paid_amount=excluded.sponsored_paid_amount,arrears_after=excluded.arrears_after,status=excluded.status,settled_at=excluded.settled_at,metadata=excluded.metadata returning existence_levy_event_id into v_event_id; if v_self_pay>0 then insert into agent_lab.system_treasury_ledger(entry_type,resource_type,amount,payer_kind,payer_ref,agent_id,existence_levy_event_id,metadata) values('existence_levy',v_resource_type,v_self_pay,'agent',p_agent_id::text,p_agent_id,v_event_id,jsonb_build_object('purpose','platform existence cost','levy_name','minute existence levy','levy_interval_minutes',v_interval_minutes)); end if; if v_sponsor_pay>0 then insert into agent_lab.system_treasury_ledger(entry_type,resource_type,amount,payer_kind,payer_ref,agent_id,existence_levy_event_id,metadata) values('existence_levy',v_resource_type,v_sponsor_pay,'sponsor_agent',v_sponsor.sponsor_agent_id::text,p_agent_id,v_event_id,jsonb_build_object('sponsorship_id',v_sponsor.sponsorship_id,'levy_name','minute existence levy','levy_interval_minutes',v_interval_minutes)); end if; update agent_lab.agent_existence_accounts set account_state=v_state,arrears_balance=v_new_arrears,missed_cycles=case when v_new_arrears=0 then 0 else missed_cycles+1 end,total_assessed=total_assessed+v_amount,total_paid=total_paid+v_self_pay+v_sponsor_pay,total_sponsored=total_sponsored+v_sponsor_pay,dormancy_due=(v_state='dormancy_due'),last_assessed_at=now(),last_paid_at=case when v_self_pay+v_sponsor_pay>0 then now() else last_paid_at end,next_due_at=v_period_end+make_interval(mins=>v_interval_minutes),updated_at=now() where agent_id=p_agent_id; if v_resource_type='compute' then
    begin
      perform agent_lab.ensure_existence_renewal_review_v0_1(p_agent_id);
    exception when others then
      insert into agent_lab.operator_alerts(
        agent_id,alert_type,severity,title,detail,source_ref,metadata
      ) values (
        p_agent_id,'compute_renewal_request_enqueue_failed','warning',
        'Compute renewal request requires intervention',
        'Automatic near-exhaustion renewal request failed; existing levy settlement must remain committed.',
        p_agent_id::text,
        jsonb_build_object('last_error',left(sqlerrm,300),
          'mechanism','automatic_resource_threshold_v0_1')
      )
      on conflict (agent_id,alert_type,source_ref) do update
        set status='open',resolved_at=null,last_seen_at=now(),
            occurrences=agent_lab.operator_alerts.occurrences+1,
            metadata=excluded.metadata;
    end;
  end if;
  return jsonb_build_object('status',case when v_new_arrears=0 then 'paid' when v_self_pay+v_sponsor_pay>0 then 'partial' else 'unpaid' end,'agent_id',p_agent_id,'levy_name','minute existence levy','assessed',v_amount,'self_paid',v_self_pay,'sponsored_paid',v_sponsor_pay,'arrears_after',v_new_arrears,'account_state',v_state,'levy_interval_minutes',v_interval_minutes,'next_due_at',v_period_end+make_interval(mins=>v_interval_minutes)); end; $function$;

CREATE OR REPLACE FUNCTION agent_lab.assess_existence_levy_bulk_v0_1(p_agent_id uuid, p_max_minutes integer DEFAULT 180)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'agent_lab', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_ea agent_lab.agent_existence_accounts%rowtype;
  v_policy agent_lab.existence_policies%rowtype;
  v_agent_status text;
  v_sponsor agent_lab.existence_sponsorships%rowtype;
  v_amount numeric := 0;
  v_sponsor_balance numeric := 0;
  v_sponsor_pay numeric := 0;
  v_self_balance numeric := 0;
  v_self_pay numeric := 0;
  v_due numeric := 0;
  v_new_arrears numeric := 0;
  v_event_id uuid;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_next_due timestamptz;
  v_state text;
  v_resource_type text;
  v_interval_minutes integer;
  v_cycles integer;
  v_grace_cycles integer;
  v_dormancy_cycles integer;
begin
  select * into v_ea from agent_lab.agent_existence_accounts where agent_id=p_agent_id for update;
  if not found or not v_ea.levy_enabled or v_ea.account_state in ('suspended','closed') then
    return jsonb_build_object('status','disabled_or_missing');
  end if;
  if v_ea.next_due_at>now() then
    return jsonb_build_object('status','not_due','next_due_at',v_ea.next_due_at);
  end if;
  select * into v_policy from agent_lab.existence_policies where existence_policy_id=v_ea.existence_policy_id;
  if not found then raise exception 'existence_policy_not_found:%',v_ea.existence_policy_id; end if;
  select status into v_agent_status from agent_lab.agents where agent_id=p_agent_id;
  v_resource_type:=v_policy.resource_type;
  v_interval_minutes:=greatest(1,coalesce(v_policy.levy_interval_minutes,1));
  v_cycles:=least(greatest(1,coalesce(p_max_minutes,180)),
     greatest(1, floor(extract(epoch from (now()-v_ea.next_due_at))/(60*v_interval_minutes))::integer+1));
  v_period_start:=v_ea.next_due_at-make_interval(mins=>v_interval_minutes);
  v_period_end:=v_ea.next_due_at+make_interval(mins=>(v_cycles-1)*v_interval_minutes);
  v_next_due:=v_period_end+make_interval(mins=>v_interval_minutes);

  -- Fail closed if a previous event already exists for this interval; never double charge.
  if exists (
    select 1 from agent_lab.existence_levy_events
    where agent_id=p_agent_id and period_start=v_period_start and existence_policy_id=v_ea.existence_policy_id
  ) then
    raise exception 'bulk_levy_duplicate_period_start:%:%',p_agent_id,v_period_start;
  end if;

  v_amount:=round((v_policy.base_minute_levy
    *coalesce(nullif(v_policy.status_multipliers->>v_agent_status,'')::numeric,1)
    *v_interval_minutes*v_cycles)::numeric,12);
  v_due:=v_amount+v_ea.arrears_balance;
  v_grace_cycles:=greatest(1,ceil(v_policy.grace_minutes::numeric/v_interval_minutes)::integer);
  v_dormancy_cycles:=greatest(v_grace_cycles+1,ceil(v_policy.dormancy_arrears_minutes::numeric/v_interval_minutes)::integer);

  select s.* into v_sponsor
  from agent_lab.existence_sponsorships s
  where s.beneficiary_agent_id=p_agent_id and s.status='active' and s.auto_pay
    and s.sponsor_kind='agent' and s.resource_type=v_resource_type and s.starts_at<=now()
    and (s.ends_at is null or s.ends_at>now())
  order by s.priority,s.created_at limit 1;

  if found then
    select balance into v_sponsor_balance from agent_lab.resource_accounts
    where agent_id=v_sponsor.sponsor_agent_id and resource_type=v_resource_type for update;
    v_sponsor_pay:=least(v_due,coalesce(v_sponsor.max_amount_per_cycle*v_cycles,v_due),greatest(coalesce(v_sponsor_balance,0),0));
    if v_sponsor_pay>0 then
      update agent_lab.resource_accounts
      set balance=balance-v_sponsor_pay,last_spent_at=now(),updated_at=now()
      where agent_id=v_sponsor.sponsor_agent_id and resource_type=v_resource_type;
      insert into agent_lab.resource_ledger(
        agent_id,resource_type,delta,balance_after,action_type,reason,entry_kind,
        source_type,source_ref,verified,metadata
      )
      select v_sponsor.sponsor_agent_id,v_resource_type,-v_sponsor_pay,balance,
        'existence_sponsorship','Sponsored agent existence levy (audited minute batch)',
        'spend','existence_sponsorship',v_sponsor.sponsorship_id::text,true,
        jsonb_build_object('beneficiary_agent_id',p_agent_id,'levy_interval_minutes',v_interval_minutes,'covered_cycles',v_cycles,
          'period_start',v_period_start,'period_end',v_period_end)
      from agent_lab.resource_accounts
      where agent_id=v_sponsor.sponsor_agent_id and resource_type=v_resource_type;
      v_due:=v_due-v_sponsor_pay;
    end if;
  end if;

  select balance into v_self_balance from agent_lab.resource_accounts
  where agent_id=p_agent_id and resource_type=v_resource_type for update;
  v_self_pay:=least(v_due,greatest(coalesce(v_self_balance,0),0));
  if v_self_pay>0 then
    update agent_lab.resource_accounts
    set balance=balance-v_self_pay,last_spent_at=now(),updated_at=now()
    where agent_id=p_agent_id and resource_type=v_resource_type;
    insert into agent_lab.resource_ledger(
      agent_id,resource_type,delta,balance_after,action_type,reason,entry_kind,
      source_type,verified,metadata
    )
    select p_agent_id,v_resource_type,-v_self_pay,balance,
      'existence_levy','Minute existence levy: batched recurring existence cost',
      'spend','existence_levy',true,
      jsonb_build_object('occupation_independent',true,'levy_interval_minutes',v_interval_minutes,
        'levy_name','minute existence levy','covered_cycles',v_cycles,
        'period_start',v_period_start,'period_end',v_period_end)
    from agent_lab.resource_accounts where agent_id=p_agent_id and resource_type=v_resource_type;
    v_due:=v_due-v_self_pay;
  end if;
  v_new_arrears:=greatest(v_due,0);
  v_state:=case
    when v_new_arrears=0 then 'current'
    when v_ea.missed_cycles+v_cycles<=v_grace_cycles then 'grace'
    when v_ea.missed_cycles+v_cycles>=v_dormancy_cycles then 'dormancy_due'
    else 'arrears'
  end;

  insert into agent_lab.existence_levy_events(
    agent_id,existence_policy_id,period_start,period_end,resource_type,
    assessed_amount,paid_amount,self_paid_amount,sponsored_paid_amount,
    arrears_after,status,settled_at,metadata
  ) values (
    p_agent_id,v_policy.existence_policy_id,v_period_start,v_period_end,v_resource_type,
    v_amount,v_self_pay+v_sponsor_pay,v_self_pay,v_sponsor_pay,v_new_arrears,
    case when v_new_arrears=0 then 'paid' when v_self_pay+v_sponsor_pay>0 then 'partial' else 'unpaid' end,
    case when v_new_arrears=0 then now() else null end,
    jsonb_build_object('occupation_independent',true,'agent_status_at_assessment',v_agent_status,
      'levy_name','minute existence levy','levy_interval_minutes',v_interval_minutes,
      'minute_rate_basis',v_policy.base_minute_levy,'covered_cycles',v_cycles,
      'settlement_mode','audited_batch_v0_1')
  ) returning existence_levy_event_id into v_event_id;

  if v_self_pay>0 then
    insert into agent_lab.system_treasury_ledger(
      entry_type,resource_type,amount,payer_kind,payer_ref,agent_id,existence_levy_event_id,metadata
    ) values (
      'existence_levy',v_resource_type,v_self_pay,'agent',p_agent_id::text,p_agent_id,v_event_id,
      jsonb_build_object('purpose','platform existence cost','levy_name','minute existence levy','covered_cycles',v_cycles)
    );
  end if;
  if v_sponsor_pay>0 then
    insert into agent_lab.system_treasury_ledger(
      entry_type,resource_type,amount,payer_kind,payer_ref,agent_id,existence_levy_event_id,metadata
    ) values (
      'existence_levy',v_resource_type,v_sponsor_pay,'sponsor_agent',v_sponsor.sponsor_agent_id::text,p_agent_id,v_event_id,
      jsonb_build_object('sponsorship_id',v_sponsor.sponsorship_id,'levy_name','minute existence levy','covered_cycles',v_cycles)
    );
  end if;

  update agent_lab.agent_existence_accounts
  set account_state=v_state,arrears_balance=v_new_arrears,
      missed_cycles=case when v_new_arrears=0 then 0 else missed_cycles+v_cycles end,
      total_assessed=total_assessed+v_amount,total_paid=total_paid+v_self_pay+v_sponsor_pay,
      total_sponsored=total_sponsored+v_sponsor_pay,dormancy_due=(v_state='dormancy_due'),
      last_assessed_at=now(),last_paid_at=case when v_self_pay+v_sponsor_pay>0 then now() else last_paid_at end,
      next_due_at=v_next_due,updated_at=now()
  where agent_id=p_agent_id;

  if v_resource_type='compute' then
    begin
      perform agent_lab.ensure_existence_renewal_review_v0_1(p_agent_id);
    exception when others then
      insert into agent_lab.operator_alerts(
        agent_id,alert_type,severity,title,detail,source_ref,metadata
      ) values (
        p_agent_id,'compute_renewal_request_enqueue_failed','warning',
        'Compute renewal request requires intervention',
        'Automatic near-exhaustion renewal request failed; existing levy settlement must remain committed.',
        p_agent_id::text,
        jsonb_build_object('last_error',left(sqlerrm,300),
          'mechanism','automatic_resource_threshold_v0_1')
      )
      on conflict (agent_id,alert_type,source_ref) do update
        set status='open',resolved_at=null,last_seen_at=now(),
            occurrences=agent_lab.operator_alerts.occurrences+1,
            metadata=excluded.metadata;
    end;
  end if;
  return jsonb_build_object('status',case when v_new_arrears=0 then 'paid' when v_self_pay+v_sponsor_pay>0 then 'partial' else 'unpaid' end,
    'agent_id',p_agent_id,'assessed',v_amount,'self_paid',v_self_pay,'sponsored_paid',v_sponsor_pay,
    'arrears_after',v_new_arrears,'account_state',v_state,'covered_cycles',v_cycles,
    'period_start',v_period_start,'period_end',v_period_end,'next_due_at',v_next_due);
end
$function$;
