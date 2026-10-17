// End-to-end disposable CI orchestrator. Every cycle is a fresh Node OS
// process and uses the EXACT V2 runner, not a duplicate implementation.
// Synthetic messages exercise live response contracts without provider calls.
import assert from 'node:assert/strict';
import {copyFileSync,existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync}
 from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('.',import.meta.url)));
const script=join(root,'self-remediation-kimi-v2.mjs');
const original=join(root,'unseen-python-kimi-report.json');
if(process.env.GITHUB_ACTIONS!=='true'||
   process.env.AAU_PYTHON_SANDBOX!=='yes'||
   process.env.MOONSHOT_API_KEY||
   process.env.AAU_REMEDIATION_V2_AUTHORIZED==='yes'||
   process.env.AAU_NO_PROVIDER_NETWORK!=='yes')
 throw Error('NO_CREDENTIALS_IN_DISPOSABLE_CI_REQUIRED');
assert.ok(existsSync(original),'real prior Kimi failed artifact must be downloaded');
const scenarios=[];
const scratch=mkdtempSync(join(tmpdir(),'aau-remediation-fixture-'));
const scenarioNames=['success','journal_replay','test_repair','bad_witness',
 'weak_tests','truncated','transport_unknown','inflight_stop','budget_ceiling'];
