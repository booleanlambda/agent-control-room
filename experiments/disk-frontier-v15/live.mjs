// AAU V15: compare separate-process V13 and a SQLite persisted best-first
// priority frontier, on identical inputs/seeds and node expansion ceilings.
import {writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {stressCases,sha} from '../certificate-stress-v12/stress.mjs';
import {topologicalSeeds,admissibleLowerBound} from '../per-instance-scaling-v10/bench.mjs';
import {beamOptimize} from '../scheduler-beam-v9/beam.mjs';
import {certifyDisk} from './disk.mjs';
import {evaluate,exactOracle} from '../precise-diagnostics-v6/benchmark.mjs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_V15_RESEARCH!=='yes')
 throw Error('RESEARCH_ONLY');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const worker=fileURLToPath(new URL('./v13-worker.mjs',import.meta.url));
const report={experiment:'AAU_SQLITE_DISK_BACKED_BEST_FIRST_V15',state:'running',
 modelCalls:0,modelTokens:0,oneWorker:true,
 limits:{warmupEvaluations:400,maxExpansions:2200,v13Frontier:2400,
  diskTightEntries:2400,diskSpillEntries:16000,maxWallMs:60000,maxDatabaseBytes:50000000},
 cases:[],smallIndependentProofs:[],rootProof:null,
 caveats:['Node V13 and Python SQLite use different interpreters; peak RSS is not language-normalized.',
 'SQLite frontier is disk-backed with atomic expansions; its database file and transaction journal contribute disk bytes.',
 'A disk soft-byte cap is tested between expansions, not a byte-perfect storage ceiling.',
 'A 16,000-state disk queue is more search storage than a 2,400-state memory queue, not a free performance improvement.',
 'Node counts compare only expanded states, not wall-time, I/O or algorithm-specific lower-bound calculation overhead.']};
const file='disk-v15-evidence.json',save=()=>writeFileSync(file,JSON.stringify(report,null,2)+'\n');
function runV13(problem,incumbent){
 const child=spawnSync(process.execPath,[worker],{
  input:JSON.stringify({problem,incumbent,maxExpansions:report.limits.maxExpansions,
   maxFrontier:report.limits.v13Frontier}),
  encoding:'utf8',timeout:80000,maxBuffer:1000000});
 if(child.status!==0)throw Error('BASELINE_PROCESS_FAILED:'+String(child.stderr).slice(0,300));
 return JSON.parse(child.stdout.trim());
}
function interval(problem,x){
 if(!x.certifiedOptimal&&x.upperBound<=x.lowerBound)throw Error('FALSE_UNCERTAINTY');
 if(x.lowerBound>x.upperBound||x.gapUpper!==x.upperBound-x.lowerBound)
  throw Error('BAD_INTERVAL');
 if(!Number.isFinite(x.upperBound)||!Number.isFinite(x.lowerBound))throw Error('NONFINITE_INTERVAL');
 return {lower:x.lowerBound,upper:x.upperBound,gap:x.gapUpper,
  proven:x.certifiedOptimal,expanded:x.expanded??x.stats.expanded,
  exit:x.exitReason,certificateHash:x.certificateHash,
  elapsedMs:x.elapsedNs!==undefined?x.elapsedNs/1e6:x.stats.elapsedMs,
  peakRssKiB:x.observedMaxRssKiB??x.stats.peakRssKiB,
  maxQueue:x.peakFrontier??x.stats.maxQueue,
  diskBytesPeak:x.stats?.diskBytesPeak??null,
  dbBytesAtStop:x.stats?.dbBytesAtStop??null,
  emittedStates:x.stats?.generated??x.generated};
}
try{
 for(const entry of stressCases){
  const p=entry.problem,seeds=topologicalSeeds(p);
  const warm=beamOptimize(p,seeds,{maxEvaluations:400,beamWidth:8,maxDepth:7});
  if(!warm.ok)throw Error('WARMUP_FAILED');
  const original=admissibleLowerBound(p).value;
  const baseline=runV13(p,warm.proposal);
  const tight=certifyDisk(p,warm.proposal,{
   maxExpansions:2200,maxQueueEntries:2400,maxWallMs:60000,maxDatabaseBytes:50000000});
  const spilled=certifyDisk(p,warm.proposal,{
   maxExpansions:2200,maxQueueEntries:16000,maxWallMs:60000,maxDatabaseBytes:50000000});
  const base=interval(p,baseline),small=interval(p,tight),large=interval(p,spilled);
  for(const x of [base,small,large]){
   if(x.lower<original||x.upper>warm.finalCost||
    x.lower>large.upper||large.lower>x.upper||x.expanded>2200)
    throw Error('CERTIFICATE_DISAGREEMENT_'+entry.id);
  }
  if(small.maxQueue>2400||large.maxQueue>16000||
   small.diskBytesPeak===null||large.diskBytesPeak===null)throw Error('QUEUE_CAP_VIOLATION_'+entry.id);
  report.cases.push({id:entry.id,size:entry.jobCount,seed:entry.seed,
   hash:sha(p),initialCost:warm.finalCost,oldRelaxation:original,
   v13:base,sqliteTight:small,sqliteSpill:large,
   extraGapReductionVsV13:base.gap-large.gap,
   independentFeasible:spilled.independentFeasible&&tight.independentFeasible});
  save();
 }
 const small=stressCases[0].problem;
 for(const n of [4,5,6,7]){
  const p={machines:structuredClone(small.machines),jobs:structuredClone(small.jobs.slice(0,n))};
  const oracle=exactOracle(p),initial=topologicalSeeds(p)[0];
  const result=certifyDisk(p,initial,{maxExpansions:8000,maxQueueEntries:16000});
  const checked=evaluate(p,{schedule:result.execution.schedule,cost:result.upperBound});
  if(!checked.ok||checked.cost!==oracle.cost||!result.certifiedOptimal||result.lowerBound!==oracle.cost)
   throw Error('SMALL_ORACLE_NOT_MATCHED_'+n);
  report.smallIndependentProofs.push({n,oracle:oracle.cost,certified:result.upperBound,
   inputHash:sha(p),certificateHash:result.certificateHash});
  save();
 }
 report.summary={
  cases:report.cases.length,
  v13Proven:report.cases.filter(x=>x.v13.proven).length,
  sqliteTightProven:report.cases.filter(x=>x.sqliteTight.proven).length,
  sqliteSpillProven:report.cases.filter(x=>x.sqliteSpill.proven).length,
  v13GapSum:report.cases.reduce((n,x)=>n+x.v13.gap,0),
  sqliteTightGapSum:report.cases.reduce((n,x)=>n+x.sqliteTight.gap,0),
  sqliteSpillGapSum:report.cases.reduce((n,x)=>n+x.sqliteSpill.gap,0),
  spillStrictlyTighterThanV13:report.cases.filter(x=>x.sqliteSpill.gap<x.v13.gap).length,
  maxDiskBytes:Math.max(...report.cases.map(x=>x.sqliteSpill.diskBytesPeak??0)),
  peakPythonRssKiB:Math.max(...report.cases.map(x=>x.sqliteSpill.peakRssKiB)),
  peakNodeV13RssKiB:Math.max(...report.cases.map(x=>x.v13.peakRssKiB))
 };
 report.rootProof=hash({cases:report.cases.map(x=>({id:x.id,input:x.hash,
   old:x.v13.certificateHash,disk:x.sqliteSpill.certificateHash,tight:x.sqliteTight.certificateHash})),
  small:report.smallIndependentProofs});
 report.state='passed';
}catch(e){report.state='failed';report.error=String(e?.stack||e).slice(0,1700)}
finally{
 report.finishedAt=new Date().toISOString();save();
 console.log('AAU_V15_DISK_SPILL_FINAL='+JSON.stringify({state:report.state,modelCalls:0,summary:report.summary??null,
  cases:report.cases.map(x=>({id:x.id,n:x.size,
   v13:{lb:x.v13.lower,ub:x.v13.upper,exit:x.v13.exit,expanded:x.v13.expanded},
   diskTight:{lb:x.sqliteTight.lower,ub:x.sqliteTight.upper,exit:x.sqliteTight.exit,expanded:x.sqliteTight.expanded},
   diskSpill:{lb:x.sqliteSpill.lower,ub:x.sqliteSpill.upper,exit:x.sqliteSpill.exit,expanded:x.sqliteSpill.expanded,
     dbBytes:x.sqliteSpill.dbBytesAtStop}})),
  error:report.error??null,rootProof:!!report.rootProof}));
 if(report.state!=='passed')process.exitCode=2;
}
