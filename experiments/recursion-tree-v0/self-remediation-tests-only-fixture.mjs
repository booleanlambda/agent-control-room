// No-cost replay of the actual Kimi V5 model-written solver and faulty tests.
// Fixture messages are explicitly SYNTHETIC, but all submitted Python and
// independent evaluation paths are identical to the later real test.
import assert from 'node:assert/strict';
import {mkdtempSync,copyFileSync,existsSync,readFileSync,mkdirSync,rmSync}
 from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('.',import.meta.url)));
assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.AAU_PYTHON_SANDBOX,'yes');
assert.equal(process.env.AAU_NO_PROVIDER_NETWORK,'yes');
assert.ok(!process.env.MOONSHOT_API_KEY);
const fixture='test_only_repair';
const original=join(root,'unseen-python-kimi-report.json');
const prior=join(root,'prior-v5','self-remediation-v2-checkpoint.json');
assert.ok(existsSync(original)&&existsSync(prior),
 'must use original + Kimi V5 immutable GitHub Action artifacts');
const tmp=mkdtempSync(join(tmpdir(),'aau-tests-only-'));
const checkpoint=()=>JSON.parse(readFileSync(join(tmp,'self-remediation-v2-checkpoint.json')));
function run(stage){
 const r=spawnSync(process.execPath,
  [join(root,'self-remediation-kimi-v2.mjs'),stage],
  {cwd:tmp,encoding:'utf8',timeout:90000,
   env:{PATH:process.env.PATH,HOME:process.env.HOME,
    GITHUB_ACTIONS:'true',AAU_PYTHON_SANDBOX:'yes',
    AAU_NO_PROVIDER_NETWORK:'yes',
    AAU_REMEDIATION_V2_FIXTURE:fixture,
    AAU_TESTS_ONLY_FROM_V5:'yes',
    AAU_REMEDIATION_V2_AUTHORIZED:'',MOONSHOT_API_KEY:''}});
 if(r.error)throw r.error;
 if(r.status!==0)throw Error(stage+' status '+r.status+
  ' stderr '+String(r.stderr).slice(-1100)+
  ' stdout '+String(r.stdout).slice(-1100));
 return r.stdout;
}
try{
 copyFileSync(original,join(tmp,'unseen-python-kimi-report.json'));
 mkdirSync(join(tmp,'prior-v5'));
 copyFileSync(prior,join(tmp,'prior-v5','self-remediation-v2-checkpoint.json'));
 run('seed');
 let c=checkpoint();
 assert.equal(c.status,'ready');
 assert.equal(c.phase,'tests');
 assert.equal(c.callsAttempted,0);
 assert.equal(c.maxCalls,3);
 assert.equal(c.seedProvenance.mode,'TESTS_ONLY_FROZEN_VERIFIED_KIMI_SOLVER');
 const frozen=c.seedProvenance.sourceHash;
 assert.equal(c.lastAssessment.public.pass,true);
 assert.equal(c.lastAssessment.tests.acceptsCorrect,false);
 assert.equal(c.lastAssessment.tests.rejectsOld,true);
 assert.equal(c.lastAssessment.tests.rejectsCostTamper,true);
 assert.ok(c.lastAssessment.hiddenChecks.every(x=>x.pass));
 run('cycle');
 c=checkpoint();
 assert.equal(c.status,'ready');
 assert.equal(c.phase,'tests');
 assert.equal(c.callsAttempted,1);
 assert.equal(c.phaseHistory.at(-1).phase,'tests');
 assert.equal(c.lastAssessment.tests.acceptsCorrect,true);
 assert.equal(c.lastAssessment.tests.rejectsOld,false);
 assert.equal(c.lastAssessment.tests.rejectsCostTamper,false);
 assert.equal(c.seedProvenance.sourceHash,frozen);
 run('cycle');
 c=checkpoint();
 assert.equal(c.status,'passed');
 assert.equal(c.phase,'done');
 assert.equal(c.callsAttempted,2);
 assert.equal(c.seedProvenance.sourceHash,frozen);
 assert.equal(c.lastAssessment.public.pass,true);
 assert.ok(c.lastAssessment.hiddenChecks.every(x=>x.pass));
 assert.ok(Object.values(c.lastAssessment.tests).every(Boolean));
 run('finish');
 const report=JSON.parse(readFileSync(join(tmp,'self-remediation-v2-report.json')));
 assert.equal(report.simulation,true);
 assert.equal(report.providerReportedTokens,0);
 assert.equal(report.newBillableAttempts,0);
 assert.equal(report.frozenSolverIntegrity,true);
 console.log('KIMI_TESTS_ONLY_FIXTURE='+JSON.stringify({
  outcome:'PASS',realLLMCalls:0,fixtureResponses:2,
  frozenSolverHash:frozen,failedHistoricalTestReproduced:true,
  firstReplacementTestRejected:true,secondReplacementTestPassed:true,
  noSolverCodeChanges:true,
  publicExactAndFeasible:true,sixHiddenCasesPassed:true,
  correctedTestsAcceptGoodRejectOldAndTamper:true}));
}finally{rmSync(tmp,{recursive:true,force:true})}
