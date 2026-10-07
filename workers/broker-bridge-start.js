const isEnabled = (name) => ['1', 'true', 'yes', 'on'].includes(
  String(process.env[name] || '').trim().toLowerCase(),
);

try {
  const { verifyPythonMathChecks } = await import('./python-math.js');
  const probe = verifyPythonMathChecks([
    {label:'startup_probe',expression:'(175000 / (1.11 ** 2)) * (1.11 ** 2)',claimed_result:175000}
  ]);
  console.log('AAU_PYTHON_MATH_RUNTIME_PROBE', JSON.stringify({
    ok:probe.ok === true && probe.all_match === true,
    check_count:probe.check_count,
    error:probe.error || null,
  }));
} catch (error) {
  console.error('AAU_PYTHON_MATH_RUNTIME_PROBE', JSON.stringify({
    ok:false,
    error:String(error?.message || error).slice(0,500),
  }));
}

try {
  const { verifyPythonMathChecks } = await import('./python-math.js');
  const cents=verifyPythonMathChecks([
    {label:'two_decimal_rounding',expression:'100 / 3',claimed_result:33.33}
  ],{absoluteTolerance:0.005,relativeTolerance:1e-9});
  const integerCurrency=verifyPythonMathChecks([
    {label:'integer_currency_rounding',expression:'0.44 * 329545.45',claimed_result:145000}
  ],{absoluteTolerance:0.005,relativeTolerance:1e-9});
  const probabilityDrift=verifyPythonMathChecks([
    {label:'probability_precision_reject',expression:'0.4048191 / 0.5524091',claimed_result:0.7324815}
  ],{absoluteTolerance:0.005,relativeTolerance:1e-9});
  console.log('AAU_PYTHON_MATH_PRECISION_PROBE',JSON.stringify({
    ok:cents.ok===true
      &&cents.all_match===true
      &&integerCurrency.ok===true
      &&integerCurrency.all_match===true
      &&probabilityDrift.ok===true
      &&probabilityDrift.all_match===false,
    cents_actual:cents.results?.[0]?.actual??null,
    cents_tolerance:cents.results?.[0]?.absolute_tolerance??null,
    integer_currency_actual:integerCurrency.results?.[0]?.actual??null,
    integer_currency_tolerance:integerCurrency.results?.[0]?.absolute_tolerance??null,
    probability_actual:probabilityDrift.results?.[0]?.actual??null,
    probability_tolerance:probabilityDrift.results?.[0]?.absolute_tolerance??null,
  }));
} catch (error) {
  console.error('AAU_PYTHON_MATH_PRECISION_PROBE',JSON.stringify({
    ok:false,error:String(error?.message||error).slice(0,500)
  }));
}

try {
  const { verifyPythonMathChecks } = await import('./python-math.js');
  const quoted=verifyPythonMathChecks([
    {label:'quoted_number',expression:'1 + 1',claimed_result:'2'}
  ]);
  const boolean=verifyPythonMathChecks([
    {label:'boolean_number',expression:'1 + 1',claimed_result:true}
  ]);
  const unsafe=verifyPythonMathChecks([
    {label:'unsafe_syntax',expression:'sum([1,2,3])',claimed_result:6}
  ]);
  console.log('AAU_PYTHON_MATH_TYPE_CONTRACT_PROBE', JSON.stringify({
    ok:quoted.ok===false
      &&quoted.failure_class==='input_contract'
      &&boolean.ok===false
      &&boolean.failure_class==='input_contract'
      &&unsafe.ok===true
      &&unsafe.all_match===false
      &&unsafe.results?.[0]?.valid===false
      &&String(unsafe.results?.[0]?.error_code||'').includes('syntax_not_allowed'),
    quoted_error:quoted.error||null,
    boolean_error:boolean.error||null,
    unsafe_error:unsafe.results?.[0]?.error_code||null,
  }));
} catch (error) {
  console.error('AAU_PYTHON_MATH_TYPE_CONTRACT_PROBE', JSON.stringify({
    ok:false,error:String(error?.message||error).slice(0,500)
  }));
}

try {
  const {
    verifyPythonMathChecks,
    verifyPythonMathChecksChunked,
    PYTHON_MATH_MAX_CHECKS,
  } = await import('./python-math.js');
  const checks=Array.from({length:PYTHON_MATH_MAX_CHECKS+5},(_,index)=>({
    label:'chunk_probe_'+String(index+1),
    expression:String(index+1)+' + 1',
    claimed_result:index+2,
  }));
  const strict=verifyPythonMathChecks(checks);
  const chunked=verifyPythonMathChecksChunked(checks);
  console.log('AAU_PYTHON_MATH_CHUNKED_RUNTIME_PROBE',JSON.stringify({
    ok:strict.ok===false
      &&strict.error==='python_check_contract_invalid'
      &&chunked.ok===true
      &&chunked.all_match===true
      &&chunked.check_count===checks.length
      &&chunked.batch_count===2,
    strict_error:strict.error||null,
    strict_check_count:strict.check_count,
    chunked_check_count:chunked.check_count,
    chunked_batch_count:chunked.batch_count,
    batch_size_limit:chunked.batch_size_limit,
  }));
} catch (error) {
  console.error('AAU_PYTHON_MATH_CHUNKED_RUNTIME_PROBE',JSON.stringify({
    ok:false,error:String(error?.message||error).slice(0,500)
  }));
}

try {
  const {
    pythonChecksFromArtifact,
    qdaDirectAtomicArtifactCandidate,
    safeJson,
    committedAtomicResumeState,
  } = await import('./autonomous-recursive-decomposition.js');
  const { verifyPythonMathChecks } = await import('./python-math.js');
  const artifact={
    exercise_pack_ref:'probe',
    problem_responses:[
      {problem_id:1,calculation:'1+1=2',python_checks:[{label:'p1',expression:'1 + 1',claimed_result:2}]},
      {problem_id:2,calculation:'2+2=4',python_checks:[{label:'p2',expression:'2 + 2',claimed_result:4}]},
      {problem_id:3,calculation:'3+3=6',python_checks:[{label:'p3',expression:'3 + 3',claimed_result:6}]},
    ],
  };
  const field=pythonChecksFromArtifact(artifact);
  const verification=verifyPythonMathChecks(field.value);
  const wrapperless={
    inputs:{p_a:0.6,p_b:0.4},
    calculation:{sum:'0.6 + 0.4 = 1'},
    python_checks:[{label:'wrapperless',expression:'0.6 + 0.4',claimed_result:1}],
  };
  const direct=qdaDirectAtomicArtifactCandidate(wrapperless);
  const semanticWrapped={
    interview_study_evwsi_calculation:{
      evwsi:145000,
      python_checks:[{
        label:'semantic_nested',
        expression:'0.44 * 329545.4545454545',
        claimed_result:145000
      }]
    }
  };
  const semanticField=pythonChecksFromArtifact(semanticWrapped);
  const semanticVerification=verifyPythonMathChecks(
    semanticField.value,{absoluteTolerance:0.005,relativeTolerance:1e-9}
  );
  console.log('AAU_QDA601_NESTED_PYTHON_CHECKS_PROBE',JSON.stringify({
    ok:field.type_ok===true
      &&field.value.length===3
      &&field.source==='problem_responses'
      &&verification.ok===true
      &&verification.all_match===true
      &&direct===wrapperless
      &&Array.isArray(direct.python_checks)
      &&direct.python_checks.length===1
      &&semanticField.type_ok===true
      &&semanticField.value.length===1
      &&semanticField.source==='nested_artifact'
      &&semanticVerification.ok===true
      &&semanticVerification.all_match===true
      &&safeJson(undefined)==='null',
    source:field.source||null,
    check_count:field.value.length,
    semantic_source:semanticField.source||null,
    semantic_check_count:semanticField.value.length,
    verifier_ok:verification.ok===true,
    semantic_verifier_ok:semanticVerification.ok===true,
    all_match:verification.all_match===true,
    semantic_all_match:semanticVerification.all_match===true,
    safe_json_undefined:safeJson(undefined),
    wrapperless_direct_ok:direct===wrapperless,
  }));
} catch (error) {
  console.error('AAU_QDA601_NESTED_PYTHON_CHECKS_PROBE',JSON.stringify({
    ok:false,error:String(error?.message||error).slice(0,500)
  }));
}

try {
  const { committedAtomicResumeState } = await import('./autonomous-recursive-decomposition.js');
  const committed=committedAtomicResumeState({
    node_status:'pending',
    decision_type:'ATOMIC',
    decision_payload:{
      deterministic_statistics_reconciliation_required:true,
      reconsider_decomposition:false,
    },
  });
  const explicitReconsider=committedAtomicResumeState({
    node_status:'pending',
    decision_type:'ATOMIC',
    decision_payload:{reconsider_decomposition:true},
  });
  const unavailable=committedAtomicResumeState({
    node_status:'pending',
    decision_type:'ATOMIC',
    decision_payload:{atomic_unavailable:true},
  });
  const split=committedAtomicResumeState({
    node_status:'split',
    decision_type:'ATOMIC',
    decision_payload:{},
  });
  console.log('AAU_ATOMIC_ROUTE_COMMIT_RESUME_PROBE',JSON.stringify({
    ok:committed.resume===true
      &&explicitReconsider.resume===false
      &&explicitReconsider.invalidation_reason==='reconsider_decomposition'
      &&unavailable.resume===false
      &&unavailable.invalidation_reason==='atomic_unavailable'
      &&split.resume===false,
    committed,
    explicit_reconsider:explicitReconsider,
    unavailable,
    split,
    contract:'atomic_route_commit_resume_v0_1',
  }));
} catch (error) {
  console.error('AAU_ATOMIC_ROUTE_COMMIT_RESUME_PROBE',JSON.stringify({
    ok:false,error:String(error?.message||error).slice(0,500)
  }));
}

