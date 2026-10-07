import fs from 'node:fs';
import { modelChatCompletion } from './providers/model-provider.js';

const read=(relative)=>fs.readFileSync(new URL('../'+relative,import.meta.url),'utf8');
const excerpt=(source,needle,before=1800,after=6500)=>{
  const index=source.indexOf(needle);
  if(index<0)return 'MISSING:'+needle;
  return source.slice(Math.max(0,index-before),Math.min(source.length,index+after));
};

export async function runKimiCognitionFixVerification(){
  const cognition=read('workers/autonomous-recursive-decomposition.js');
  const execution=read('workers/model-intent-execution.js');
  const lifecycle=read('workers/model-autonomous-lifecycle.js');
  const boundedSql=read('sql/aau-bounded-cognition-failure-lanes-v0.1.sql');
  const orphanSql=read('sql/aau-recursive-cognition-orphan-recovery-v0.4.sql');
  const staleDeliverySql=read('sql/aau-prebegin-stale-delivery-v0.2.sql');

  const findings=[
    'split_parent_fail_closed_synchronous_infinite_recursion',
    'post_commit_ancillary_rpc_failure_promotes_to_global_intent_failure_and_rearm',
    'deep_checkpoint_integrity_mismatch_unbounded_rearm_loop',
    'pre_begin_and_begin_rpc_failures_cause_unbounded_rearm_without_failure_record',
    'budget_exhausted_terminal_close_with_dead_partial_finalize_path',
    'post_reconciliation_math_failure_reuses_identical_atomic_checkpoint',
    'unbounded_deterministic_math_retry_asymmetry',
    'model_json_parse_failure_and_truncation_not_classified_as_recoverable_cognition_fault',
    'qda_materialization_blocked_runtime_condition_marked_as_committed_semantic_failure',
    'structured_remaining_scope_counts_excluded_scope_as_covered',
    'structured_child_overlap_loop_without_authoritative_remaining_scope'
  ];

  const packet={
    audit_kind:'post_fix_cognition_state_machine_verification',
    prior_findings:findings,
    required_invariant:
      'Every retry must either mutate durable semantic/checkpoint identity, consume a bounded retry counter, or terminate into an explicit recovery/hold state. A committed cognition must never be replayed.',
    live_regression_observation:{
      unit:'QDA601-M8-U2',
      prior_state:'Three accepted conflict-analysis children covered authoritative statements S1-S6. Fourth child repeatedly overlapped before statement-scope support.',
      post_fix_state:'Runtime deterministically exposed S7-S8 as remaining authoritative statements, accepted R.001.004 for the Finance-vs-Ops gross-margin conflict, then accepted DONE at ordinal 5. No overlap threshold reduction was made.'
    },
    source:{
      structured_scope_and_continuation:excerpt(cognition,'export function structuredChildScopeLedger',1200,10500),
      child_failure_and_budget:excerpt(cognition,'const returnChildAuthoringFailure=async',1000,11500),
      split_parent_verification:excerpt(cognition,'splitParentVerificationRetryState',1000,9000),
      post_reconciliation_verification:excerpt(cognition,'const finalMathVerification=deterministicMathVerification',1200,10500),
      checkpoint_integrity:excerpt(execution,'async function resolveDeepCognitionWithCheckpoint',900,9000),
      execution_apply_and_postcommit:excerpt(execution,"const applied = await rpc('aau_bridge_apply_model_intent_execution'",1200,9500),
      execution_failure_classification:excerpt(execution,'const cognitionResponseRejected=',1500,9500),
      lifecycle_disposition:excerpt(lifecycle,'async function handleIntent',800,10500),
      bounded_failure_lanes:boundedSql,
      prebegin_stale_delivery:staleDeliverySql,
      orphan_recovery_identity:excerpt(orphanSql,'source_wake_request_id=r.wake_request_id',1200,4500),
    }
  };

  const system=[
    'You are Kimi K3, independent senior runtime auditor for AAU.',
    'This is a focused POST-FIX verification against findings from your prior full cognition audit.',
    'Use only supplied source and live regression observation.',
    'For each prior finding classify CLOSED, PARTIAL, or OPEN.',
    'CLOSED requires the previously reachable bad sequence to be prevented by source-level control flow, not merely by prompt text.',
    'Do not demand deletion/quarantine when an explicit bounded hold safely terminates the loop; judge the invariant, not your earlier preferred implementation.',
    'Flag a new P1 only if you can give an exact reachable state sequence from supplied source.',
    'Return compact strict JSON only with keys overall_verdict, release_gate, finding_status, remaining_p1, remaining_p2, invariant_assessment, mandatory_tests, confidence.',
    'release_gate must be GO, GO_WITH_FIXES, or BLOCK. finding_status is an object keyed by finding id with status, evidence, remaining_risk.'
  ].join(' ');

  const result=await modelChatCompletion({
    provider:'moonshot_direct',
    model:'kimi-k3',
    messages:[
      {role:'system',content:system},
      {role:'user',content:JSON.stringify(packet)}
    ],
    maxTokens:2400,
    temperature:0,
    jsonMode:true,
    reasoningEffort:'low',
    timeoutMs:300000,
    runtimeRole:'adjudicator',
  });
  let review=null;
  try{review=JSON.parse(String(result.content||''));}catch{}
  return {
    ok:result.finish_reason==='stop'&&!!review,
    finish_reason:result.finish_reason||null,
    usage:result.usage||null,
    review,
    raw:review?null:String(result.content||'').slice(0,12000),
  };
}
