import fs from 'node:fs';
import { modelChatCompletion } from './providers/model-provider.js';

const read=(relative)=>fs.readFileSync(new URL('../'+relative,import.meta.url),'utf8');
const core=read('workers/autonomous-recursive-decomposition.js');
const controls=read('workers/semantic-runtime-controls.js');
const qda=read('workers/qda601-runtime.js');
const execution=read('workers/model-intent-execution.js');
const lifecycle=read('workers/model-autonomous-lifecycle.js');

const incidentHistory=[
  {
    id:'split_zero_child_terminal_collapse',
    sequence:[
      'Atomic QDA node truncated and was forced to SPLIT.',
      'Agent-authored child beginning with reconcile was classified as runtime-owned terminal synthesis.',
      'The only proposed child was collapsed to DONE, leaving zero authored children.',
      'A later invariant threw autonomous_decomposition_split_requires_child and paused cognition.'
    ],
    repaired:'Narrowed terminal classifier plus nonfatal zero-child reconsideration path.'
  },
  {
    id:'repeated_child_overlap',
    sequence:[
      'Accepted children already covered ACV, CAC, and churn_monthly.',
      'Model repeatedly proposed a third child overlapping accepted siblings while gross_margin remained.',
      'Overlap guard correctly rejected it but retries rediscovered the whole decomposition and burned large token budgets.'
    ],
    repaired:'Authoritative structured remaining-scope ledger, bounded reconsideration cycles, per-epoch counters.'
  },
  {
    id:'remediation_invalid_available_action',
    sequence:[
      'All structured variable scope became durably covered by accepted children.',
      'Self-remediation invalidated the discovery checkpoint and required fresh discovery.',
      'Atomic overflow recovery exposed only SPLIT.',
      'Agent expressed terminal intent with DONE/COMPLETE/SYNTHESIZE-like language after decomposition was complete.',
      'Discovery enum validation rejected the output twice and raised autonomous_decomposition_discovery_invalid_available_action.'
    ],
    repaired:'Existing completed split continuation is exposed explicitly; terminal aliases normalize to SPLIT only when durable split coverage is already complete.'
  },
  {
    id:'orphan_checkpoint_identity',
    sequence:[
      'Worker replacement interrupted a live wake.',
      'Orphan recovery only recognized source_wake_request_id.',
      'A durable node updated by the interrupted wake but originating on an older wake was treated as lacking a checkpoint.'
    ],
    repaired:'Recovery now accepts source_wake_request_id OR last_wake_request_id.'
  }
];

const commonSystem=[
  'You are Kimi K3 acting as the independent senior runtime auditor for AAU.',
  'Audit control flow, state transitions, persistence/restart safety, bounded retries, model/runtime authority boundaries, and convergence.',
  'Do not solve curriculum problems and do not assess Silas intelligence.',
  'Treat model output as fallible protocol input: distinguish semantic disagreement from runtime/protocol failure.',
  'Look especially for COMPOSED failures that appear only after multiple individually-valid transitions.',
  'Do not merely restate known incidents. Search for latent bugs of the same class elsewhere.',
  'Classify findings P0/P1/P2/P3. A P0/P1 must name an exact reachable state sequence and violated invariant.',
  'Prefer systemic fixes and state-machine invariants over prompt-only fixes.',
  'Return strict JSON only.'
].join(' ');

async function ask(label,system,user,maxTokens){
  const started=Date.now();
  const result=await modelChatCompletion({
    provider:'moonshot_direct',
    model:'kimi-k3',
    messages:[{role:'system',content:system},{role:'user',content:user}],
    maxTokens,
    temperature:0,
    jsonMode:true,
    reasoningEffort:'low',
    timeoutMs:600000,
    runtimeRole:'adjudicator',
  });
  let parsed=null;
  try{parsed=JSON.parse(String(result.content||''));}catch{}
  const out={
    label,
    ok:result.finish_reason==='stop'&&!!parsed,
    finish_reason:result.finish_reason||null,
    latency_ms:Date.now()-started,
    usage:result.usage||null,
    review:parsed,
    raw:parsed?null:String(result.content||'').slice(0,12000),
  };
  console.log('AAU_KIMI_COGNITION_AUDIT_'+label,JSON.stringify(out));
  return out;
}