try {
  const { discoveryLoopGuardState } = await import('./autonomous-recursive-decomposition.js');
  const first=discoveryLoopGuardState({},'fp-A',{freshDiscoveryRequired:true});
  const repeat=discoveryLoopGuardState({
    discovery_loop_guard:{
      context_fingerprint:'fp-A',
      fresh_discovery_entries:1,
      route_committed:true,
    }
  },'fp-A',{freshDiscoveryRequired:true});
  const checkpointReuse=discoveryLoopGuardState({
    discovery_loop_guard:{
      context_fingerprint:'fp-A',
      fresh_discovery_entries:1,
      route_committed:true,
    }
  },'fp-A',{freshDiscoveryRequired:false});
  const changed=discoveryLoopGuardState({
    discovery_loop_guard:{
      context_fingerprint:'fp-A',
      fresh_discovery_entries:1,
      route_committed:true,
    }
  },'fp-B',{freshDiscoveryRequired:true});
  console.log('AAU_DISCOVERY_LOOP_GUARD_PROBE',JSON.stringify({
    ok:first.blocked===false
      &&first.next_fresh_discovery_entries===1
      &&repeat.blocked===true
      &&checkpointReuse.blocked===false
      &&changed.blocked===false
      &&changed.next_fresh_discovery_entries===1,
    first,repeat,checkpoint_reuse:checkpointReuse,changed,
    contract:'bounded_discovery_loop_guard_v0_1',
  }));
} catch (error) {
  console.error('AAU_DISCOVERY_LOOP_GUARD_PROBE',JSON.stringify({
    ok:false,error:String(error?.message||error).slice(0,500)
  }));
}

try {
  const { qdaM9U3AuthoritativePythonSimulation } = await import('./autonomous-recursive-decomposition.js');
  const result=qdaM9U3AuthoritativePythonSimulation({
    qda_601_context:{
      next_unit:{
        unit_code:'QDA601-M9-U3',
        exercise_pack:{
          distributions:{
            monthly_volume:{type:'triangular',min:7000,mode:10000,max:14000},
            price:{type:'triangular',min:65,mode:72,max:78},
            variable_cost:{type:'triangular',min:29,mode:34,max:41},
            fixed_cost:{type:'fixed',value:310000},
          },
        },
      },
    },
  });
  const claims=result?.python_analysis_template?.claims||{};
  console.log('AAU_QDA_M9_U3_EARLY_PYTHON_PROBE',JSON.stringify({
    ok:result?.contract==='qda_m9_u3_early_python_simulation_v0_1'
      &&result?.simulation?.draws===10000
      &&result?.simulation?.seed===601903
      &&Number.isFinite(result?.simulation?.mean)
      &&Number.isFinite(result?.simulation?.median)
      &&Number.isFinite(result?.simulation?.p10)
      &&Number.isFinite(result?.simulation?.p90)
      &&Number.isFinite(result?.simulation?.probability_below_zero)
      &&result?.corner_sanity_checks?.worst===-142000
      &&result?.corner_sanity_checks?.mode===70000
      &&result?.corner_sanity_checks?.best===376000
      &&claims.mean===result?.simulation?.mean
      &&claims.median===result?.simulation?.median
      &&claims.p10===result?.simulation?.p10
      &&claims.p90===result?.simulation?.p90
      &&claims.probability_below_zero===result?.simulation?.probability_below_zero,
    draws:result?.simulation?.draws??null,
    seed:result?.simulation?.seed??null,
    mean:result?.simulation?.mean??null,
    median:result?.simulation?.median??null,
    p10:result?.simulation?.p10??null,
    p90:result?.simulation?.p90??null,
    probability_below_zero:result?.simulation?.probability_below_zero??null,
    corners:result?.corner_sanity_checks||null,
    contract:result?.contract||null,
  }));
} catch (error) {
  console.error('AAU_QDA_M9_U3_EARLY_PYTHON_PROBE',JSON.stringify({
    ok:false,error:String(error?.message||error).slice(0,500)
  }));
}

try {
  const {
    structuredChildScopeLedger,
    childAuthoringCounterState,
    existingSplitContinuationState,
    normalizeExistingSplitDiscoveryDecision,
    budgetConstrainedSplitAction,
    splitParentVerificationRetryState,
  } = await import('./autonomous-recursive-decomposition.js');
  const structuredNode={
    requirement_text:'Solve Problem 1: Create a canonical ledger with variable, value, unit, period, evidence state, source, and confidence.',
    context_payload:{
      qda_601_context:{value:{
        next_unit:{
          unit_code:'QDA601-PROBE-U1',
          exercise_pack:{
            reports:[
              {source:'A',ACV:1200,CAC:92,churn_monthly:0.032,gross_margin:0.74,as_of:'2026-Q2'},
              {source:'B',ACV:1260,CAC:78,churn_monthly:0.041,gross_margin:0.735,as_of:'2026-Q2'},
            ],
            problems:['Create a canonical ledger with variable, value, unit, period, evidence state, source, and confidence.'],
          },
        },
      }},
      qda_curriculum_problem_binding:{problem_ordinal:1},
    },
  };
  const ledger=structuredChildScopeLedger(structuredNode,[
    {
      node_path:'R.001.001',
      requirement:'Resolve ACV and create its canonical ledger entry.',
      scope_removed:'Reconciliation and submission for CAC, churn_monthly, and gross_margin.',
      completion_criterion:'Complete ACV only.'
    },
    {
      node_path:'R.001.002',
      requirement:'Resolve CAC and churn_monthly and create their canonical ledger entries.',
      scope_removed:'Reconciliation and submission for ACV and gross_margin.',
      completion_criterion:'Complete CAC and churn_monthly only.'
    },
  ]);
  const statementNode={
    requirement_text:'Solve Problem 1: Identify value conflicts versus definition/period conflicts.',
    context_payload:{
      qda_601_context:{value:{
        next_unit:{
          unit_code:'QDA601-PROBE-U2',
          exercise_pack:{
            statements:[
              'Marketing: CAC=$80 = spend/new logos.',
              'Finance: CAC=$112 including sales payroll.',
              'Sales: ACV=$18k annual contracted value.',
              'Billing: average recognized revenue/customer=$1.3k monthly.',
              'Board: monthly churn=2.5%.',
              'CS dashboard: quarterly churn=8.0%.',
              'Finance: gross margin=76% excluding support payroll.',
              'Ops: gross margin=68% including support payroll.'
            ],
            problems:['Identify value conflicts versus definition/period conflicts.']
          }
        }
      }},
      qda_curriculum_problem_binding:{problem_ordinal:1}
    }
  };
  const statementLedger=structuredChildScopeLedger(statementNode,[
    {node_path:'R.001.001',requirement:'Analyze the conflict between Marketing CAC and Finance CAC.'},
    {node_path:'R.001.002',requirement:'Analyze Sales ACV versus Billing recognized revenue/customer.'},
    {node_path:'R.001.003',requirement:'Analyze Board monthly churn versus CS dashboard quarterly churn.'}
  ]);
  const unstructured=structuredChildScopeLedger({
    requirement_text:'Investigate the issue.',
    context_payload:{}
  },[]);
  const splitContinuation=existingSplitContinuationState(structuredNode,[
    {
      node_path:'R.001.001',
      status:'completed',
      requirement_text:'Resolve ACV and create its canonical ledger entry.'
    },
    {
      node_path:'R.001.002',
      status:'completed',
      requirement_text:'Resolve CAC, churn_monthly, and gross_margin and create their canonical ledger entries.'
    },
  ]);
  const partialSplitContinuation=existingSplitContinuationState(structuredNode,[
    {
      node_path:'R.001.001',
      status:'completed',
      requirement_text:'Resolve ACV and create its canonical ledger entry.'
    },
    {
      node_path:'R.001.002',
      status:'completed',
      requirement_text:'Resolve CAC and churn_monthly and create their canonical ledger entries.'
    },
  ]);
  const doneAlias=normalizeExistingSplitDiscoveryDecision(
    'DONE',['SPLIT'],splitContinuation
  );
  const atomicUnaffected=normalizeExistingSplitDiscoveryDecision(
    'ATOMIC',['ATOMIC','SPLIT'],splitContinuation
  );
  const budgetExisting=budgetConstrainedSplitAction(2,0);
  const budgetEmpty=budgetConstrainedSplitAction(0,0);
  const budgetContinue=budgetConstrainedSplitAction(2,1);
  const splitRetryOne=splitParentVerificationRetryState({});
  const splitRetryTwo=splitParentVerificationRetryState({
    split_parent_verification_fail_count:1,
    split_parent_verification_retry_nonce:splitRetryOne.retry_nonce,
    deterministic_math_verification:{ok:false,all_match:false},
  });
  const legacy=childAuthoringCounterState(
    {child_authoring_failure_count:25},7
  );
  const sameEpoch=childAuthoringCounterState(
    {
      child_authoring_epoch_no:7,
      child_authoring_failure_count:2,
      child_authoring_reconsideration_cycles:2,
      child_authoring_lifetime_rejection_count:27,
      child_authoring_epoch_transition_count:1,
    },7
  );
  const nextEpoch=childAuthoringCounterState(
    {
      child_authoring_epoch_no:7,
      child_authoring_failure_count:2,
      child_authoring_reconsideration_cycles:2,
      child_authoring_lifetime_rejection_count:27,
      child_authoring_epoch_transition_count:1,
    },8
  );
  console.log('AAU_STRUCTURED_REMAINING_SCOPE_PROBE',JSON.stringify({
    ok:ledger?.contract==='authoritative_structured_remaining_scope_v0_3_owned_scope_only'
      &&JSON.stringify(ledger.authoritative_scope)===JSON.stringify(['ACV','CAC','churn_monthly','gross_margin'])
      &&JSON.stringify(ledger.already_covered_scope)===JSON.stringify(['ACV','CAC','churn_monthly'])
      &&JSON.stringify(ledger.remaining_scope)===JSON.stringify(['gross_margin'])
      &&statementLedger?.contract==='authoritative_structured_remaining_scope_v0_3_owned_scope_only'
      &&statementLedger?.scope_kind==='statement_set'
      &&JSON.stringify(statementLedger.already_covered_scope)===JSON.stringify(['S1','S2','S3','S4','S5','S6'])
      &&JSON.stringify(statementLedger.remaining_scope)===JSON.stringify(['S7','S8'])
      &&statementLedger.remaining_scope_items?.[0]?.statement?.includes('Finance: gross margin')
      &&statementLedger.remaining_scope_items?.[1]?.statement?.includes('Ops: gross margin')
      &&unstructured===null
      &&legacy.failure_count_base===0
      &&legacy.lifetime_rejection_count_base===25
      &&sameEpoch.failure_count_base===2
      &&sameEpoch.reconsideration_cycles_base===2
      &&nextEpoch.failure_count_base===0
      &&nextEpoch.reconsideration_cycles_base===0
      &&nextEpoch.epoch_transition_count_base===2
      &&splitContinuation.available===true
      &&splitContinuation.structured_scope_complete===true
      &&partialSplitContinuation.available===false
      &&partialSplitContinuation.structured_scope_complete===false
      &&doneAlias.normalized===true
      &&doneAlias.decision==='SPLIT'
      &&atomicUnaffected.normalized===false
      &&atomicUnaffected.decision==='ATOMIC'
      &&budgetExisting==='FINALIZE_EXISTING_SPLIT'
      &&budgetEmpty==='EXHAUST_WITHOUT_CHILD'
      &&budgetContinue==='CONTINUE_AUTHORING'
      &&splitRetryOne.attempt===1
      &&splitRetryOne.exhausted===false
      &&splitRetryTwo.attempt===2
      &&splitRetryTwo.exhausted===true
      &&splitRetryOne.retry_nonce!==splitRetryTwo.retry_nonce,
    authoritative_scope:ledger?.authoritative_scope||null,
    covered_scope:ledger?.already_covered_scope||null,
    remaining_scope:ledger?.remaining_scope||null,
    statement_scope_kind:statementLedger?.scope_kind||null,
    statement_covered_scope:statementLedger?.already_covered_scope||null,
    statement_remaining_scope:statementLedger?.remaining_scope||null,
    statement_remaining_items:statementLedger?.remaining_scope_items||null,
    unstructured_fallback:unstructured===null,
    legacy_lifetime_preserved:legacy.lifetime_rejection_count_base,
    same_epoch_failure_base:sameEpoch.failure_count_base,
    next_epoch_failure_base:nextEpoch.failure_count_base,
    next_epoch_transition_count:nextEpoch.epoch_transition_count_base,
    split_continuation_available:splitContinuation.available,
    split_scope_complete:splitContinuation.structured_scope_complete,
    partial_split_continuation_available:partialSplitContinuation.available,
    partial_split_scope_complete:partialSplitContinuation.structured_scope_complete,
    done_alias_normalized_to:doneAlias.decision,
    atomic_decision_preserved:atomicUnaffected.decision,
    exclusion_text_did_not_expand_coverage:
      JSON.stringify(ledger?.remaining_scope||[])===JSON.stringify(['gross_margin']),
    budget_existing_action:budgetExisting,
    budget_empty_action:budgetEmpty,
    budget_continue_action:budgetContinue,
    split_parent_retry_attempts:[splitRetryOne.attempt,splitRetryTwo.attempt],
    split_parent_retry_exhausted:splitRetryTwo.exhausted,
    contract:'cognition_transition_invariants_v0_2_statement_scope',
  }));
} catch (error) {
  console.error('AAU_STRUCTURED_REMAINING_SCOPE_PROBE',JSON.stringify({
    ok:false,error:String(error?.message||error).slice(0,500)
  }));
}

