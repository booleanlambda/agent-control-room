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

test('Kimi patch stages must receive explicit same-level forensic output contract',()=>{
 assert.match(runner,/const mandatoryDecisionOutput=/);
 assert.match(runner,/requiredKey:'decisionForensics'/);
 assert.match(runner,/allDecisionsMustBeExplained:true/);
 assert.match(runner,/content:JSON\.stringify\(\{\s*\.\.\.payload,mandatoryDecisionOutput\s*\}\)/);
 assert.ok(runner.indexOf('mandatoryDecisionOutput')<runner.indexOf('const reservation=budgetReservation'));
});
test('model-owned code patch can coexist with top-level forensic explanation',async()=>{
 const {validateModelDecision}=await import('./decision-forensics.mjs');
 const {normalizeModelOwnedPatches}=await import('./output-normalizer.mjs');
 const a={replacements:[{old:'const before=undefined;','replacement':'const before=null;'}],
  diagnosis:'Preserve original source while fixing one local bug.',
  decisionForensics:{
   choice:'Fix the known malformed response classification.',
   rationale:'The public test reports an incorrect status while the normal response passes.',
   evidence:[{sourceId:'public_verifier',caseId:'malformed',
    observation:'The malformed public test reports the wrong diagnostic category.'}],
   alternatives:[{option:'Change the public test expected category.',
    rejection:'That would defeat the existing independent acceptance contract.'}],
   expectedOutcome:'The repaired candidate should pass the malformed JSON public case.',
   uncertainty:'HTTP provider rejection and timeout still require independent verification.'
  }};
 assert.equal(validateModelDecision(a).ok,true);
 assert.equal(normalizeModelOwnedPatches(a).length,1);
});