function cp(dir){
 return JSON.parse(readFileSync(join(dir,'self-remediation-v2-checkpoint.json'),'utf8'));
}
function run(dir,mode,scenario,extraEnv={},mustPass=true){
 const env={
  PATH:process.env.PATH,
  HOME:process.env.HOME,
  GITHUB_ACTIONS:'true',AAU_PYTHON_SANDBOX:'yes',
  AAU_NO_PROVIDER_NETWORK:'yes',
  AAU_REMEDIATION_V2_FIXTURE:scenario==='journal_replay'?'success':
   ['inflight_stop','budget_ceiling'].includes(scenario)?'success':scenario,
  MOONSHOT_API_KEY:'',
  AAU_REMEDIATION_V2_AUTHORIZED:'',
  ...extraEnv
 };
 const x=spawnSync(process.execPath,[script,mode],{cwd:dir,env,
   encoding:'utf8',timeout:70000,maxBuffer:140000});
 if(x.error)throw x.error;
 if(mustPass&&x.status!==0)throw Error(mode+' '+scenario+' exited '+
  x.status+' stdout='+String(x.stdout).slice(-900)+
  ' stderr='+String(x.stderr).slice(-900));
 if(!mustPass&&x.status===0)throw Error('expected refusal '+mode+' '+scenario);
 return {code:x.status,stdout:String(x.stdout||''),stderr:String(x.stderr||'')};
}
try{
 for(const name of scenarioNames){
  const dir=mkdtempSync(join(scratch,name+'-'));
  copyFileSync(original,join(dir,'unseen-python-kimi-report.json'));
  run(dir,'seed',name);
  const initial=cp(dir);
  assert.equal(initial.status,'ready');
  assert.equal(initial.phase,'diagnose');
  assert.equal(initial.originalBadOutput.cost,90);
  assert.deepEqual(initial.originalBadOutput.assignment,[2,2,2,2,2,2,2]);
  assert.equal(initial.callsAttempted,0);
  let restartReplayVerified=false;
  if(name==='inflight_stop'){
    const altered=cp(dir);
    altered.status='request_in_flight';
    altered.callsAttempted=1;
    writeFileSync(join(dir,'self-remediation-v2-checkpoint.json'),JSON.stringify(altered));
    run(dir,'cycle',name,{},false);
    assert.equal(cp(dir).status,'request_in_flight');
    assert.equal(cp(dir).callsAttempted,1);
  }else if(name==='budget_ceiling'){
    const altered=cp(dir);
    altered.callsAttempted=altered.maxCalls;
    writeFileSync(join(dir,'self-remediation-v2-checkpoint.json'),JSON.stringify(altered));
    run(dir,'cycle',name);
    assert.equal(cp(dir).status,'exhausted');
    assert.equal(cp(dir).callsAttempted,altered.maxCalls);
  }else if(name==='truncated'||name==='transport_unknown'){
    run(dir,'cycle',name);
    const held=cp(dir);
    assert.equal(held.status,'manual_hold');
    assert.equal(held.callsAttempted,1);
    assert.equal(held.phaseHistory.length,0);
    assert.equal(held.providerReportedTokens,name==='truncated'?2288:0);
    const prior=JSON.stringify(held);
    run(dir,'cycle',name);
    assert.equal(JSON.stringify(cp(dir)),prior,'no repeated ambiguous provider request');
  }else{
    if(name==='journal_replay'){
      run(dir,'cycle',name,{AAU_FIXTURE_STOP_AFTER_JOURNAL:'yes'});
      assert.equal(cp(dir).status,'answer_journaled');
      assert.equal(cp(dir).callsAttempted,1);
      assert.equal(cp(dir).phaseHistory.length,0);
      run(dir,'cycle',name);
      assert.equal(cp(dir).callsAttempted,1);
      assert.equal(cp(dir).status,'ready');
      assert.equal(cp(dir).phase,'repair');
      restartReplayVerified=true;
    }else{
      run(dir,'cycle',name);
      assert.equal(cp(dir).phase,'repair');
    }
    run(dir,'cycle',name);
    if(name==='bad_witness'){
      const broken=cp(dir);
      assert.equal(broken.phase,'diagnose',
       'infeasible cost-only witness must NOT consume a tests model call');
      assert.equal(broken.phaseHistory.at(-1).publicPassed,false);
      const observed=JSON.parse(broken.feedback);
      assert.equal(observed.publicOutput.cost,90);
      assert.equal(observed.publicFeasible,false);
      assert.equal(observed.diagnostic,'machine_capacity');
    }else assert.equal(cp(dir).phase,'tests');
    run(dir,'cycle',name);
    let final=cp(dir);
    assert.equal(final.callsAttempted,3);
    assert.equal(final.phaseHistory.length,3);
    assert.deepEqual(final.phaseHistory.map(x=>x.phase),
      name==='bad_witness'?['diagnose','repair','diagnose']:
       ['diagnose','repair','tests']);
    if(name==='test_repair'){
      assert.equal(final.status,'ready');
      assert.equal(final.phase,'tests',
       'do not revise an independently verified optimal solver for a bad self-test');
      assert.equal(final.lastAssessment.public.pass,true);
      assert.ok(final.lastAssessment.hiddenChecks.every(x=>x.pass));
      assert.equal(final.lastAssessment.tests.rejectsOld,false);
      assert.equal(JSON.parse(final.feedback).fixScope,'self_written_tests_only');
      const optimalHash=final.phaseHistory[1].codeHash;
      run(dir,'cycle',name);
      final=cp(dir);
      assert.equal(final.callsAttempted,4);
      assert.equal(final.status,'passed');
      assert.deepEqual(final.phaseHistory.map(x=>x.phase),
       ['diagnose','repair','tests','tests']);
      assert.equal(final.phaseHistory[1].codeHash,optimalHash);
      assert.ok(Object.values(final.lastAssessment.tests).every(Boolean));
      assert.ok(final.lastAssessment.hiddenChecks.every(x=>x.pass));
    }
    if(['success','journal_replay'].includes(name)){
      assert.equal(final.status,'passed');
      assert.equal(final.lastAssessment.public.pass,true);
      assert.equal(final.lastAssessment.hiddenChecks.length,6);
      assert.ok(final.lastAssessment.hiddenChecks.every(x=>x.pass));
      assert.ok(Object.values(final.lastAssessment.tests).every(Boolean));
    }else if(name==='bad_witness'){
      assert.equal(final.status,'ready');
      assert.equal(final.phase,'repair');
      assert.equal(final.lastAssessment,null,
       'failed public program must never enter hidden or property-test grading');
      const observed=JSON.parse(final.feedback);
      assert.equal(observed.publicOutput.cost,90);
      assert.equal(observed.publicFeasible,false);
      assert.equal(observed.publicExactOptimal,false);
      assert.equal(observed.diagnostic,'machine_capacity');
    }else if(name==='weak_tests'){
      assert.equal(final.status,'ready');
      assert.equal(final.phase,'tests');
      assert.equal(JSON.parse(final.feedback).fixScope,'self_written_tests_only');
      assert.equal(final.lastAssessment.public.pass,true);
      assert.ok(final.lastAssessment.hiddenChecks.every(x=>x.pass));
      assert.equal(final.lastAssessment.tests.acceptsCorrect,true);
      assert.equal(final.lastAssessment.tests.rejectsOld,false);
      assert.equal(final.lastAssessment.tests.rejectsCostTamper,false);
      assert.equal(final.lastAssessment.success,false);
    }
  }
  const expectedPass=['success','journal_replay','test_repair'].includes(name);
  run(dir,'finish',name,{},expectedPass);
  const result=JSON.parse(readFileSync(join(dir,'self-remediation-v2-report.json')));
  assert.equal(result.simulation,true,'never count simulated responses as inference');
  assert.equal(result.newBillableAttempts,0);
  assert.equal(result.providerReportedTokens,0);
  assert.equal(result.success,expectedPass);
  scenarios.push({scenario:name,expectedPass,observedPass:result.success,
   finalState:cp(dir).status,phases:result.phaseHistory.map(x=>x.phase),
   syntheticCalls:result.syntheticResponseCount,
   simulatedTokenUnits:result.simulatedTokenUnits,
   publicPass:result.visiblePassed,
   sealedHiddenCount:cp(dir).lastAssessment?.hiddenChecks.length||0,
   sealedHiddenPass:result.allSixHiddenPassed,
   selfTests:result.ownTests,
   oldCostOnlyDefectDetected:name==='bad_witness'&&
    JSON.parse(cp(dir).feedback).publicOutput?.cost===90&&
    JSON.parse(cp(dir).feedback).publicFeasible===false,
   journalRecoveryReusedCompletedAnswer:restartReplayVerified,
   knownTruncationUsageAccounted:name==='truncated'&&
    cp(dir).providerReportedTokens===2288});
  console.log('AAU_REMEDIATION_FIXTURE_CASE='+JSON.stringify(scenarios.at(-1)));
 }
 const report={experiment:'AAU_SELF_REMEDIATION_V2_NO_COST_INTEGRATION',
  outcome:'passed',fixtureNotModelOutput:true,realModelCalls:0,
  oldModelArtifactRecovered:true,realDockerSandboxExecutions:true,
  originalKimiBadSourceUsed:true,
  independentOSProcessesPerStage:true,scenariosCount:scenarios.length,
  acceptedPositiveControls:3,rejectedNegativeControls:6,
  actualKimiSelfRemediationProven:false,scenarios};
 writeFileSync(join(root,'self-remediation-v2-fixture-evidence.json'),
  JSON.stringify(report,null,2)+'\n');
 console.log('AAU_REMEDIATION_FIXTURE_RESULT='+JSON.stringify({
  outcome:report.outcome,cases:scenarios.length,
  expectedPasses:report.acceptedPositiveControls,
  expectedRejects:report.rejectedNegativeControls,
  genuineLLMCalls:0,realDocker:true,checkpointCrashRecovery:true}));
}finally{
 rmSync(scratch,{recursive:true,force:true});
}