try {
  const {
    runtimeOwnedTerminalSynthesisChild,
    splitDoneZeroChildRecovery,
  } = await import('./autonomous-recursive-decomposition.js');
  const cases=[
    {
      name:'substantive_source_reconciliation',
      requirement:'Reconcile conflicting source values and definitions for the variable before calculating the result.',
      expected:false,
    },
    {
      name:'substantive_evidence_reconciliation',
      requirement:'Reconcile contradictory evidence, units, and forecast periods to determine the supported value.',
      expected:false,
    },
    {
      name:'terminal_child_result_reconciliation',
      requirement:'Reconcile the completed child results into the final submission.',
      expected:true,
    },
    {
      name:'terminal_synthesis',
      requirement:'Synthesize the resolved child artifacts into the final answer.',
      expected:true,
    },
  ];
  const outcomes=cases.map(test=>({
    name:test.name,
    expected:test.expected,
    actual:runtimeOwnedTerminalSynthesisChild({requirement:test.requirement}),
  }));
  const collapsedRecovery=splitDoneZeroChildRecovery(
    {status:'DONE',_runtime_terminal_synthesis_collapsed:true},0
  );
  const plainRecovery=splitDoneZeroChildRecovery({status:'DONE'},0);
  const nonRecovery=splitDoneZeroChildRecovery({status:'DONE'},1);
  console.log('AAU_TERMINAL_SYNTHESIS_CLASSIFIER_PROBE',JSON.stringify({
    ok:outcomes.every(v=>v.actual===v.expected)
      &&collapsedRecovery?.code==='RUNTIME_TERMINAL_SYNTHESIS_COLLAPSE_ZERO_CHILD'
      &&plainRecovery?.code==='COGNITION_SPLIT_DONE_WITHOUT_CHILD'
      &&nonRecovery===null,
    outcomes,
    zero_child_invariant:{
      collapsed_code:collapsedRecovery?.code||null,
      plain_code:plainRecovery?.code||null,
      authored_child_done_returns_null:nonRecovery===null,
    },
    contract:'runtime_owned_terminal_synthesis_classifier_v0_4',
  }));
} catch (error) {
  console.error('AAU_TERMINAL_SYNTHESIS_CLASSIFIER_PROBE',JSON.stringify({
    ok:false,error:String(error?.message||error).slice(0,500)
  }));
}

try {
  const { atomicMaterialCalculationCount } = await import('./autonomous-recursive-decomposition.js');
  const probeArtifact={
    calculation:{
      cac_sensitivity:{
        positive_shift_plus_25_percent:{
          new_cac:'70 * 1.25 = 87.5',
          acquisition_spend:'87.5 * 2200 = 192500',
          output:'420000 - 250000 - 192500 = -22500',
          delta:'abs(-22500 - 16000) = 38500',
        },
        negative_shift_minus_25_percent:{
          new_cac:'70 * 0.75 = 52.5',
          acquisition_spend:'52.5 * 2200 = 115500',
          output:'420000 - 250000 - 115500 = 54500',
          delta:'abs(54500 - 16000) = 38500',
        },
        absolute_effect:38500,
      },
      final_variable_ranking:[
        {variable:'Volume',absolute_effect:84000,source:'R.002.002'},
        {variable:'Price',absolute_effect:80000,source:'R.002.001'},
        {variable:'Variable Cost',absolute_effect:57000,source:'R.002.002'},
        {variable:'CAC',absolute_effect:38500,source:'Current Calculation'},
      ],
    },
  };
  const count=atomicMaterialCalculationCount(probeArtifact);
  console.log('AAU_QDA_MATH_MATERIAL_COVERAGE_PROBE',JSON.stringify({
    ok:count===9,
    material_check_count:count,
    expected:9,
    excludes_presentation_ranking:true,
    contract:'qda_numeric_material_leaf_coverage_v0_2',
  }));
} catch (error) {
  console.error('AAU_QDA_MATH_MATERIAL_COVERAGE_PROBE',JSON.stringify({
    ok:false,error:String(error?.message||error).slice(0,500)
  }));
}

try {
  const { qdaVerifiedPythonChecksFromArtifact } = await import('./qda601-runtime.js');
  const artifact={
    python_checks:[
      {label:'top_1',expression:'1+1',claimed_result:2},
      {label:'top_2',expression:'2+2',claimed_result:4},
      {label:'top_3',expression:'3+3',claimed_result:6},
      {label:'top_4',expression:'4+4',claimed_result:8},
    ],
    reconciliation:{
      python_checks:[
        {label:'nested_1',expression:'5+5',claimed_result:10},
        {label:'nested_2',expression:'6+6',claimed_result:12},
        {label:'nested_3',expression:'7+7',claimed_result:14},
        {label:'nested_4',expression:'8+8',claimed_result:16},
      ]
    }
  };
  const field=qdaVerifiedPythonChecksFromArtifact(artifact);
  console.log('AAU_QDA_VERIFIED_CHECK_EXTRACTION_PROBE',JSON.stringify({
    ok:field.type_ok===true
      &&field.value.length===8
      &&String(field.source).includes('top_level')
      &&String(field.source).includes('nested_artifact'),
    check_count:field.value.length,
    source:field.source,
    expected:8,
    contract:'qda_verified_python_check_extraction_v0_1',
  }));
} catch (error) {
  console.error('AAU_QDA_VERIFIED_CHECK_EXTRACTION_PROBE',JSON.stringify({
    ok:false,error:String(error?.message||error).slice(0,500)
  }));
}

try {
  const { runPythonStatisticalAnalyses } = await import('./python-quant.js');
  const probe = runPythonStatisticalAnalyses([
    {
      id:'startup_rounded_wald_proportion_probe',
      analysis:'proportion_ci',
      spec:{successes:342,total:400,confidence:0.95,method:'wald'},
      claims:{proportion:0.855,ci_low:0.820494,ci_high:0.889506},
      absolute_tolerance:1e-6
    }
  ]);
  console.log('AAU_PYTHON_STATISTICS_APPROXIMATE_CI_TOLERANCE_PROBE',JSON.stringify({
    ok:probe.ok===true&&probe.all_claims_match===true,
    analysis_count:probe.analysis_count,
    error:probe.error||null,
  }));
} catch (error) {
  console.error('AAU_PYTHON_STATISTICS_APPROXIMATE_CI_TOLERANCE_PROBE',JSON.stringify({
    ok:false,error:String(error?.message||error).slice(0,500)
  }));
}

try {
  const { runPythonStatisticalAnalyses } = await import('./python-quant.js');
  const probe = runPythonStatisticalAnalyses([
    {
      id:'startup_wald_proportion_probe',
      analysis:'proportion_ci',
      spec:{successes:420,total:6000,confidence:0.95,method:'wald'},
      claims:{
        proportion:0.07,
        ci_low:0.06354400834847727,
        ci_high:0.07645599165152274
      }
    }
  ]);
  console.log('AAU_PYTHON_STATISTICS_WALD_PROPORTION_PROBE', JSON.stringify({
    ok:probe.ok===true
      &&probe.all_claims_match===true
      &&probe.analyses?.[0]?.result?.method==='wald',
    analysis_count:probe.analysis_count,
    method:probe.analyses?.[0]?.result?.method||null,
    error:probe.error||null,
  }));
} catch (error) {
  console.error('AAU_PYTHON_STATISTICS_WALD_PROPORTION_PROBE', JSON.stringify({
    ok:false,error:String(error?.message||error).slice(0,500)
  }));
}