export async function runKimiCognitionSystemAudit(){
  const splitAt=Math.max(0,core.indexOf('async function executeAtomic'));
  const coreRouting=core.slice(0,splitAt);
  const coreExecution=core.slice(Math.max(0,splitAt-12000));

  const passA=await ask(
    'PASS_A',
    commonSystem+' Focus this pass on discovery, routing, remediation, decomposition, child authoring, checkpoint identity, retry accounting, and semantic-runtime admission.',
    JSON.stringify({
      audit_scope:'core routing/decomposition/remediation',
      known_incidents:incidentHistory,
      required_output:{
        verdict:'PASS|CONCERNS|FAIL',
        invariants_checked:'array',
        findings:'array of {severity,id,state_sequence,violated_invariant,evidence,impact,systemic_fix,regression_test}',
        suspicious_throw_paths:'array',
        retry_or_cost_amplifiers:'array',
        missing_state_combinations:'array',
        confidence:'0..1'
      },
      source_files:{
        'workers/autonomous-recursive-decomposition.js#routing_through_child_authoring':coreRouting,
        'workers/semantic-runtime-controls.js':controls
      }
    }),
    3600
  );

  const passB=await ask(
    'PASS_B',
    commonSystem+' Focus this pass on atomic execution, deterministic verification, synthesis/reconciliation, split continuation, QDA fast paths, child dependency execution, terminal states, and protocol normalization.',
    JSON.stringify({
      audit_scope:'core execution/synthesis/QDA integration',
      known_incidents:incidentHistory,
      required_output:{
        verdict:'PASS|CONCERNS|FAIL',
        invariants_checked:'array',
        findings:'array of {severity,id,state_sequence,violated_invariant,evidence,impact,systemic_fix,regression_test}',
        semantic_vs_protocol_failure_confusions:'array',
        completion_or_synthesis_dead_ends:'array',
        persistence_restart_risks:'array',
        confidence:'0..1'
      },
      source_files:{
        'workers/autonomous-recursive-decomposition.js#atomic_through_root_completion':coreExecution,
        'workers/qda601-runtime.js':qda
      }
    }),
    3600
  );

  const passC=await ask(
    'PASS_C',
    commonSystem+' Focus this pass on orchestration around the cognition engine: wake execution, fault classification, continuation/rearm policy, lifecycle pause/resume, provider/runtime errors, and whether lower-level recoverable states are accidentally promoted into global lifecycle failures.',
    JSON.stringify({
      audit_scope:'cognition orchestration/lifecycle boundary',
      known_incidents:incidentHistory,
      required_output:{
        verdict:'PASS|CONCERNS|FAIL',
        invariants_checked:'array',
        findings:'array of {severity,id,state_sequence,violated_invariant,evidence,impact,systemic_fix,regression_test}',
        fault_classification_mismatches:'array',
        continuation_or_rearm_hazards:'array',
        lifecycle_scope_escalation_hazards:'array',
        confidence:'0..1'
      },
      source_files:{
        'workers/model-intent-execution.js':execution,
        'workers/model-autonomous-lifecycle.js':lifecycle
      }
    }),
    3000
  );

  const synthesis=await ask(
    'SYNTHESIS',
    commonSystem+' You are now the final independent adjudicator. Merge the three code-review passes into ONE prioritized cognition-runtime audit. De-duplicate findings, reject speculative findings that lack a reachable sequence, and identify the smallest set of systemic invariants/tests that would have caught both the known incidents and the newly discovered issues.',
    JSON.stringify({
      audit_scope:'entire AAU cognition runtime synthesis',
      known_incidents:incidentHistory,
      pass_a:passA.review||passA.raw,
      pass_b:passB.review||passB.raw,
      pass_c:passC.review||passC.raw,
      required_output:{
        overall_verdict:'PASS|CONCERNS|FAIL',
        release_gate:'GO|GO_WITH_FIXES|BLOCK',
        p0_findings:'array',
        p1_findings:'array',
        p2_findings:'array',
        state_machine_invariants:'array of exact enforceable invariants',
        mandatory_regression_matrix:'array of state transition scenarios',
        recommended_fix_order:'array',
        what_previous_audits_missed:'array',
        confidence:'0..1'
      }
    }),
    3600
  );

  return {
    ok:passA.ok&&passB.ok&&passC.ok&&synthesis.ok,
    pass_a:passA,
    pass_b:passB,
    pass_c:passC,
    synthesis,
  };
}
