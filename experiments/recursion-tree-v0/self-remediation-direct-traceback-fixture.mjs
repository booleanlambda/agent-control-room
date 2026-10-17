// Unpaid V3-crash -> direct repair -> self-test integration with actual Docker.
// Every invocation uses the same production-path experimental V2 runner.
// Sources are fetched immutably from prior LIVE GH Actions artifacts.
import {mkdtempSync,copyFileSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(fileURLToPath(new URL('.',import.meta.url)));
const original=join(root,'unseen-python-kimi-report.json');
const priorV3=join(root,'prior-v3','self-remediation-v2-checkpoint.json');
assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.AAU_NO_PROVIDER_NETWORK,'yes');
assert.equal(process.env.AAU_PYTHON_SANDBOX,'yes');
assert.ok(!process.env.MOONSHOT_API_KEY);
assert.ok(!process.env.AAU_REMEDIATION_V2_AUTHORIZED);
assert.ok(existsSync(original)&&existsSync(priorV3),
  'Both original Kimi and V3 live-failure artifacts required');
const dir=mkdtempSync(join(tmpdir(),'aau-direct-live-failure-fixture-'));
function run(action,extra={}){
 const x=spawnSync(process.execPath,
  [join(root,'self-remediation-kimi-v2.mjs'),action],{
   cwd:dir,encoding:'utf8',timeout:80000,maxBuffer:200000,
   env:{PATH:process.env.PATH,HOME:process.env.HOME,
    GITHUB_ACTIONS:'true',AAU_PYTHON_SANDBOX:'yes',AAU_NO_PROVIDER_NETWORK:'yes',
    AAU_REMEDIATION_V2_FIXTURE:'success',MOONSHOT_API_KEY:'',
    AAU_REMEDIATION_V2_AUTHORIZED:'',...extra}});
 if(x.error)throw x.error;
 if(x.status!==0)throw Error(action+' failed: '+x.status+
   ' stdout='+String(x.stdout).slice(-600)+' stderr='+String(x.stderr).slice(-600));
 return String(x.stdout);
}
const cp=()=>JSON.parse(readFileSync(join(dir,'self-remediation-v2-checkpoint.json'),'utf8'));
try{
 copyFileSync(original,join(dir,'unseen-python-kimi-report.json'));
 // Seed with relative path under test working directory.
 const fs=await import('node:fs');
 fs.mkdirSync(join(dir,'prior-v3'),{recursive:true});
 copyFileSync(priorV3,join(dir,'prior-v3/self-remediation-v2-checkpoint.json'));
 run('seed',{AAU_REPAIR_START_WITH_V3:'yes'});
 let c=cp();
 assert.equal(c.phase,'repair');
 assert.equal(c.status,'ready');
 assert.equal(c.seedProvenance.mode,'direct_repair_with_real_stderr');
 assert.equal(c.seedProvenance.actualPublicCrashReproduced,true);
 assert.match(c.feedback,/Traceback/);
 assert.equal(c.callsAttempted,0);
 run('cycle');
 c=cp();
 assert.equal(c.phase,'tests');
 assert.equal(c.phaseHistory[0].phase,'repair');
 assert.equal(c.phaseHistory[0].publicPassed,true);
 run('cycle');
 c=cp();
 assert.equal(c.status,'passed');
 assert.deepEqual(c.phaseHistory.map(x=>x.phase),['repair','tests']);
 assert.equal(c.callsAttempted,2);
 assert.equal(c.lastAssessment.public.pass,true);
 assert.equal(c.lastAssessment.hiddenChecks.length,6);
 assert.ok(c.lastAssessment.hiddenChecks.every(x=>x.pass));
 assert.ok(Object.values(c.lastAssessment.tests).every(Boolean));
 run('finish');
 const report=JSON.parse(readFileSync(join(dir,'self-remediation-v2-report.json'),'utf8'));
 assert.equal(report.simulation,true);
 assert.equal(report.newBillableAttempts,0);
 assert.equal(report.providerReportedTokens,0);
 assert.equal(report.success,true);
 console.log('DIRECT_TRACEBACK_FIXTURE_RESULT='+JSON.stringify({
  success:true,provenance:'actual_Kimi_V3_model_written_failing_code',
  realLiveModelCalls:0,syntheticReplies:2,realDockerExecutions:true,
  sourceCrashReproduced:true,actualStderrSentToFixture:true,
  publicOptimalWitness:true,allSixSealedVariantsPassed:true,
  propertyChecksPassed:true}));
}finally{rmSync(dir,{force:true,recursive:true})}