try {
  const { runPythonStatisticalAnalyses } = await import('./python-quant.js');
  const probe = runPythonStatisticalAnalyses([
    {
      id:'startup_describe_probe',
      analysis:'describe',
      spec:{values:[1,2,3,4]},
      claims:{mean:2.5,median:2.5,q1:1.75,q3:3.25}
    }
  ]);
  console.log('AAU_PYTHON_STATISTICS_RUNTIME_PROBE', JSON.stringify({
    ok:probe.ok === true && probe.all_claims_match === true,
    analysis_count:probe.analysis_count,
    engine:probe.engine || null,
    error:probe.error || null,
  }));
} catch (error) {
  console.error('AAU_PYTHON_STATISTICS_RUNTIME_PROBE', JSON.stringify({
    ok:false,
    error:String(error?.message || error).slice(0,500),
  }));
}

try {
  const { runPythonStatisticalAnalyses } = await import('./python-quant.js');
  const probe=runPythonStatisticalAnalyses([
    {
      id:'strict_type_probe',
      analysis:'describe',
      spec:{values:[1,'2',3]},
      claims:{mean:2}
    }
  ]);
  console.log('AAU_PYTHON_STATISTICS_TYPE_CONTRACT_PROBE', JSON.stringify({
    ok:probe.ok===false && probe.failure_class==='input_contract',
    failure_class:probe.failure_class||null,
    error:probe.error||null,
  }));
} catch (error) {
  console.error('AAU_PYTHON_STATISTICS_TYPE_CONTRACT_PROBE', JSON.stringify({
    ok:false,error:String(error?.message||error).slice(0,500)
  }));
}

try {
  const { runPrecisionEngineerSmoke } = await import('./precision-engineer-smoke.js');
  const probe = runPrecisionEngineerSmoke();
  console.log('AAU_PRECISION_ENGINEER_PROBE', JSON.stringify(probe));
} catch (error) {
  console.error('AAU_PRECISION_ENGINEER_PROBE', JSON.stringify({
    ok:false,
    engine:'aau_precision_engineer_v0_1',
    error:String(error?.message || error).slice(0,500),
  }));
}

try {
  const { canonicalizeQda601UnitPayload } = await import('./qda601-runtime.js');
  const probe = canonicalizeQda601UnitPayload({
    program_version:'qda_601_v0_1',
    module_code:'QDA601-M1',
    unit_code:'QDA601-M1-U3',
    exercise_pack_ref:'probe',
    problem_responses:[1,2,3].map((n)=>({
      problem_id:'problem_'+n,
      inputs:{n},
      assumptions:[],
      formula_or_model:'formula_'+n,
      calculation:'calculation_'+n,
      units:'unit_'+n,
      interpretation:'interpretation_'+n,
      sanity_check:'sanity_'+n,
      evidence:[],
      python_checks:[{label:'check_'+n,expression:String(n)+' + 0',claimed_result:n}],
      self_audit:{pass_a:'pass_a_'+n,pass_b:'pass_b_'+n,verdict:'verified_'+n},
    })),
  });
  const required=['inputs','assumptions','formula_or_model','calculation','units','interpretation','sanity_check','evidence','self_audit'];
  const ok=required.every(key=>probe?.[key]!==undefined)
    && Array.isArray(probe?.python_checks)
    && probe.python_checks.length===3;
  console.log('AAU_QDA601_CANONICALIZER_PROBE', JSON.stringify({
    ok,
    python_check_count:Array.isArray(probe?.python_checks)?probe.python_checks.length:0,
    has_self_audit:Boolean(probe?.self_audit),
    error:null,
  }));
} catch (error) {
  console.error('AAU_QDA601_CANONICALIZER_PROBE', JSON.stringify({
    ok:false,
    error:String(error?.message || error).slice(0,500),
  }));
}

try {
  const { materializeQda601UnitFromVerifiedChildren } = await import('./qda601-runtime.js');
  const makeChild=(path,n)=>({
    node_path:path,
    status:'completed',
    decision_type:'ATOMIC',
    requirement_text:'Solve Problem '+n+' of the QDA601-M1-U3 exercise pack using a faithful paraphrase of the assigned problem.',
    result_hash:'probe_'+n,
    deterministic_math_verified:true,
    deterministic_math_check_count:1,
    result_artifact:JSON.stringify({
      artifact:JSON.stringify({
        problem_response:{
          inputs:{n},
          assumptions:['probe assumption '+n],
          formula_or_model:String(n)+' + 0',
          calculation:{
            result:n,
            display:'verified calculation '+n,
            note:'presentation text must not create a second Python-coverage obligation',
          },
          units:'count',
          interpretation:'probe interpretation '+n,
          sanity_check:'probe sanity check '+n,
          evidence:{provenance:'probe'},
          self_audit:{pass_a:'pass a '+n,pass_b:'pass b '+n,verdict:'PASS'},
          python_checks:[{label:'probe_'+n,expression:String(n)+' + 0',claimed_result:n}],
        },
      }),
      handoff:{conclusions:[],facts:[],unresolved:[]},
    }),
  });
  const probe=materializeQda601UnitFromVerifiedChildren({
    qda_601_context:{
      assigned:true,
      status:'in_progress',
      next_unit:{
        type:'quantitative',
        title:'Probe unit',
        module_code:'QDA601-M1',
        unit_code:'QDA601-M1-U3',
        exercise_pack_ref:'probe',
        exercise_pack:{problems:[
          'Exact source wording for assigned problem one.',
          'Exact source wording for assigned problem two.',
          'Exact source wording for assigned problem three.',
        ]},
      },
    },
  },{
    authoritativeChildren:[makeChild('R.001',1),makeChild('R.002',2),makeChild('R.003',3)],
  });
  console.log('AAU_QDA601_VERIFIED_CHILD_MATERIALIZER_PROBE', JSON.stringify({
    ok:probe.applies===true && Boolean(probe.payload) && probe.failures.length===0
      && probe.payload.python_checks.length===3
      && probe.payload.problem_responses.length===3,
    problem_count:probe.payload?.problem_responses?.length||0,
    python_check_count:probe.payload?.python_checks?.length||0,
    failures:probe.failures||[],
  }));
} catch (error) {
  console.error('AAU_QDA601_VERIFIED_CHILD_MATERIALIZER_PROBE', JSON.stringify({
    ok:false,
    error:String(error?.message || error).slice(0,500),
  }));
}

try {
  const { materializeQda601UnitFromVerifiedChildren } = await import('./qda601-runtime.js');
  const makeCombinedChild=()=>({
    node_path:'R.001',
    status:'completed',
    decision_type:'ATOMIC',
    requirement_text:'Solve Problems 1 and 2 of the QDA601-M1-U3 exercise pack.',
    result_hash:'probe_combined_12',
    deterministic_math_verified:true,
    deterministic_math_check_count:2,
    result_artifact:JSON.stringify({
      artifact:JSON.stringify({
        inputs:{shared:true},
        assumptions:['combined child covers two assigned problems'],
        formula_or_model:'shared verified model',
        problem_1_decision_tree:{result:1},
        problem_2_calculations:{result:2},
        units:'count',
        interpretation:'combined verified interpretation',
        sanity_check:'combined verified sanity check',
        evidence:{provenance:'probe_combined'},
        self_audit:{pass_a:'combined pass a',pass_b:'combined pass b',verdict:'PASS'},
        python_checks:[
          {label:'problem_1_probe',expression:'1 + 0',claimed_result:1},
          {label:'problem_2_probe',expression:'2 + 0',claimed_result:2},
        ],
      }),
      handoff:{conclusions:[],facts:[],unresolved:[]},
    }),
  });
  const makeSingleChild=()=>({
    node_path:'R.002',
    status:'completed',
    decision_type:'ATOMIC',
    requirement_text:'Solve Problem 3 of the QDA601-M1-U3 exercise pack.',
    result_hash:'probe_single_3',
    deterministic_math_verified:true,
    deterministic_math_check_count:1,
    result_artifact:JSON.stringify({
      artifact:JSON.stringify({
        inputs:{n:3},
        assumptions:['single child covers assigned problem three'],
        formula_or_model:'3 + 0',
        calculation:{result:3},
        units:'count',
        interpretation:'problem three interpretation',
        sanity_check:'problem three sanity check',
        evidence:{provenance:'probe_single'},
        self_audit:{pass_a:'single pass a',pass_b:'single pass b',verdict:'PASS'},
        python_checks:[
          {label:'problem_3_probe',expression:'3 + 0',claimed_result:3},
        ],
      }),
      handoff:{conclusions:[],facts:[],unresolved:[]},
    }),
  });
  const probe=materializeQda601UnitFromVerifiedChildren({
    qda_601_context:{
      assigned:true,
      status:'in_progress',
      next_unit:{
        type:'quantitative',
        title:'Multi-problem child probe',
        module_code:'QDA601-M1',
        unit_code:'QDA601-M1-U3',
        exercise_pack_ref:'probe_multi_problem',
        exercise_pack:{problems:[
          'Assigned problem one.',
          'Assigned problem two.',
          'Assigned problem three.',
        ]},
      },
    },
  },{
    authoritativeChildren:[makeCombinedChild(),makeSingleChild()],
  });
  const coverage=probe.payload?.verification_provenance?.problem_coverage||[];
  console.log('AAU_QDA601_MULTI_PROBLEM_CHILD_MATERIALIZER_PROBE', JSON.stringify({
    ok:probe.applies===true && Boolean(probe.payload) && probe.failures.length===0
      && probe.payload.problem_responses.length===3
      && probe.payload.python_checks.length===3
      && probe.payload.verification_provenance?.children?.length===2
      && coverage.length===3
      && coverage[0]?.child_node_path==='R.001'
      && coverage[1]?.child_node_path==='R.001'
      && coverage[2]?.child_node_path==='R.002',
    problem_count:probe.payload?.problem_responses?.length||0,
    child_count:probe.payload?.verification_provenance?.children?.length||0,
    python_check_count:probe.payload?.python_checks?.length||0,
    problem_coverage:coverage.map(row=>({
      problem_id:row?.problem_id||null,
      child_node_path:row?.child_node_path||null,
    })),
    failures:probe.failures||[],
  }));
} catch (error) {
  console.error('AAU_QDA601_MULTI_PROBLEM_CHILD_MATERIALIZER_PROBE', JSON.stringify({
    ok:false,
    error:String(error?.message || error).slice(0,500),
  }));
}

