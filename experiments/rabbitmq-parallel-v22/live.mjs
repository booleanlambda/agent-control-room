// One-vs-two concurrent worker experiment on nine exact V13 stress cases.
// Each of nine instances is solved ONCE per mode with identical V13 budgets.
// This tests cross-case parallel throughput, not within-case distributed B&B.
import amqp from 'amqplib';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {store,config} from './store.mjs';
import {stressCases,sha} from '../certificate-stress-v12/stress.mjs';
import {evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
import {certifyImproved} from '../tighter-bounds-v13/certifier.mjs';
import {topologicalSeeds,admissibleLowerBound} from '../per-instance-scaling-v10/bench.mjs';
import {beamOptimize} from '../scheduler-beam-v9/beam.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_V22_RESEARCH!=='yes')throw Error('V22_RESEARCH_CI_ONLY');
const report={experiment:'AAU_V22_RABBITMQ_NEON_PARALLEL_CASE_BENCH',
 status:'running',modelCalls:0,providerTokens:0,isolatedNeonBranch:'br-cold-rice-b4m3l9qu',
 productionWrites:false,caseCount:9,budgets:config,
 cases:stressCases.map(x=>({id:x.id,jobs:x.jobCount,seed:x.seed,variant:x.variant,problemHash:sha(x.problem)})),
 fixtureDigest:hash(stressCases.map(x=>({id:x.id,hash:sha(x.problem)}))),
 runs:[],comparison:null,
 caveats:[
  'Workers parallelize independent instances, not branches of a single search tree',
  'Same V13 certifier, beam warmup and per-case expansion/frontier ceiling in both modes',
  'Comparing overall host wall time includes RabbitMQ, Postgres and worker startup overhead',
  'Two workers may consume up to two CPU cores simultaneously; total CPU/resource use must be compared',
  'The nine tasks are short and small; one single order can favor one mode due to cold starts and CI variability',
  'A complete case receipt can have a NONZERO proof gap and does not imply global exactness',
  'Live completion requires all 18 independently feasible case witnesses and interval equality'
 ]};
const file='parallel-v22-evidence.json',save=()=>writeFileSync(file,JSON.stringify(report,null,2)+'\n');
const baseEnv={...process.env,AAU_V22_RESEARCH:'yes'};
const workerFile=fileURLToPath(new URL('./worker.mjs',import.meta.url));
let raw=String(process.env.AMQP_URL||'').trim().replace(/^AMQP(?:_URL)?\s*=\s*/i,'');
if((raw.startsWith('"')&&raw.endsWith('"'))||(raw.startsWith("'")&&raw.endsWith("'")))raw=raw.slice(1,-1).trim();
let storeClient,broker;
function runWorker(run,queue,label){
 return new Promise((resolve,reject)=>{
  const start=performance.now();
  const child=spawn(process.execPath,[workerFile],{
   env:{...baseEnv,AAU_V22_RUN:run,AAU_V22_QUEUE:queue,AAU_V22_WORKER:label},
   stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',x=>{stdout+=x.slice(0,3000);if(stdout.length>14000)stdout=stdout.slice(-14000)});
  child.stderr.on('data',x=>{stderr+=x.slice(0,1000);if(stderr.length>1000)stderr=stderr.slice(-1000)});
  child.on('error',()=>reject(Error('V22_CHILD_LAUNCH_ERROR')));
  child.on('close',(code,signal)=>{
   if(code!==0||signal)reject(Error('V22_WORKER_PROCESS_FAILED'));
   else{
    const line=stdout.split('\n').find(x=>x.startsWith('AAU_V22_WORKER='));
    if(!line)reject(Error('V22_WORKER_METRICS_MISSING'));
    else{
     try{resolve({...JSON.parse(line.slice('AAU_V22_WORKER='.length)),processWallMs:performance.now()-start})}
     catch{reject(Error('V22_METRICS_INVALID'))}
    }
   }
  });
 });
}
async function oneMode(mode,numWorkers){
 const run=randomUUID(),queue='aau.research.v22.'+run.replaceAll('-','');
 const result={mode,workers:numWorkers,runHash:hash(run),
  queueHash:hash(queue),state:'running',
  cases:[],wallMs:null,workersInfo:[],summaries:[],aggregate:null};
 report.runs.push(result);save();
 const entries=stressCases.map(x=>({id:x.id,inputHash:sha(x.problem)}));
 await storeClient.init(run,mode,report.fixtureDigest,entries);
 let chan;
 try{
  chan=await broker.createConfirmChannel();
  await chan.assertQueue(queue,{durable:true,exclusive:false,autoDelete:false,
   arguments:{'x-expires':1200000}});
  for(const entry of entries)
   chan.sendToQueue(queue,Buffer.from(JSON.stringify({run,id:entry.id})),{
    persistent:true,contentType:'application/json',messageId:randomUUID()});
  await chan.waitForConfirms();
  result.sent=entries.length;save();
  const t=performance.now();
  result.workersInfo=await Promise.all(Array.from({length:numWorkers},(_,i)=>
   runWorker(run,queue,(mode==='serial'?'serial':'parallel')+'-'+(i+1))));
  result.wallMs=performance.now()-t;
  const summary=await storeClient.summary(run),rows=await storeClient.cases(run);
  if(summary.complete!==9||summary.pending!==0||summary.total!==9||
    rows.some(x=>x.status!=='done'||x.attempts!==1||x.fence!==1)||
    result.workersInfo.reduce((n,x)=>n+x.committed,0)!==9||
    result.workersInfo.reduce((n,x)=>n+x.acked,0)!==9)
   throw Error('V22_INCOMPLETE_OR_DUPLICATE_CASES');
  for(const x of rows){
   const f=stressCases.find(s=>s.id===x.id);
   if(!f)throw Error('V22_UNKNOWN_NEON_CASE');
   const p=f.problem,seeds=topologicalSeeds(p);
   const warmed=beamOptimize(p,seeds,{maxEvaluations:400,beamWidth:8,maxDepth:7});
   if(!warmed.ok)throw Error('V22_BASELINE_WARMUP_FAIL');
   const check=certifyImproved(p,warmed.proposal,{
    maxExpansions:2200,maxFrontier:2400,maxWallMs:60000,boundMode:'forced_rank'});
   const independently=evaluate(p,{schedule:check.execution.schedule,cost:check.upperBound});
   if(!independently.ok||independently.cost!==check.upperBound||
      x.lower_bound!==check.lowerBound||x.upper_bound!==check.upperBound||
      x.expanded!==check.expanded||
      x.certificate_digest!==check.evidence.certificateHash||
      x.witness_digest!==hash(check.incumbent)||
      x.lower_bound<admissibleLowerBound(p).value)
    throw Error('V22_INDEPENDENT_CERTIFICATE_REPLAY_FAILED_'+x.id);
   result.cases.push({id:x.id,size:f.jobCount,lower:x.lower_bound,
    upper:x.upper_bound,gap:x.upper_bound-x.lower_bound,expanded:x.expanded,
    certifiedOptimal:x.lower_bound===x.upper_bound,
    certificateHash:x.certificate_digest,witnessHash:x.witness_digest,
    solverMs:x.solver_elapsed_ms});
  }
  result.aggregate={gapSum:summary.gapSum,optimalCases:summary.optimalCases,
   expansions:summary.expansions,
   solverMsSum:result.cases.reduce((n,x)=>n+x.solverMs,0),
   workerCpuTimeMsApprox:result.workersInfo.reduce((n,x)=>n+x.solverMs,0),
   workerRssPeakKiB:result.workersInfo.map(x=>x.peakRssKiB),
   delivered:result.workersInfo.reduce((n,x)=>n+x.acked,0)};
  if(result.cases.reduce((n,x)=>n+x.gap,0)!==summary.gapSum||
     result.cases.reduce((n,x)=>n+x.expanded,0)!==summary.expansions||
     result.cases.filter(x=>x.certifiedOptimal).length!==summary.optimalCases)
   throw Error('V22_SUMMARY_MISMATCH');
  const remaining=await chan.checkQueue(queue);
  if(remaining.messageCount!==0||remaining.consumerCount!==0)
   throw Error('V22_BROKER_LEFTOVER_MESSAGES');
  await chan.deleteQueue(queue);result.queueCleaned=true;
  result.state='passed';save();
 }finally{
  if(chan){try{if(result.state!=='passed')await chan.deleteQueue(queue)}catch{}
    try{await chan.close()}catch{}}
 }
}
try{
 if(!process.env.NEON_V19_DATABASE_URL||!process.env.AMQP_URL)throw Error('RESEARCH_SECRETS_MISSING');
 if(new URL(raw).protocol!=='amqps:')throw Error('AMQPS_REQUIRED');
 storeClient=store(process.env.NEON_V19_DATABASE_URL);await storeClient.verify();
 broker=await amqp.connect(raw,{timeout:10000});
 await oneMode('serial',1);
 await oneMode('two_workers',2);
 const [a,b]=report.runs;
 for(const item of a.cases){
  const counterpart=b.cases.find(x=>x.id===item.id);
  if(!counterpart||item.certificateHash!==counterpart.certificateHash||
    item.witnessHash!==counterpart.witnessHash||item.gap!==counterpart.gap||
    item.expanded!==counterpart.expanded)
   throw Error('V22_SERIAL_PARALLEL_CERTIFICATES_DIFFER_'+item.id);
 }
 if(a.aggregate.expansions!==b.aggregate.expansions||
    a.aggregate.gapSum!==b.aggregate.gapSum||
    a.aggregate.optimalCases!==b.aggregate.optimalCases)
  throw Error('V22_UNEQUAL_SEARCH_WORK');
 report.comparison={
  nineCaseProofsEquivalent:true,serialWallMs:a.wallMs,parallelWallMs:b.wallMs,
  wallSpeedup:a.wallMs/b.wallMs,
  serialWorkers:1,parallelWorkers:2,
  serialGapSum:a.aggregate.gapSum,parallelGapSum:b.aggregate.gapSum,
  serialOptimalCases:a.aggregate.optimalCases,parallelOptimalCases:b.aggregate.optimalCases,
  bothExpanded:a.aggregate.expansions,
  serialWorkerRssKiB:a.aggregate.workerRssPeakKiB,
  parallelWorkerRssKiB:b.aggregate.workerRssPeakKiB,
  serialTotalSolverMs:a.aggregate.solverMsSum,parallelTotalSolverMs:b.aggregate.solverMsSum,
  serialTaskThroughputPerSecond:9000/a.wallMs,
  parallelTaskThroughputPerSecond:9000/b.wallMs
 };
 report.proofDigest=hash({inputs:report.fixtureDigest,runs:report.runs.map(x=>({
  mode:x.mode,cases:x.cases.map(z=>({id:z.id,cert:z.certificateHash,lb:z.lower,ub:z.upper})),
  workerAck:x.aggregate.delivered})),
  stats:report.comparison});
 report.status='passed';
}catch(e){
 report.status='failed';
 const msg=String(e?.message||e);
 report.error=/^[A-Z0-9_]+$/.test(msg)?msg.slice(0,110):'REDACTED_INTERNAL_FAILURE';
}finally{
 try{if(broker)await broker.close()}catch{}
 try{if(storeClient)await storeClient.close()}catch{}
 save();
 console.log('AAU_V22_FINAL='+JSON.stringify({status:report.status,
  cases:report.runs.map(x=>({mode:x.mode,done:x.cases.length,gap:x.aggregate?.gapSum,
  optimal:x.aggregate?.optimalCases,expanded:x.aggregate?.expansions,
  wallMs:x.wallMs,workers:x.workersInfo.length})),
  comparison:report.comparison,proof:report.proofDigest??null,error:report.error??null}));
 if(report.status!=='passed')process.exitCode=2;
}
