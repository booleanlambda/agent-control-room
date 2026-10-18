import test from 'node:test';
import assert from 'node:assert/strict';
import {makeForensicLedger,attachModelDecision,auditEvent,resolveModelDecision} from './decision-forensics.mjs';
import {inspectForensicsReport} from './forensics-trace-check.mjs';
const sha='e'.repeat(64);
const answer={decisionForensics:{
 choice:'Repair the malformed JSON diagnostic classification first.',
 rationale:'The independent public test reports a category mismatch for malformed output.',
 evidence:[{sourceId:'public_verifier',caseId:'malformed',
  observation:'The malformed public test still fails the declared category contract.'}],
 alternatives:[{option:'Rewrite public test expectations instead.',
  rejection:'Doing so would invalidate the independent behavioral benchmark.'}],
 expectedOutcome:'Malformed classification should improve without regressing normal replies.',
 uncertainty:'Transport privacy test remains unresolved until separately checked.'
}};
function sample(){
 const f=makeForensicLedger();
 const d=attachModelDecision(f,answer,{stage:'repair_tree_node_1',nodeId:1,requestHash:sha,responseHash:sha});
 auditEvent(f,{kind:'PROVIDER_CALL_PREPARED',stage:'repair_tree_node_1'});
 auditEvent(f,{kind:'MODEL_DECISION_RECORDED',stage:'repair_tree_node_1',decisionId:d.id});
 auditEvent(f,{kind:'PROVIDER_CALL_SETTLED',stage:'repair_tree_node_1',decisionId:d.id});
 const patch=sha;
 auditEvent(f,{kind:'VERIFICATION_SUITE_COMPLETED',stage:'verify_public',
  decisionId:d.id,candidateSha256:patch,
  verification:{verdict:'FAIL',suite:'public',casesExecuted:4,casesPassed:1}});
 resolveModelDecision(f,d.id,{outcome:'NO_PROGRESS',verified:true});
 auditEvent(f,{kind:'EXECUTION_FINISHED',stage:'execution_final'});
 return {modelCalls:[{stage:'repair_tree_node_1',status:'accepted',forensicDecisionId:d.id}],
  forensics:f,tests:[{suite:'public',candidateSha256:patch}]};
}
test('a real-style complete model decision, provider and verifier trace is valid',()=>{
 const result=inspectForensicsReport(sample());
 assert.equal(result.pass,true);
 assert.equal(result.modelDecisions,1);
 assert.equal(result.acceptedCallsJustified,1);
 assert.equal(result.decisionsWithVerifiedOutcome,1);
 assert.equal(result.publicSuites,1);
});
test('missing required model decision on accepted call fails trace audit',()=>{
 const a=sample();
 delete a.modelCalls[0].forensicDecisionId;
 const result=inspectForensicsReport(a);
 assert.equal(result.pass,false);
 assert.ok(result.issues.includes('ACCEPTED_PROVIDER_CALL_LACKS_JUSTIFICATION'));
});
test('tampering with forensic summary or event sequence produces failure',()=>{
 const a=sample();
 a.forensics.modelDecisions[0].choice='An explanation edited after its verifier result.';
 assert.equal(inspectForensicsReport(a).pass,false);
 assert.ok(inspectForensicsReport(a).issues.includes('MODEL_DECISION_HASH_MISMATCH'));
 const b=sample();b.forensics.events[2].kind='FALSIFIED_EVENT';
 assert.ok(inspectForensicsReport(b).issues.includes('FORENSIC_EVENT_CHAIN_INVALID'));
});
test('missing verifier record and interrupted call are not treated as complete proof',()=>{
 const a=sample();a.forensics.events=a.forensics.events.filter(x=>x.kind!=='VERIFICATION_SUITE_COMPLETED');
 assert.ok(inspectForensicsReport(a).issues.includes('VERIFIER_SUITE_MISSING_AUDIT'));
 assert.equal(inspectForensicsReport({modelCalls:[]}).pass,false);
});