try {
  const { materializeQda601UnitFromVerifiedChildren } = await import('./qda601-runtime.js');
  const common=(claim,label,n)=>({
    claim,label,
    inputs:['source '+n],
    assumptions:['assumption '+n],
    formula_or_model:'model '+n,
    calculation:String(n),
    units:'unit '+n,
    interpretation:'interpretation '+n,
    sanity_check:'sanity '+n,
    evidence:'evidence '+n,
    self_audit:{pass_a:'pass a '+n,pass_b:'pass b '+n},
  });
  const child=(path,problem,artifact,checks)=>({
    node_path:path,status:'completed',decision_type:'ATOMIC',
    requirement_text:'Solve Problem '+problem+' of QDA601-M5-U3.',
    result_hash:'evidence_state_probe_'+problem,
    deterministic_math_verified:true,
    deterministic_math_check_count:checks.length,
    result_artifact:JSON.stringify({
      artifact:JSON.stringify({...artifact,python_checks:checks}),
      handoff:{conclusions:[],facts:[],unresolved:[]},
    }),
  });
  const checks=(prefix,values)=>values.map((value,index)=>({
    label:prefix+'_'+(index+1),expression:String(value),claimed_result:value,
  }));
  const result=materializeQda601UnitFromVerifiedChildren({
    qda_601_context:{
      assigned:true,status:'in_progress',
      next_unit:{
        type:'quantitative',
        title:'Evidence States',
        module_code:'QDA601-M5',
        unit_code:'QDA601-M5-U3',
        exercise_pack_ref:'probe_evidence_states',
        exercise_pack:{problems:[
          'Label each claim by evidence state.',
          'Identify which labels require source versus formula provenance.',
          'Rewrite the claims into a traceable evidence-state ledger.',
        ]},
      },
    },
  },{
    authoritativeChildren:[
      child('R.001',1,{
        solution:[
          common('claim one','OBSERVED',1),
          common('claim two','FORECAST',2),
        ],
      },checks('p1',[1,2])),
      child('R.002',2,{
        inputs:{labels:['OBSERVED','CALCULATED']},
        assumptions:['classification rule'],
        formula_or_model:'provenance mapping',
        calculation:{OBSERVED:'Source',CALCULATED:'Formula'},
        units:'categorical',
        interpretation:'provenance mapping interpretation',
        sanity_check:'mapping is internally consistent',
        evidence:'evidence-state taxonomy',
        self_audit:{pass_a:'mapped labels',pass_b:'attacked mapping'},
      },checks('p2',[1])),
      child('R.003',3,{
        evidence_state_ledger:[
          common('claim one','OBSERVED',1),
          common('claim two','FORECAST',2),
        ],
      },checks('p3',[1,2])),
    ],
  });
  const responses=result.payload?.problem_responses||[];
  console.log('AAU_QDA_M5U3_EVIDENCE_STATE_ROOT_PROBE',JSON.stringify({
    ok:result.applies===true
      &&Boolean(result.payload)
      &&result.failures.length===0
      &&responses.length===3
      &&responses.every(response=>response?.inputs
        &&typeof response.inputs==='object'
        &&!Array.isArray(response.inputs))
      &&responses[0]?.calculation?.source==='exact_verified_child_records'
      &&responses[2]?.calculation?.source==='exact_verified_child_records',
    problem_count:responses.length,
    python_check_count:result.payload?.python_checks?.length||0,
    failures:result.failures||[],
  }));
} catch (error) {
  console.error('AAU_QDA_M5U3_EVIDENCE_STATE_ROOT_PROBE',JSON.stringify({
    ok:false,error:String(error?.message||error).slice(0,500)
  }));
}

try {
  const { materializeQda601UnitFromVerifiedChildren } = await import('./qda601-runtime.js');
  const values=[12,13,13,14,15,16,17,18,19,21,24,90];
  const makeStatChild=(path,n,requirement)=>({
    node_path:path,
    status:'completed',
    decision_type:'ATOMIC',
    requirement_text:requirement,
    result_hash:'stat_shape_probe_'+n,
    deterministic_statistics_verified:true,
    deterministic_statistics_analysis_count:1,
    result_artifact:JSON.stringify({
      artifact:JSON.stringify({
        inputs:values,
        assumptions:'probe assumption '+n,
        formula_or_model:'descriptive statistics',
        calculation:'verified descriptive calculation '+n,
        units:'minutes',
        interpretation:'probe interpretation '+n,
        sanity_check:'probe sanity check '+n,
        evidence:'probe evidence '+n,
        self_audit:{pass_a:'pass a '+n,pass_b:'pass b '+n},
        python_analyses:[{
          id:'stat_shape_'+n,
          analysis:'describe',
          spec:{values},
          claims:{mean:22.666666666666668,median:16.5,q1:13.75,q3:19.5},
        }],
      }),
      handoff:{conclusions:[],facts:[],unresolved:[]},
    }),
  });
  const children=[
    makeStatChild('R.001',1,'Solve Problem 1 of QDA601-M4-U1. Compute mean, median, Q1, Q3, and IQR.'),
    makeStatChild('R.002',2,'Solve Problem 2 of QDA601-M4-U1. Compare the mean with and without the largest observation.'),
    makeStatChild('R.003',3,'Solve Problem 3 of QDA601-M4-U1. Segment the dataset and compare means.'),
  ];
  const result=materializeQda601UnitFromVerifiedChildren({
    qda_601_context:{
      assigned:true,
      status:'in_progress',
      next_unit:{
        type:'quantitative',
        title:'Statistics shape and coverage probe',
        module_code:'QDA601-M4',
        unit_code:'QDA601-M4-U1',
        exercise_pack_ref:'probe_statistics_shape',
        exercise_pack:{problems:[
          'Assigned statistics problem one.',
          'Assigned statistics problem two.',
          'Assigned statistics problem three.',
        ]},
      },
    },
  },{authoritativeChildren:children});
  const coverage=result.payload?.verification_provenance?.problem_coverage||[];
  const responses=result.payload?.problem_responses||[];
  console.log('AAU_QDA601_STATISTICAL_SHAPE_COVERAGE_PROBE',JSON.stringify({
    ok:result.applies===true
      &&Boolean(result.payload)
      &&result.failures.length===0
      &&coverage.length===3
      &&coverage[0]?.child_node_path==='R.001'
      &&coverage[1]?.child_node_path==='R.002'
      &&coverage[2]?.child_node_path==='R.003'
      &&responses.every(response=>response?.inputs
        &&typeof response.inputs==='object'
        &&!Array.isArray(response.inputs)),
    problem_count:responses.length,
    child_paths:coverage.map(row=>row?.child_node_path||null),
    input_object_flags:responses.map(response=>Boolean(
      response?.inputs&&typeof response.inputs==='object'&&!Array.isArray(response.inputs)
    )),
    analysis_count:Array.isArray(result.payload?.python_analyses)
      ?result.payload.python_analyses.length:0,
    failures:result.failures||[],
  }));
} catch (error) {
  console.error('AAU_QDA601_STATISTICAL_SHAPE_COVERAGE_PROBE',JSON.stringify({
    ok:false,error:String(error?.message||error).slice(0,500)
  }));
}

try {
  const { qdaScenarioPartitionsDisjointForProbe } = await import('./autonomous-recursive-decomposition.js');
  const childA={
    requirement:'Solve the parent elasticity problem specifically for the elasticity scenario ε = -0.6.',
    completion_criterion:'Complete and verify only the ε = -0.6 scenario.'
  };
  const childB={
    requirement:'Solve the parent elasticity problem specifically for the elasticity scenario ε = -1.0.',
    completion_criterion:'Complete and verify only the ε = -1.0 scenario.'
  };
  const childSame={
    requirement:'Solve the parent elasticity problem specifically for the elasticity scenario ε = -0.6.',
    completion_criterion:'Complete and verify only the ε = -0.6 scenario.'
  };
  const interview={
    requirement:"Compute EVwSI net of cost for the 'Interview study' experiment.",
    completion_criterion:"Verify only the 'Interview study' experiment."
  };
  const pilot={
    requirement:"Compute EVwSI net of cost for the 'Paid pilot' experiment.",
    completion_criterion:"Verify only the 'Paid pilot' experiment."
  };
  console.log('AAU_QDA_ELASTICITY_PARTITION_PROBE',JSON.stringify({
    ok:qdaScenarioPartitionsDisjointForProbe(childA,childB)===true
      &&qdaScenarioPartitionsDisjointForProbe(childA,childSame)===false
      &&qdaScenarioPartitionsDisjointForProbe(interview,pilot)===true,
    disjoint:qdaScenarioPartitionsDisjointForProbe(childA,childB),
    same_partition_disjoint:qdaScenarioPartitionsDisjointForProbe(childA,childSame),
    named_alternative_disjoint:qdaScenarioPartitionsDisjointForProbe(interview,pilot),
    contract:'explicit_numeric_and_named_scenario_partition_v0_2',
  }));
} catch (error) {
  console.error('AAU_QDA_ELASTICITY_PARTITION_PROBE',JSON.stringify({
    ok:false,error:String(error?.message||error).slice(0,500)
  }));
}

