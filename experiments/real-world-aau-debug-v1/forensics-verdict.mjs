// Post-run independent audit: prints/writes ONLY bounded forensic coverage.
// A model's self-declared success cannot make this verifier pass.
import {readFileSync,writeFileSync} from 'node:fs';
import {inspectForensicsReport} from './forensics-trace-check.mjs';
let report;
try{report=JSON.parse(readFileSync('real-world-debug-evidence.json','utf8'))}
catch{
 const missing={pass:false,issues:['RUN_EVIDENCE_MISSING']};
 writeFileSync('forensic-audit-summary.json',JSON.stringify(missing,null,2)+'\n');
 console.log('AAU_FORENSIC_VERDICT='+JSON.stringify(missing));
 process.exitCode=2;
}
if(report){
 const check=inspectForensicsReport(report);
 const final={
  ...check,runStatus:typeof report.status==='string'?report.status:null,
  codeRepairSucceeded:report.success===true,
  completionAssessment:check.pass?'FORENSIC_INTEGRITY_VERIFIED':'FORENSIC_GAPS_FOUND',
  // A verified audit trail does not mean the candidate passed the original bug.
  modelCapabilityVerified:report.success===true&&check.pass
 };
 writeFileSync('forensic-audit-summary.json',JSON.stringify(final,null,2)+'\n');
 console.log('AAU_FORENSIC_VERDICT='+JSON.stringify({
  pass:final.pass,issues:final.issues,
  acceptedCalls:final.acceptedCalls,
  acceptedCallsJustified:final.acceptedCallsJustified,
  modelDecisions:final.modelDecisions,events:final.events,
  publicSuites:final.publicSuites,hiddenSuites:final.hiddenSuites,
  decisionsWithVerifiedOutcome:final.decisionsWithVerifiedOutcome,
  completionAssessment:final.completionAssessment,
  codeRepairSucceeded:final.codeRepairSucceeded
 }));
 if(!check.pass)process.exitCode=2;
}
