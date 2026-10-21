import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCanonicalSemanticCandidate,verifySemanticConsistency}
  from './semantic-consistency-gate.js';

function fixture(){
  let balance=1000;
  const net=[10,20,-50,-50,-50,-50,-50,-50,-50,-50,-50,-50];
  const rows=net.map((v,i)=>({month:i+1,net_burn:v,ending_cash_balance:balance-=v}));
  const source_manifest=[
    {path:'R.002.003.002.001',result_hash:'synthetic-net'},
    {path:'R.002.003.002.002',result_hash:'synthetic-cash'}
  ];
  return {openingCash:1000,verifiedProjection:{
    status:'PROJECTION_READY',artifact:{calculation:rows,source_manifest}}};
}
const prepared=()=>{
  const f=fixture();
  return {f,c:makeCanonicalSemanticCandidate({
    projection:f.verifiedProjection,openingCash:f.openingCash})};
};
const verify=(f,c)=>verifySemanticConsistency({...f,parentCandidate:c});
test('canonical evidence-bound numeric semantic claims PASS without completing parent',()=>{
  const {f,c}=prepared(),r=verify(f,c);
  assert.equal(r.status,'PASS');assert.equal(r.model_calls,0);
  assert.equal(r.live_node_completed,false);assert(r.remaining_obligations.length>0);
});
test('incorrect closing cash is semantic mismatch',()=>{
  const {f,c}=prepared();c.semantic_claims[0].value+=20;
  assert.equal(verify(f,c).status,'SEMANTIC_MISMATCH');
});
test('wrong direction versus opening is semantic mismatch',()=>{
  const {f,c}=prepared();c.semantic_claims.find(x=>x.id==='cash_change_from_opening').value='decrease';
  assert.equal(verify(f,c).status,'SEMANTIC_MISMATCH');
});
test('wrong month-to-month cash monotonicity is semantic mismatch',()=>{
  const {f,c}=prepared();c.semantic_claims.find(x=>x.id==='cash_monotonicity').value='increasing';
  assert.equal(verify(f,c).status,'SEMANTIC_MISMATCH');
});
test('false explicit claim cash fell by month 12 is caught',()=>{
  const {f,c}=prepared();c.interpretation='Ending cash balance declined by month 12.';
  assert.equal(verify(f,c).status,'SEMANTIC_MISMATCH');
});
test('false explicit claim that cash rose every month is caught',()=>{
  const {f,c}=prepared();c.interpretation='Cash balance increased every month.';
  assert.equal(verify(f,c).status,'SEMANTIC_MISMATCH');
});
test('negated assertion does not become false positive',()=>{
  const {f,c}=prepared();c.interpretation='Ending cash balance did not decline by month 12.';
  assert.equal(verify(f,c).status,'UNRESOLVED');
});
test('free-form prose is unresolved not falsely passed',()=>{
  const {f,c}=prepared();c.interpretation='Cash improves over time.';
  assert.equal(verify(f,c).status,'UNRESOLVED');
});
test('omitted required semantic claim blocks pass',()=>{
  const {f,c}=prepared();c.semantic_claims.pop();
  assert.equal(verify(f,c).status,'UNRESOLVED');
});
test('unknown claim is unresolved not silently ignored',()=>{
  const {f,c}=prepared();c.semantic_claims.push({id:'bankruptcy_impossible',value:true});
  assert.equal(verify(f,c).status,'UNRESOLVED');
});
test('duplicated claim blocks pass',()=>{
  const {f,c}=prepared();c.semantic_claims.push({...c.semantic_claims[0]});
  assert.equal(verify(f,c).status,'UNRESOLVED');
});
test('forged source result hash blocks pass',()=>{
  const {f,c}=prepared();c.source_manifest[0].result_hash='forgery';
  assert.equal(verify(f,c).status,'UNRESOLVED');
});
test('missing source manifest blocks pass',()=>{
  const {f,c}=prepared();delete c.source_manifest;
  assert.equal(verify(f,c).status,'UNRESOLVED');
});
test('duplicated source path cannot spoof two authoritative sources',()=>{
  const {f,c}=prepared();c.source_manifest[1]={...c.source_manifest[0]};
  assert.equal(verify(f,c).status,'UNRESOLVED');
});
test('numeric basis with omitted month is unresolved',()=>{
  const {f,c}=prepared();f.verifiedProjection.artifact.calculation.pop();
  assert.equal(verify(f,c).status,'UNRESOLVED');
});
test('numeric basis inconsistent with cash equation is unresolved',()=>{
  const {f,c}=prepared();f.verifiedProjection.artifact.calculation[5].ending_cash_balance+=100;
  assert.equal(verify(f,c).status,'UNRESOLVED');
});
test('unreviewed self-audit claims cannot silently pass',()=>{
  const {f,c}=prepared();c.self_audit={verdict:'Everything proven correct'};
  const r=verify(f,c);
  assert.equal(r.status,'UNRESOLVED');assert.equal(r.reason,'UNREVIEWED_SEMANTIC_FIELDS');
});
test('extra unsupported narrative does not pass',()=>{
  const {f,c}=prepared();c.sanity_check+=' The business is guaranteed solvent.';
  assert.equal(verify(f,c).status,'UNRESOLVED');
});
test('no parent candidate cannot PASS',()=>{
  assert.equal(verifySemanticConsistency(fixture()).status,'UNRESOLVED');
});
test('wrong final net burn claim is a mismatch',()=>{
  const {f,c}=prepared();c.semantic_claims.find(x=>x.id==='net_burn_at_month_12').value=0;
  assert.equal(verify(f,c).status,'SEMANTIC_MISMATCH');
});
test('real Silas numerical series yields mixed trajectory and closing cash > opening',()=>{
  const f=fixture(),net=[
    43409.2,14953.598,-13979.48793,-43373.34585245,
    -73211.8487466963,-103479.434040562,-134161.08389,
    -165233.12586205,-196700.2573748783,-228539.4683667575,
    -260737.736967567,-293282.4961732626
  ];
  f.openingCash=5200000;let balance=f.openingCash;
  f.verifiedProjection.artifact.calculation=net.map((burn,i)=>({
    month:i+1,net_burn:burn,ending_cash_balance:balance-=burn
  }));
  const c=makeCanonicalSemanticCandidate({
    projection:f.verifiedProjection,openingCash:f.openingCash});
  assert(c.interpretation.includes('6654335.49'));
  assert(c.interpretation.includes('mixed'));
  assert.equal(verify(f,c).status,'PASS');
  c.interpretation='Ending cash balance decreased by month 12.';
  assert.equal(verify(f,c).status,'SEMANTIC_MISMATCH');
});