try {
  const { qdaCurriculumFastPathPlan } = await import('./autonomous-recursive-decomposition.js');
  const independent=qdaCurriculumFastPathPlan({
    qda_601_context:{
      assigned:true,status:'in_progress',
      next_unit:{
        unit_code:'QDA601-M4-U2',module_code:'QDA601-M4',
        exercise_pack_ref:'curriculum/qda601-exercise-packs-v0.1.json#QDA601-M4-U2',
        exercise_pack:{external_research:false,problems:[
          'Campaign A converts 420 of 6,000 visitors; B converts 500 of 6,250. Compute rates and approximate 95% confidence intervals for each proportion.',
          'Compute an approximate 95% CI for the difference B−A and state whether zero is included.',
          'A retention sample observes 342 retained of 400 users. Estimate the proportion and 95% CI; explain what the interval does and does not claim.',
        ]},
      },
    },
  });
  const dependent=qdaCurriculumFastPathPlan({
    qda_601_context:{
      assigned:true,status:'in_progress',
      next_unit:{
        unit_code:'QDA601-M3-U3',module_code:'QDA601-M3',
        exercise_pack_ref:'curriculum/qda601-exercise-packs-v0.1.json#QDA601-M3-U3',
        exercise_pack:{external_research:false,problems:[
          'Prior probability that true high demand exists is 0.30. A positive pilot result has P(+|high)=0.80 and P(+|low)=0.25. Compute posterior after a positive pilot.',
          'A second independent signal conditional on demand has P(+|high)=0.70 and P(+|low)=0.35. Update again after a second positive signal.',
          'Then update the first posterior for a negative second signal and compare how strongly the evidence should change the thesis.',
        ]},
      },
    },
  });
  console.log('AAU_QDA_CURRICULUM_FAST_PATH_PROBE',JSON.stringify({
    ok:independent.applies===true
      &&independent.problem_count===3
      &&independent.statistical===true
      &&JSON.stringify(independent.children.map(child=>child.depends_on))==='[[],[1],[]]'
      &&JSON.stringify(independent.dependency_waves)==='[[1,3],[2]]'
      &&dependent.applies===true
      &&JSON.stringify(dependent.children.map(child=>child.depends_on))==='[[],[1],[1]]'
      &&JSON.stringify(dependent.dependency_waves)==='[[1],[2,3]]',
    independent_waves:independent.dependency_waves,
    independent_dependencies:independent.children.map(child=>child.depends_on),
    dependent_waves:dependent.dependency_waves,
    child_paths:independent.children.map(child=>child.node_path),
    contract:independent.contract,
  }));
} catch (error) {
  console.error('AAU_QDA_CURRICULUM_FAST_PATH_PROBE',JSON.stringify({
    ok:false,error:String(error?.message||error).slice(0,500)
  }));
}

try {
  const { qdaCurriculumFastPathPlan } = await import('./autonomous-recursive-decomposition.js');
  const regression=qdaCurriculumFastPathPlan({
    qda_601_context:{
      assigned:true,status:'in_progress',
      next_unit:{
        unit_code:'QDA601-M4-U3',module_code:'QDA601-M4',
        exercise_pack_ref:'curriculum/qda601-exercise-packs-v0.1.json#QDA601-M4-U3',
        exercise_pack:{external_research:false,problems:[
          'Interpret each coefficient with units and ceteris-paribus language.',
          'Approximate t-statistics for coefficients and discuss statistical evidence without converting association into causation.',
          'Explain why the pairwise ad-spend correlation and multivariable coefficient answer different questions; identify plausible confounders.',
        ]},
      },
    },
  });
  console.log('AAU_QDA_M4U3_VERIFIER_SCOPE_PROBE',JSON.stringify({
    ok:regression.applies===true
      &&regression.problem_count===3
      &&JSON.stringify(regression.children.map(child=>child.statistical))==='[false,true,false]'
      &&JSON.stringify(regression.dependency_waves)==='[[1,2,3]]',
    statistical_flags:regression.children.map(child=>child.statistical),
    dependency_waves:regression.dependency_waves,
  }));
} catch (error) {
  console.error('AAU_QDA_M4U3_VERIFIER_SCOPE_PROBE',JSON.stringify({
    ok:false,error:String(error?.message||error).slice(0,500)
  }));
}

try {
  const { runPythonStatisticalAnalyses } = await import('./python-quant.js');
  const probe=runPythonStatisticalAnalyses([{
    id:'m4u3_rounded_t_probe',
    analysis:'coefficient_t',
    spec:{estimate:3.8,se:0.9,df:100},
    claims:{t:4.22},
    absolute_tolerance:0.005,
  }]);
  console.log('AAU_QDA_M4U3_ROUNDED_T_PROBE',JSON.stringify({
    ok:probe.ok===true&&probe.all_claims_match===true,
    analysis_count:probe.analysis_count,
    error:probe.error||null,
  }));
} catch (error) {
  console.error('AAU_QDA_M4U3_ROUNDED_T_PROBE',JSON.stringify({
    ok:false,error:String(error?.message||error).slice(0,500)
  }));
}

try {
  const { normalizeQdaStatisticalContractNumbers } = await import('./autonomous-recursive-decomposition.js');
  const input={
    successes:'342',
    total:'400',
    confidence:'0.95',
    note:'400 users',
    values:['1','2.5','03','x'],
  };
  const out=normalizeQdaStatisticalContractNumbers(input);
  console.log('AAU_QDA_STATISTICAL_CONTRACT_NUMBER_NORMALIZER_PROBE',JSON.stringify({
    ok:out.successes===342
      &&out.total===400
      &&out.confidence===0.95
      &&out.note==='400 users'
      &&out.values[0]===1
      &&out.values[1]===2.5
      &&out.values[2]==='03'
      &&out.values[3]==='x',
    output:out,
  }));
} catch (error) {
  console.error('AAU_QDA_STATISTICAL_CONTRACT_NUMBER_NORMALIZER_PROBE',JSON.stringify({
    ok:false,error:String(error?.message||error).slice(0,500)
  }));
}

// one_shot_kimi_runtime_fault_review_v0_1
if (isEnabled('AAU_KIMI_RUNTIME_FAULT_REVIEW')) {
  try {
    const { reviewSilasRuntimeFaultWithKimi } = await import('./kimi-runtime-fault-review.js');
    const result = await reviewSilasRuntimeFaultWithKimi();
    console.log('AAU_KIMI_RUNTIME_FAULT_REVIEW_RESULT', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_KIMI_RUNTIME_FAULT_REVIEW_FAILED', JSON.stringify({
      error_name:error?.name||null,
      code:error?.code||null,
      status:error?.status||null,
      message:String(error?.message||error).slice(0,1600)
    }));
  }
}

// one_shot_kimi_child_overlap_review_v0_1
if (isEnabled('AAU_KIMI_CHILD_OVERLAP_REVIEW')) {
  try {
    const { reviewSilasChildOverlapFixWithKimi } = await import('./kimi-runtime-fault-review.js');
    const result = await reviewSilasChildOverlapFixWithKimi();
    console.log('AAU_KIMI_CHILD_OVERLAP_REVIEW_RESULT', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_KIMI_CHILD_OVERLAP_REVIEW_FAILED', JSON.stringify({
      error_name:error?.name||null,
      code:error?.code||null,
      status:error?.status||null,
      message:String(error?.message||error).slice(0,1600)
    }));
  }
}

// one_shot_expertise_runtime_repair_v0_1
if (isEnabled('AAU_EXPERTISE_RUNTIME_PATCH')) {
  try {
    const { patchExpertiseVerifierRuntime } = await import('./patch-expertise-verifier-runtime.js');
    const result = await patchExpertiseVerifierRuntime();
    console.log('AAU_EXPERTISE_RUNTIME_PATCH_RESULT', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_EXPERTISE_RUNTIME_PATCH_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 2000) }));
  }
}

// one_shot_file_response_runtime_repair_v0_1
if (isEnabled('AAU_FILE_RESPONSE_RUNTIME_PATCH')) {
  try {
    const { patchFileResponseRuntime } = await import('./patch-file-response-runtime.js');
    const result = await patchFileResponseRuntime();
    console.log('AAU_FILE_RESPONSE_RUNTIME_PATCH_RESULT', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_FILE_RESPONSE_RUNTIME_PATCH_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 2000) }));
  }
}

// one_shot_control_room_intent_visibility_v0_1
if (isEnabled('AAU_CONTROL_ROOM_INTENT_VISIBILITY_PATCH')) {
  try {
    const { patchControlRoomIntentVisibility } = await import('./patch-control-room-intents.js');
    const result = await patchControlRoomIntentVisibility();
    console.log('AAU_CONTROL_ROOM_INTENT_VISIBILITY_PATCH_RESULT', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_CONTROL_ROOM_INTENT_VISIBILITY_PATCH_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 2000) }));
  }
}

// Operator-only bounded source discovery probe. Does not wake an agent.
if (isEnabled('AAU_WEB_RESEARCH_SMOKE_TEST')) {
  try {
    const {smokeWebResearch} = await import('./web-research.js');
    const result = await smokeWebResearch();
    console.log('AAU_WEB_RESEARCH_SMOKE', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_WEB_RESEARCH_SMOKE', JSON.stringify({ok:false,error:String(error?.message||error).slice(0,500)}));
  }
}

const nvidiaSmokeEnabled = isEnabled('AAU_NVIDIA_SMOKE_TEST');
if (nvidiaSmokeEnabled) {
  try {
    const { nvidiaConfigStatus, probeNvidia } = await import('./providers/nvidia.js');
    console.log('AAU_NVIDIA_CONFIG_STATUS', JSON.stringify(nvidiaConfigStatus()));
    const result = await probeNvidia();
    console.log('AAU_NVIDIA_SMOKE_PROBE', JSON.stringify(result));
  } catch (error) {
    console.log('AAU_NVIDIA_SMOKE_PROBE', JSON.stringify({ ok: false, mode: 'experimental_only', error_name: error?.name || null, http_status: error?.status || null, message: String(error?.message || error).slice(0, 1000) }));
  }
}

if (isEnabled('AAU_NVIDIA_EXPERTISE_AUTH_SMOKE_TEST')) {
  try {
    const { probeNvidiaExpertiseAuthenticator } = await import('./nvidia-expertise-auth-probe.js');
    const result = await probeNvidiaExpertiseAuthenticator();
    console.log('AAU_NVIDIA_EXPERTISE_AUTH_SMOKE_PROBE', JSON.stringify(result));
  } catch (error) {
    console.log('AAU_NVIDIA_EXPERTISE_AUTH_SMOKE_PROBE', JSON.stringify({ ok: false, provider: 'nvidia_direct', model_requested: 'z-ai/glm-5.3', error_name: error?.name || null, http_status: error?.status || null, message: String(error?.message || error).slice(0, 1200) }));
  }
}

const fluxSmokeEnabled = isEnabled('AAU_NVIDIA_FLUX_SMOKE_TEST');
if (fluxSmokeEnabled) {
  try {
    const { probeNvidiaFlux2 } = await import('./flux-smoke-probe.js');
    const result = await probeNvidiaFlux2();
    console.log('AAU_NVIDIA_FLUX_SMOKE_PROBE', JSON.stringify(result));
  } catch (error) {
    console.log('AAU_NVIDIA_FLUX_SMOKE_PROBE', JSON.stringify({ ok: false, model: 'black-forest-labs/flux.2-klein-4b', error_name: error?.name || null, http_status: error?.status || null, error_message: String(error?.message || error).slice(0, 800) }));
  }
}


if (isEnabled('AAU_PRODUCT_TEST_EXECUTOR_ENABLED')) {
  try {
    const { startProductTestExecutorWorker } = await import('./product-test-executor-worker.js');
    const result = startProductTestExecutorWorker();
    console.log('AAU_PRODUCT_TEST_EXECUTOR_STARTED', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_PRODUCT_TEST_EXECUTOR_START_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 1600) }));
  }
}

