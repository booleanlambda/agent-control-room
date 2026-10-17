// No-model-call adversarial audit of the exact self-test source Kimi authored
// in live V6 run 39039858401. Tests verifier behavior across 7 instances.
// The submitted test and solver are executed in actual networkless Docker.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {TASKS,oracle,check,grade} from './unseen-python-benchmarks.mjs';
import {runIsolatedPython} from './unseen-python-sandbox.mjs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_PYTHON_SANDBOX!=='yes'||
 process.env.MOONSHOT_API_KEY||process.env.AAU_REMEDIATION_V2_AUTHORIZED)
 throw Error('NO_COST_NO_CREDENTIALS_DISPOSABLE_CI_ONLY');
const task=TASKS.find(t=>t.id==='assignment');
const report=JSON.parse(readFileSync('prior-v6/self-remediation-v2-report.json','utf8'));
const sha=x=>createHash('sha256').update(x).digest('hex');
const frozen='732f54bc7b428ef7d670c721c669060b2d0cf1741a339bdc0d33120862d5042b';
const testHash='b2d20d0f86c13a4b3b8aa6d109e25475bf3fd6708cb23de3bd79f6726ecf4e54';
assert.equal(report.model,'kimi-k2.6');
assert.equal(report.status,'passed');
assert.equal(report.simulation,false);
assert.equal(report.seedProvenance?.mode,'TESTS_ONLY_FROZEN_VERIFIED_KIMI_SOLVER');
assert.equal(report.providerReportedTokens,3071);
assert.equal(report.newBillableAttempts,1);
assert.equal(report.frozenSolverIntegrity,true);
assert.equal(sha(report.latestCode),frozen);
assert.equal(sha(report.modelWrittenTests),testHash);
const solver=report.latestCode,tests=report.modelWrittenTests;
const publicInput=task.public;
const variations=[
 {name:'public',input:publicInput},
 {name:'held_out',input:task.hidden},
 {name:'cost_shift',input:(()=>{let p=structuredClone(publicInput);p.costs[2]=[9,13,6];p.costs[5]=[8,10,5];return p})()},
 {name:'activation_shift',input:(()=>{let p=structuredClone(publicInput);p.activation=[12,7,9];return p})()},
 {name:'zero_switch_penalty',input:(()=>{let p=structuredClone(publicInput);p.switchPenalty=0;return p})()},
 {name:'shift_capacity',input:(()=>{let p=structuredClone(publicInput);p.capacities=[10,9,9];return p})()},
 {name:'reordered_jobs',input:(()=>{let p=structuredClone(publicInput);p.sizes.reverse();p.costs.reverse();p.allowed.reverse();return p})()},
];
function findFeasibleWorse(p){
 const best=oracle('assignment',p).cost,n=p.sizes.length;
 for(let i=0;i<3**n;i++){
  let v=i,assignment=[];
  for(let j=0;j<n;j++){assignment.push(v%3);v=Math.floor(v/3)}
  const c=check('assignment',p,{assignment});
  if(c.ok&&c.cost>best)return {cost:c.cost,assignment};
 }
 throw Error('NO_SUBOPTIMAL_FEASIBLE_CASE_FOUND');
}
async function evaluateTest(input,output){
 const r=await runIsolatedPython(tests,{input,output});
 if(!r.ok||typeof r.result?.passed!=='boolean')
  throw Error('KIMI_VERIFIER_NOT_EXECUTABLE '+JSON.stringify(r));
 return r.result.passed;
}
const observations=[];
for(const {name,input} of variations){
 const output=await runIsolatedPython(solver,input);
 assert.equal(output.ok,true,name+' solver did not run');
 assert.equal(grade('assignment',input,output.result).passed,true,name+' solver not optimal');
 const cases={
  exactCorrect:output.result,
  tamperedCost:{...output.result,cost:output.result.cost+1},
  invalidAllMachine2:{cost:output.result.cost,assignment:Array(input.sizes.length).fill(2)},
  validButSuboptimal:findFeasibleWorse(input),
 };
 const results={};
 for(const [label,candidate] of Object.entries(cases)){
  const accepted=await evaluateTest(input,candidate);
  const expected=label==='exactCorrect';
  assert.equal(accepted,expected,name+'/'+label+' wrong verdict');
  results[label]=accepted;
 }
 observations.push({name,solverCost:output.result.cost,results});
 console.log('KIMI_TEST_ONLY_GENERALIZATION_CASE='+JSON.stringify(observations.at(-1)));
}
writeFileSync('test-only-kimi-adversarial-audit.json',JSON.stringify({
 model:'kimi-k2.6',liveSourceRun:39039858401,
 genuineLLMCallsThisAudit:0,
 oracleIndependent:true,
 solverFrozenHash:frozen,
 modelWrittenTestHash:testHash,
 caseCount:observations.length,checksPerCase:4,
 passedChecks:observations.length*4,
 observations},null,2));
console.log('KIMI_TEST_ONLY_GENERALIZATION_RESULT='+JSON.stringify({
 verified:true,cases:observations.length,checks:observations.length*4,
 genuineLLMCalls:0,verifiedSolverUnchanged:true}));
