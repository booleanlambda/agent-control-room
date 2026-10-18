import test from 'node:test';
import assert from 'node:assert/strict';
import {MODEL_FORENSICS_INSTRUCTIONS,validateModelDecision,makeForensicLedger,
 attachModelDecision,auditEvent,resolveModelDecision,FORENSICS_SCHEMA} from './decision-forensics.mjs';
const hash='a'.repeat(64);
const good={
 decisionForensics:{
  choice:'Repair the malformed response category before addressing transport errors.',
  rationale:'The public verifier reports an incorrect category for the malformed case.',
  evidence:[{sourceId:'public_verifier',caseId:'malformed',
   observation:'The public malformed case expected malformed_model_json but observed bad_model_json.'}],
  alternatives:[{option:'Change the independent verifier status assertion.',
   rejection:'That would weaken the acceptance contract instead of fixing model code.'}],
  expectedOutcome:'The malformed public test should pass without affecting received behavior.',
  uncertainty:'The timeout path has not yet been tested after this focused change.'
 }};
test('mandatory explicit model justification with evidence, rejected alternative, prediction and uncertainty',()=>{
 assert.equal(validateModelDecision(good).ok,true);
 assert.match(MODEL_FORENSICS_INSTRUCTIONS,/not private chain of thought/);
 assert.equal(validateModelDecision({}).reason,'MISSING_MODEL_DECISION_FORENSICS');
 for(const k of ['choice','rationale','expectedOutcome','uncertainty']){
  const x=structuredClone(good);delete x.decisionForensics[k];
  assert.equal(validateModelDecision(x).ok,false);
 }
});
test('rejects unsafe text, URLs, raw secrets and hidden case identifiers without retaining them',()=>{
 for(const [field,value] of [
  ['rationale','Bearer secret_passwordvalue34567890123'],
  ['choice','Our best approach is https://secret.example.com/privkey'],
  ['expectedOutcome','The api_key=ABCDEF leakage goes away'],
  ['uncertainty','PRIVATE_CANARY may appear in the exception']
 ]){
  const x=structuredClone(good);x.decisionForensics[field]=value;
  assert.equal(validateModelDecision(x).ok,false,field);
 }
 const y=structuredClone(good);y.decisionForensics.evidence[0].caseId='nested_undici';
 assert.equal(validateModelDecision(y).reason,'INVALID_MODEL_FORENSIC_EVIDENCE');
});
test('missing alternative or evidence reference is a hard forensic rejection',()=>{
 const noAlternative=structuredClone(good);
 noAlternative.decisionForensics.alternatives=[];
 assert.equal(validateModelDecision(noAlternative).reason,'MISSING_MODEL_FORENSIC_ALTERNATIVE');
 const badEvidence=structuredClone(good);
 badEvidence.decisionForensics.evidence=[{sourceId:'hidden_oracle',observation:'I saw the hidden case'}];
 assert.equal(validateModelDecision(badEvidence).reason,'INVALID_MODEL_FORENSIC_EVIDENCE');
});
test('model choice is preserved as a claim, runtime outcome is independent and linkable',()=>{
 const ledger=makeForensicLedger();
 const add=attachModelDecision(ledger,good,{stage:'repair_tree_node_3',nodeId:3,parentId:1,
  requestHash:hash,responseHash:hash});
 assert.deepEqual(add,{ok:true,id:'decision_1'});
 assert.equal(ledger.schema,FORENSICS_SCHEMA);
 assert.equal(ledger.modelDecisions[0].independentlyVerified,false);
 assert.match(ledger.modelDecisions[0].modelClaimSha256,/^[a-f0-9]{64}$/);
 auditEvent(ledger,{kind:'PROVIDER_RESPONSE_ACCEPTED',stage:'repair_tree_node_3',
  decisionId:add.id,nodeId:3,parentId:1,budget:4512});
 auditEvent(ledger,{kind:'PUBLIC_VERIFIER_REJECTED_PATCH',stage:'repair_tree_node_3',
  decisionId:add.id,nodeId:3,verification:{verdict:'NO_PROGRESS',
   suite:'public',casesExecuted:4,casesPassed:1}});
 assert.equal(resolveModelDecision(ledger,add.id,{outcome:'NO_PROGRESS',verified:true}),true);
 assert.equal(ledger.modelDecisions[0].outcome,'NO_PROGRESS');
 assert.equal(ledger.modelDecisions[0].independentlyVerified,true);
 assert.equal(ledger.events[0].modelClaimSha256,ledger.modelDecisions[0].modelClaimSha256);
 assert.equal(ledger.events[1].modelClaimSha256,ledger.modelDecisions[0].modelClaimSha256);
 assert.equal(ledger.events.length,2);
 assert.equal(ledger.events[1].seq,2);
});
test('runtime trace events whitelist fields and never serialize raw user/model data',()=>{
 const ledger=makeForensicLedger();
 auditEvent(ledger,{kind:'PUBLIC_TEST_COMPLETED',stage:'verify_public',
  candidateSha256:hash,
  extraRawProviderContent:'PRIVATE_CANARY PASSWORD',
  verification:{verdict:'FAIL',suite:'public',casesExecuted:4,casesPassed:1,
   privateException:'Bearer never store'}});
 const emitted=JSON.stringify(ledger);
 assert.equal(emitted.includes('PRIVATE_CANARY'),false);
 assert.equal(emitted.includes('Bearer'),false);
 assert.equal(emitted.includes(hash),true);
 assert.throws(()=>auditEvent(ledger,{kind:'Bearer SECRET',stage:'verify_public'}),/INVALID_FORENSIC_EVENT/);
});
test('invalid/missing decision does not enter forensic ledger',()=>{
 const ledger=makeForensicLedger();
 const r=attachModelDecision(ledger,{decisionForensics:{choice:'none'}},{
  stage:'repair_tree_node_2',requestHash:hash,responseHash:hash});
 assert.equal(r.ok,false);
 assert.equal(ledger.modelDecisions.length,0);
});

test('event hash links are independently recomputable; tampering with a prior event breaks chain',async()=>{
 const {createHash}=await import('node:crypto');
 const ledger=makeForensicLedger();
 const a=auditEvent(ledger,{kind:'REPAIR_NODE_SELECTED',stage:'repair_tree_node_7',nodeId:7});
 const b=auditEvent(ledger,{kind:'NODE_PATCH_REJECTED',stage:'repair_tree_node_7',nodeId:7});
 assert.equal(a.prevHash,'GENESIS');
 assert.equal(b.prevHash,a.hash);
 const verify=ev=>createHash('sha256').update(JSON.stringify(
  Object.fromEntries(Object.entries(ev).filter(([k])=>k!=='hash')))).digest('hex')===ev.hash;
 assert.equal(verify(a),true);assert.equal(verify(b),true);
 a.nodeId=8;assert.equal(verify(a),false);
});
test('forensic source text must not quote hidden oracle cases',()=>{
 const hidden=structuredClone(good);
 hidden.decisionForensics.evidence[0].caseId='off_length';
 assert.equal(validateModelDecision(hidden).ok,false);
});