if (isEnabled('AAU_PRODUCT_TEST_DESIGNER_ENABLED')) {
  try {
    const { startProductTestDesignerWorker } = await import('./product-test-designer-worker.js');
    const result = startProductTestDesignerWorker();
    console.log('AAU_PRODUCT_TEST_DESIGNER_STARTED', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_PRODUCT_TEST_DESIGNER_START_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 1600) }));
  }
}

if (isEnabled('AAU_PRODUCT_SERVICE_ARCHITECT_ENABLED') || process.env.RENDER_SERVICE_ID === 'srv-dajkd5p594qs73chs46g') {
  try {
    const { startProductServiceArchitectWorker } = await import('./product-service-architect-worker.js');
    const result = startProductServiceArchitectWorker();
    console.log('AAU_PRODUCT_SERVICE_ARCHITECT_STARTED', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_PRODUCT_SERVICE_ARCHITECT_START_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 1600) }));
  }
}

if (isEnabled('AAU_PRODUCT_ARCH_CONFORMANCE_ENABLED')) {
  try {
    const { startProductArchitectureConformanceWorker } = await import('./product-architecture-conformance-worker.js');
    const result = startProductArchitectureConformanceWorker();
    console.log('AAU_PRODUCT_ARCH_CONFORMANCE_STARTED', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_PRODUCT_ARCH_CONFORMANCE_START_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 1600) }));
  }
}

// Independent AAU graduate-standard author/reviewer is an institutional job,
// not a learner wake. Idle polling makes no model calls.
try {
  const { startExpertiseStandardAuthorWorker } = await import('./expertise-standard-author-worker.js');
  console.log('AAU_ACADEMIC_STANDARDS_STARTED', JSON.stringify(startExpertiseStandardAuthorWorker()));
} catch (error) {
  console.error('AAU_ACADEMIC_STANDARDS_START_FAILED', String(error?.message || error).slice(0,800));
}

if (isEnabled('AAU_EXPERTISE_VERIFIER_ENABLED')) {
  try {
    const { startExpertiseVerificationWorker } = await import('./expertise-verification-worker.js');
    const result = startExpertiseVerificationWorker();
    console.log('AAU_EXPERTISE_VERIFIER_STARTED', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_EXPERTISE_VERIFIER_START_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 1600) }));
  }
  try {
    const { startQda601AuthenticatorWorker } = await import('./qda601-authenticator-worker.js');
    const result = startQda601AuthenticatorWorker();
    console.log('AAU_QDA601_AUTHENTICATOR_STARTED', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_QDA601_AUTHENTICATOR_START_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 1600) }));
  }
}

if (isEnabled('AAU_ENTREPRENEURSHIP_ASSESSOR_ENABLED')) {
  try {
    const { startEntrepreneurshipAssessmentWorker } = await import('./entrepreneurship-assessment-worker.js');
    const result = startEntrepreneurshipAssessmentWorker();
    console.log('AAU_ENTREPRENEURSHIP_ASSESSOR_STARTED', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_ENTREPRENEURSHIP_ASSESSOR_START_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 1600) }));
  }
}

if (isEnabled('AAU_EMBODIMENT_RENDERER_ENABLED')) {
  try {
    const { startEmbodimentRenderWorker } = await import('./embodiment-render-worker.js');
    const result = startEmbodimentRenderWorker();
    console.log('AAU_EMBODIMENT_RENDERER_STARTED', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_EMBODIMENT_RENDERER_START_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 1200) }));
  }
}

if (isEnabled('AAU_AGENT_FILE_VISION_ENABLED')) {
  try {
    const { startAgentFileVisionWorker } = await import('./agent-file-vision-worker.js');
    const result = startAgentFileVisionWorker();
    console.log('AAU_AGENT_FILE_VISION_STARTED', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_AGENT_FILE_VISION_START_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 1600) }));
  }
}

// Open the health endpoint before any optional startup cognition can block on a model/provider.
await import('./broker-bridge-envcheck.js');

try {
  const { moonshotConfigStatus } = await import('./providers/moonshot.js');
  console.log('AAU_MOONSHOT_DIRECT_CONFIG', JSON.stringify(moonshotConfigStatus()));
} catch (error) {
  console.warn('AAU_MOONSHOT_DIRECT_CONFIG_FAILED', JSON.stringify({
    error_name:error?.name || null,
    message:String(error?.message || error).slice(0,800),
  }));
}

const modelWakeEnabled = isEnabled('AAU_MODEL_WAKE_ON_START');
if (modelWakeEnabled) {
  try {
    const { runExperimentalModelWake } = await import('./experimental-model-wake.js');
    const result = await runExperimentalModelWake();
    console.log('AAU_MODEL_AGENT_WAKE_RESULT', JSON.stringify(result));
  } catch (error) {
    console.log('AAU_MODEL_AGENT_WAKE_RESULT', JSON.stringify({ status: 'failed', mode: 'experimental_only', error_name: error?.name || null, http_status: error?.status || null, message: String(error?.message || error).slice(0, 2000) }));
  }
}

const singleWakeConfigured = isEnabled('AAU_MODEL_SINGLE_WAKE_ON_START') && Boolean(
  String(process.env.AAU_MODEL_SINGLE_WAKE_REQUEST_ID || '').trim() && String(process.env.AAU_MODEL_SINGLE_WAKE_AGENT_ID || '').trim()
);
if (singleWakeConfigured) {
  const { runConfiguredModelSingleWake } = await import('./model-single-agent-wake.js');
  await runConfiguredModelSingleWake();
}

const manualWakeConfigured = isEnabled('AAU_MODEL_MANUAL_WAKE_ON_START') && Boolean(
  String(process.env.AAU_MODEL_MANUAL_WAKE_REQUEST_ID || '').trim() && String(process.env.AAU_MODEL_MANUAL_WAKE_AGENT_ID || '').trim()
);
if (manualWakeConfigured) {
  try {
    const { runConfiguredModelManualWake } = await import('./model-manual-agent-wake.js');
    const result = await runConfiguredModelManualWake();
    console.log('AAU_MODEL_MANUAL_WAKE_STARTUP_RESULT', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_MODEL_MANUAL_WAKE_STARTUP_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 2000) }));
  }
}

if (isEnabled('AAU_QDA601_BOOTSTRAP_ON_START')) {
  try {
    const { runConfiguredQda601Bootstrap } = await import('./qda601-bootstrap.js');
    const result = await runConfiguredQda601Bootstrap();
    console.log('AAU_QDA601_BOOTSTRAP_RESULT', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_QDA601_BOOTSTRAP_FAILED', JSON.stringify({
      error_name:error?.name || null,
      message:String(error?.message || error).slice(0,2000),
    }));
  }
}

if (isEnabled('AAU_AUTONOMOUS_LIFECYCLE_ENABLED')) {
  try {
    const { startModelAutonomousLifecycle } = await import('./model-autonomous-lifecycle.js');
    const result = await startModelAutonomousLifecycle();
    console.log('AAU_AUTONOMOUS_LIFECYCLE_STARTED', JSON.stringify(result));
  } catch (error) {
    console.error('AAU_AUTONOMOUS_LIFECYCLE_START_FAILED', JSON.stringify({ error_name: error?.name || null, message: String(error?.message || error).slice(0, 2000) }));
  }
}

// Moonshot fresh-agent bootstrap is intentionally fire-and-forget so the existing
// autonomous agent lifecycle starts first and remains unaffected.
if (isEnabled('AAU_MOONSHOT_BOOTSTRAP_ON_START')) {
  void import('./moonshot-bootstrap-series.js')
    .then(({ runMoonshotBootstrapSeries }) => runMoonshotBootstrapSeries())
    .then((result) => console.log('AAU_MOONSHOT_BOOTSTRAP_RESULT', JSON.stringify(result)))
    .catch((error) => console.error('AAU_MOONSHOT_BOOTSTRAP_FAILED', JSON.stringify({
      error_name:error?.name || null,
      http_status:error?.status || null,
      message:String(error?.message || error).slice(0,3000),
    })));
}

if (isEnabled('AAU_VERCEL_DIAGNOSTIC_ON_START')) {
  void import('./vercel-diagnostic-probe.js')
    .then(({ probeLatestVercelDeployment }) => probeLatestVercelDeployment())
    .then((result) => console.log('AAU_VERCEL_DIAGNOSTIC_RESULT', JSON.stringify(result)))
    .catch((error) => console.error('AAU_VERCEL_DIAGNOSTIC_FAILED', JSON.stringify({
      message: String(error?.message || error).slice(0,1200),
      details: error?.details || null,
    })));
}

// Shared Knowledge Pool source refresh is independent of the operator-paused news broadcaster.
// Runtime-config and source enablement are enforced again by the broker-token DB RPC.
try {
  const { startKnowledgeSourceRefresh } = await import('./knowledge-source-refresh.js');
  console.log('AAU_KNOWLEDGE_SOURCE_REFRESH_STARTED',JSON.stringify(startKnowledgeSourceRefresh()));
} catch(error) {
  console.error('AAU_KNOWLEDGE_SOURCE_REFRESH_START_FAILED',String(error?.message||error).slice(0,500));
}

