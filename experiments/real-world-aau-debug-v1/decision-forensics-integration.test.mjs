import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const runner=readFileSync(new URL('./live.mjs',import.meta.url),'utf8');
test('every Kimi call requires a model-owned decision record before accepted status',()=>{
 assert.match(runner,/MODEL_FORENSICS_INSTRUCTIONS/);
 const attached=runner.indexOf('const reason=attachModelDecision(');
 const accepted=runner.indexOf("receipt.status='accepted';",attached);
 assert.ok(attached>0&&accepted>attached);
 assert.match(runner,/receipt\.status='model_decision_forensics_invalid'/);
 assert.match(runner,/throw Error\('MODEL_DECISION_FORENSICS_MISSING'\)/);
 assert.match(runner,/if\(e\?\.message==='THINKING_BUDGET_EXHAUSTED'\|\|/);
});
test('model assertions linked to independently observed outcomes and every rejected patch',()=>{
 assert.match(runner,/resolveModelDecision\(report\.forensics,patchDecisionId/);
 assert.match(runner,/kind:verdict\.accept\?'NODE_PATCH_ACCEPTED':'NODE_PATCH_REJECTED'/);
 assert.match(runner,/kind:'MODEL_PATCH_VALIDATION_REJECTED'/);
 assert.match(runner,/kind:added\.added>0\?'CHILD_NODES_QUEUED':'CHILD_DECOMPOSITION_REJECTED'/);
 assert.match(runner,/kind:verdict\.accept\?'THINKING_ON_PATCH_ACCEPTED':'THINKING_ON_PATCH_REJECTED'/);
});
test('runtime reports individual cases, compute blocks and entire provider lifecycle',()=>{
 for(const label of [
 'BUDGET_BLOCKED','PROVIDER_CALL_PREPARED','PROVIDER_CALL_SETTLED',
 'MODEL_DECISION_RECORDED','CASE_TEST_PASSED','CASE_TEST_FAILED',
 'VERIFICATION_SUITE_COMPLETED','REPAIR_NODE_SELECTED','EXECUTION_BLOCKED',
 'EXECUTION_FINISHED']){
  assert.ok(runner.includes(label),label);
 }
});
test('do not serialize original model-authored task prose into legacy decision list',()=>{
 assert.match(runner,/tasks:summarizePlan\(plan\)/);
 assert.match(runner,/report\.modelOwnedEarlyTasks=summarizePlan\(rootTasks\)/);
 assert.doesNotMatch(runner,/report\.decisions\.push\(\{phase:'plan',tasks:plan\}/);
});
