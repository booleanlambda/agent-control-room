import test from 'node:test';
import assert from 'node:assert/strict';
import {assessDiagnosticStrategy,REQUIREMENTS} from './diagnostic-acceptance.mjs';
const sufficient={
 diagnosis:{
  cause:'Broad catch masks errors and overwrites the prior provider diagnostic',
  accounting:'Preserve provider token usage and finish_reason before manual hold'
 },
 remediation:{
  malformed:{scenario:'Malformed JSON parsing fails',action:'Classify invalid JSON separately and hold'},
  provider:{scenario:'HTTP 503 error from provider',action:'Record provider HTTP status and error'},
  transport:{scenario:'Network timeout abort',action:'Record transport failure and manual hold'},
  budget:{scenario:'finish_reason length due to thinking token budget',action:'Classify exhaustion vs normal JSON failure'},
  ledger:{scenario:'database journal write ambiguous',action:'Prevent duplicate DB writes and retain uncertain ledger state'},
  replay:{scenario:'uncertain API request retry',action:'Never replay an uncertain paid request; manual hold'}
 },
 testableRequirements:[
  {case:'Mock HTTP server error',expected:'provider failure recorded'},
  {case:'Test malformed JSON',expected:'manual hold'},
  {case:'Verify network timeout',expected:'no duplicate paid request'},
  {case:'Test persisted ledger ambiguous state',expected:'no additional journal write'}
 ]
};
test('complete independent requirements are recognized, regardless of output field nesting',()=>{
 const x=assessDiagnosticStrategy(sufficient);
 assert.equal(x.verdict,'REQUIREMENTS_COVERED');
 assert.equal(x.requiredCount,9);
 assert.equal(x.metCount,9);
 assert.equal(x.criterionResults.every(y=>y.met),true);
});
test('parseable JSON with no meaningful response is not accepted',()=>{
 const x=assessDiagnosticStrategy({result:{foo:1},other:{bar:3}});
 assert.equal(x.verdict,'RESPONSE_SHAPE_INSUFFICIENT');
 assert.equal(x.metCount,0);
});
test('passable JSON schema with missing error handling cannot pass',()=>{
 const x=assessDiagnosticStrategy({diagnosis:sufficient.diagnosis,remediation:{
  malformed:sufficient.remediation.malformed
 },testableRequirements:sufficient.testableRequirements});
 assert.equal(x.verdict,'REQUIREMENTS_NOT_COVERED');
 assert.ok(x.metCount<9);
 const missing=x.criterionResults.filter(z=>!z.met).map(z=>z.id);
 assert.ok(missing.includes('http_rejection'));
 assert.ok(missing.includes('durable_ledger_ambiguity'));
});
test('keywords in separated unrelated branches do not satisfy full criterion',()=>{
 const a={
  header:'Broad catch problem and generic metadata repair',
  unrelated:'HTTP service',
  commentary:'Record a failed task without any error classification',
  examples:'A timeout is expected in some other application',
  disclaimer:'Do not replay arbitrary strings; never invent JSON',
  tests:[{case:'Test generic output',expected:'one result'}]
 };
 const x=assessDiagnosticStrategy(a);
 assert.equal(x.verdict,'REQUIREMENTS_NOT_COVERED');
 assert.ok(x.metCount<9);
});
test('only fixed status fields are returned, no model diagnosis or secrets',()=>{
 const a=structuredClone(sufficient);
 a.diagnosis.private='PRIVATE_CANARY_TEST_SECRET';
 const x=assessDiagnosticStrategy(a);
 assert.equal(JSON.stringify(x).includes('PRIVATE_CANARY'),false);
 assert.equal(JSON.stringify(x).includes('Broad catch'),false);
 assert.deepEqual(x.criterionResults.map(y=>Object.keys(y)),Array.from({length:9},()=>['id','met']));
});
test('not mistaken for executable proof even when requirements are covered',()=>{
 const x=assessDiagnosticStrategy(sufficient);
 assert.equal(x.verdict,'REQUIREMENTS_COVERED');
 assert.ok(x.limitations[0].includes('not substantive correctness'));
 assert.equal(Object.hasOwn(x,'softwareFixVerified'),false);
 assert.deepEqual(x.criterionResults.map(y=>y.id),REQUIREMENTS.map(y=>y.id));
});