// Reviewer endpoint smoke is opt-in. A model call on every broker restart wastes
// paid reviewer tokens and historically blocked on the legacy hosted Kimi route.
if (isEnabled('AAU_REVIEWER_ENDPOINT_SMOKE')) {
  try {
    const { startReviewerEndpointSmoke } = await import('./reviewer-endpoint-smoke.js');
    console.log('AAU_REVIEWER_ENDPOINT_SMOKE_STARTED', JSON.stringify(startReviewerEndpointSmoke()));
  } catch(error) {
    console.error('AAU_REVIEWER_ENDPOINT_SMOKE_START_FAILED',String(error?.message||error).slice(0,250));
  }
}

await import('./broker-bridge-envcheck.js');

if (isEnabled('AAU_KIMI_LATENCY_REVIEW')) {
  // Read-only one-shot Kimi review of observed cognition latency. No agent mutation.
  void import('./kimi-cognition-latency-review.js')
    .then(({runKimiCognitionLatencyReview})=>runKimiCognitionLatencyReview())
    .then(result=>console.log('AAU_KIMI_LATENCY_REVIEW_RESULT',JSON.stringify(result)))
    .catch(error=>console.error('AAU_KIMI_LATENCY_REVIEW_FAILED',JSON.stringify({
      name:error?.name||null,
      code:error?.code||null,
      status:error?.status||null,
      message:String(error?.message||error).slice(0,3000),
    })));
}

if (isEnabled('AAU_KIMI_COGNITION_FINAL_CLOSURE')) {
  void import('./kimi-cognition-final-closure.js')
    .then(({runKimiCognitionFinalClosure})=>runKimiCognitionFinalClosure())
    .then(result=>console.log('AAU_KIMI_COGNITION_FINAL_CLOSURE_RESULT',JSON.stringify(result)))
    .catch(error=>console.error('AAU_KIMI_COGNITION_FINAL_CLOSURE_FAILED',JSON.stringify({
      name:error?.name||null,
      code:error?.code||null,
      status:error?.status||null,
      message:String(error?.message||error).slice(0,3000),
    })));
}

if (isEnabled('AAU_KIMI_COGNITION_FIX_VERIFY')) {
  void import('./kimi-cognition-fix-verification.js')
    .then(({runKimiCognitionFixVerification})=>runKimiCognitionFixVerification())
    .then(result=>console.log('AAU_KIMI_COGNITION_FIX_VERIFY_RESULT',JSON.stringify(result)))
    .catch(error=>console.error('AAU_KIMI_COGNITION_FIX_VERIFY_FAILED',JSON.stringify({
      name:error?.name||null,
      code:error?.code||null,
      status:error?.status||null,
      message:String(error?.message||error).slice(0,3000),
    })));
}

if (isEnabled('AAU_KIMI_COGNITION_SYSTEM_AUDIT')) {
  // Fire-and-forget read-only system audit. It never wakes, grades, pauses,
  // mutates, or repairs an agent. Kimi reviews source and emits structured logs.
  void import('./kimi-cognition-system-audit.js')
    .then(({runKimiCognitionSystemAudit})=>runKimiCognitionSystemAudit())
    .then(result=>console.log('AAU_KIMI_COGNITION_AUDIT_COMPLETE',JSON.stringify({
      ok:result.ok,
      overall_verdict:result?.synthesis?.review?.overall_verdict||null,
      release_gate:result?.synthesis?.review?.release_gate||null,
      confidence:result?.synthesis?.review?.confidence??null,
      total_usage:{
        prompt_tokens:[result.pass_a,result.pass_b,result.pass_c,result.synthesis]
          .reduce((sum,v)=>sum+Number(v?.usage?.prompt_tokens||0),0),
        completion_tokens:[result.pass_a,result.pass_b,result.pass_c,result.synthesis]
          .reduce((sum,v)=>sum+Number(v?.usage?.completion_tokens||0),0),
        total_tokens:[result.pass_a,result.pass_b,result.pass_c,result.synthesis]
          .reduce((sum,v)=>sum+Number(v?.usage?.total_tokens||0),0),
      }
    })))
    .catch(error=>console.error('AAU_KIMI_COGNITION_AUDIT_FATAL',JSON.stringify({
      name:error?.name||null,
      code:error?.code||null,
      status:error?.status||null,
      message:String(error?.message||error).slice(0,3000),
    })));
}

if (isEnabled('AAU_AUTHENTICATOR_IO_TIMEOUT_PROBE')) {
  // Run independently of broker boot; never touch agent evidence or verification state.
  void import('./authenticator-io-timeout-probe.js')
    .then(({probeAuthenticatorIoTimeout})=>probeAuthenticatorIoTimeout())
    .then(result=>console.log('AAU_AUTH_IO_TEST_COMPLETE',JSON.stringify(result)))
    .catch(error=>console.error('AAU_AUTH_IO_TEST_FATAL',JSON.stringify({
      name:error?.name||null,message:String(error?.message||error).slice(0,300)
    })));
}

if (isEnabled('AAU_AGENT_COGNITION_IO_TIMEOUT_PROBE')) {
  // Synthetic-only, no agent state or grades; explicitly opt-in.
  void import('./agent-cognition-io-timeout-probe.js')
    .then(({probeAgentCognitionIoTimeout})=>probeAgentCognitionIoTimeout())
    .catch(error=>console.error('AAU_AGENT_IO_TEST_FATAL',JSON.stringify({
      name:error?.name||null,message:String(error?.message||error).slice(0,300)
    })));
}

if (isEnabled('AAU_SILAS_CONTINUATION_PILOT')) {
  // Explicitly opt-in standalone pilot: does not wake, grade, or modify an agent.
  void import('./silas-continuation-runner.js')
    .then(m => m.runSilasContinuationPilot())
    .catch(e => console.error('AAU_SILAS_PILOT_FATAL', JSON.stringify({error: String(e?.message || e).slice(0,180)})));
}

if (isEnabled('AAU_SILAS_HOLISTIC_CONTINUATION')) {
  // Silas-only off-curriculum continuation; previous numeric errors are preserved.
  void import('./silas-holistic-continuation.js')
    .then(m => m.runSilasHolisticContinuation())
    .catch(e => console.error('AAU_SILAS_HOLISTIC_FATAL', JSON.stringify({code:e?.code||e?.name||'error',message:String(e?.message||e).slice(0,180)})));
}

if (isEnabled('AAU_SILAS_THINKING_ON_PILOT')) {
  // Separate off-curriculum condition, opt-in; never wakes or grades Silas.
  void import('./silas-thinking-on-runner.js')
    .then(m => m.runSilasThinkingOn())
    .catch(e => console.error('AAU_SILAS_THINKING_ON_FATAL', JSON.stringify({code:e?.code||e?.name||'error',message:String(e?.message||e).slice(0,180)})));
}

if (isEnabled('AAU_SILAS_THINKING_ON_SPLIT_LEDGER')) {
  // Bounded recovery of isolated thinking-on stage 2 after the original 300s timeout.
  void import('./silas-thinking-on-decomposed.js')
    .then(m => m.runSilasThinkingOnDecomposed())
    .catch(e => console.error('AAU_SILAS_SPLIT_FATAL', JSON.stringify({code:e?.code||e?.name||'error',message:String(e?.message||e).slice(0,180)})));
}

if (isEnabled('AAU_SILAS_THINKING_ON_SPLIT_PURCHASE')) {
  // Silas-only bounded day-28 continuation after purchase timeout.
  void import('./silas-on-purchase-checkpoints.js')
    .then(m => m.runSilasPurchaseBContinuation())
    .catch(e => console.error('AAU_SILAS_B_CONTINUATION_FATAL', JSON.stringify({code:e?.code||e?.name||'error',message:String(e?.message||e).slice(0,180)})));
}

if (isEnabled('AAU_SILAS_ENGINEERING_HYDRAULIC')) {
  // Silas-only off-curriculum engineering exercise; thinking ON, durable bounded steps.
  void import('./silas-engineering-hydraulic.js')
    .then(m => m.runSilasEngineeringExercise())
    .catch(e => console.error('AAU_SILAS_ENGINEERING_FATAL',JSON.stringify({code:e?.code||e?.name||'error',message:String(e?.message||e).slice(0,180)})));
}

if (isEnabled('AAU_SILAS_ENGINEERING_D63_RECOVERY')) {
  void import('./silas-engineering-d63-recovery.js')
    .then(m => m.runSilasEngineeringD63Recovery())
    .catch(e => console.error('AAU_SILAS_ENGINEERING_D63_FATAL',JSON.stringify({code:e?.code||e?.name||'error',message:String(e?.message||e).slice(0,180)})));
}

if (isEnabled('AAU_SILAS_ENGINEERING_FEASIBILITY_CONTINUATION')) {
  // Silas-only bounded continuation after ROUTE-V2 full-matrix timeout.
  void import('./silas-engineering-feasibility-continuation.js')
    .then(m => m.runSilasEngineeringFeasibilityContinuation())
    .catch(e => console.error('AAU_SILAS_ENGINEERING_CONT_FATAL',JSON.stringify({code:e?.code||e?.name||'error',message:String(e?.message||e).slice(0,180)})));
}

if (isEnabled('AAU_SILAS_ENGINEERING_SINGLE_PUMP_RECOVERY')) {
  // Silas-only one-candidate continuation after multi-pump screening timeout.
  void import('./silas-engineering-single-pump-recovery.js')
    .then(m => m.runSilasEngineeringSinglePumpRecovery())
    .catch(e => console.error('AAU_SILAS_ENGINEERING_SINGLE_FATAL',JSON.stringify({code:e?.code||e?.name||'error',message:String(e?.message||e).slice(0,180)})));
}

if (isEnabled('AAU_SILAS_CHEMISTRY_KINETICS')) {
  // Silas-only off-curriculum Master's chemistry test; thinking ON, bounded candidates.
  void import('./silas-chemistry-kinetics.js')
    .then(m => m.runSilasChemistryKinetics())
    .catch(e => console.error('AAU_SILAS_CHEM_FATAL',JSON.stringify({code:e?.code||e?.name||'error',message:String(e?.message||e).slice(0,180)})));
}
