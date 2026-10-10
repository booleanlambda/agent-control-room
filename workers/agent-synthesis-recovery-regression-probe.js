// Pure state-machine regression: no provider calls, agent reads, DB writes or wakes.
import { strict as assert } from 'node:assert';
import {
  eligibleCompletedSplitSynthesisRecovery,
  synthesisRecoveryAvailableDecisions,
  failedSynthesisNeedsDiscovery,
  normalizeExistingSplitDiscoveryDecision,
} from './autonomous-recursive-decomposition.js';

export function probeCompletedSplitSynthesisRecovery(){
  let checks=0;
  const ok=(condition,message)=>{assert.equal(Boolean(condition),true,message);checks++;};
  const h1='child-one-verbatim-sha',h2='child-two-verbatim-sha';
  const children=[
    {node_path:'R.1',status:'completed',result_hash:h1},
    {node_path:'R.2',status:'completed',result_hash:h2},
  ];
  const failure={
    failed_at:'2026-10-10T07:02:03.698Z',
    failure_type:'synthesis_response_contract_exhausted',
    child_result_hashes:children.map(c=>({
      path:c.node_path,status:c.status,result_hash:c.result_hash,
    })),
  };
  const continuation={
    available:true,child_count:2,child_paths:['R.1','R.2'],
    child_statuses:children.map(c=>({node_path:c.node_path,status:c.status})),
  };
  ok(eligibleCompletedSplitSynthesisRecovery(failure,continuation,children),'saved resolved children qualify');
  ok(!eligibleCompletedSplitSynthesisRecovery(failure,continuation,[children[0],{...children[1],status:'pending'}]),'pending child cannot bypass authoring');
  ok(!eligibleCompletedSplitSynthesisRecovery(failure,continuation,[children[0],{...children[1],result_hash:'drift'}]),'changed evidence hash cannot bypass validation');
  ok(!eligibleCompletedSplitSynthesisRecovery(failure,{...continuation,available:false},children),'unfinished split not eligible');
  ok(!eligibleCompletedSplitSynthesisRecovery({},continuation,children),'normal routing does not grant recovery shortcut');
  ok(!eligibleCompletedSplitSynthesisRecovery(failure,continuation,[children[0]]),'missing child cannot bypass');
  ok(!eligibleCompletedSplitSynthesisRecovery(failure,continuation,[...children,children[1]]),'duplicate child cannot bypass');
  const opts=synthesisRecoveryAvailableDecisions({
    remediationAvailable:false,existingCompletedSplit:true,evidenceAcquisitionClosed:false,
  });
  ok(opts.join('|')==='SPLIT|NEED_CONTEXT|BLOCKED','exhausted remediation still permits existing split continuation');
  ok(normalizeExistingSplitDiscoveryDecision('SYNTHESIZE',opts,continuation).decision==='SPLIT','terminal alias resumes saved split');
  const noExisting=synthesisRecoveryAvailableDecisions({
    remediationAvailable:true,existingCompletedSplit:false,evidenceAcquisitionClosed:true,
  });
  ok(noExisting.join('|')==='REMEDIATE|BLOCKED','no completed children means no SPLIT');
  ok(normalizeExistingSplitDiscoveryDecision('SYNTHESIZE',noExisting,continuation).decision==='SYNTHESIZE','no alias without authorized action');
  const pending={decision_payload:{synthesis_failure:failure}};
  ok(failedSynthesisNeedsDiscovery(pending),'fresh synthesis failure must be routed');
  const committed={
    decision_payload:{
      synthesis_failure:failure,
      synthesis_recovery_existing_split_committed:{
        contract:'existing_split_synthesis_recovery_v0_1',
        failure_at:failure.failed_at,
      },
    },
  };
  ok(!failedSynthesisNeedsDiscovery(committed),'explicit committed split resumes once');
  ok(failedSynthesisNeedsDiscovery({
    decision_payload:{...committed.decision_payload,
      synthesis_failure:{...failure,failed_at:'2026-10-10T08:00:00Z'}},
  }),'fresh failure invalidates old routing commitment');
  ok(failedSynthesisNeedsDiscovery({
    decision_payload:{...committed.decision_payload,
      synthesis_recovery_existing_split_committed:{...committed.decision_payload.synthesis_recovery_existing_split_committed,contract:'wrong'},
    },
  }),'forged or old contract cannot bypass routing');
  return {ok:true,checks,synthetic:true,agent_state_accessed:false,
    contract:'completed_split_synthesis_recovery_regression_v0_1'};
}
