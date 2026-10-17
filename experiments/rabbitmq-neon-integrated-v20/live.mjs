// Real V20 joint broker+Neon gate, one CI worker, two OS worker processes.
// A missing branch-specific Neon GitHub secret is a recorded BLOCKER, never
// silently interpreted as a successful live experiment.
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {publicProblem,exactOracle,evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
import {scheduleCandidate} from '../deterministic-scheduler-v7/kernel.mjs';
import {rootPartitions,digest,solvePartition} from '../rabbitmq-proof-frontier-v17/partition.mjs';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const output='integrated-v20-evidence.json',worker=fileURLToPath(new URL('./worker.mjs',import.meta.url));
const report={experiment:'AAU_V20_RABBITMQ_NEON_PERSISTENT_LEDGER',
 status:'running',modelCalls:0,oneWorker:true,twoWorkerProcesses:true,
 neonBranch:'br-cold-rice-b4m3l9qu',productionBranchNotUsed:true,
 queueScope:'run_scoped_durable_expiring',
 credentialsPrinted:false,neonMarkerVerified:false,amqpsConnected:false,
 confirmedPublishes:0,simulatedKill:false,recoveredRedelivery:0,
 duplicateSuppression:0,acknowledged:0,rootsCompleted:0,
 proof:null,errorCategory:null,
 caveats:['One Actions runner spawns two processes, not a test of two separate GitHub runners',
  'Durable queue persistence across broker restart is not tested',
  'Branch-restricted owner credential requires secure user-managed GitHub Actions secret',
  'No concurrent writers: serial recovery only',
  'A durable completion receipt must be validated by the independent deterministic scheduler']};
const persist=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const liveGuard=process.env.GITHUB_ACTIONS==='true'&&process.env.AAU_V20_RESEARCH==='yes';
const rawNeon=String(process.env.NEON_V19_DATABASE_URL||'').trim();
const rawAmqp=String(process.env.AMQP_URL||'').trim();
if(!liveGuard){report.status='blocked_not_research_ci';persist();console.log('AAU_V20_STATUS=BLOCKED_NOT_CI');process.exitCode=2}
else if(!rawNeon){report.status='blocked_missing_neon_v19_branch_secret';persist();console.log('AAU_V20_STATUS=BLOCKED_MISSING_NEON_V19_DATABASE_URL')}
else if(!rawAmqp){report.status='blocked_missing_existing_amqp_secret';persist();console.log('AAU_V20_STATUS=BLOCKED_MISSING_AMQP')}
else{
 let amqp,store,connection,channel,queue;
 try{
  // Credential imports happen only after both guard and secret-presence checks.
  const modules=await Promise.all([import('amqplib'),import('./store.mjs')]);
  amqp=modules[0].default;store=modules[1].newStore(rawNeon);
  await store.verify();report.neonMarkerVerified=true;
  const run=randomUUID(),roots=rootPartitions(publicProblem);
  const baseline={jobs:[
   {id:'J0',machine:'M0'},{id:'J1',machine:'M1'},{id:'J3',machine:'M0'},
   {id:'J2',machine:'M1'},{id:'J4',machine:'M0'},{id:'J6',machine:'M0'},
   {id:'J5',machine:'M1'}]};
  const start=scheduleCandidate(publicProblem,baseline);
  if(!start.ok||start.cost!==512||!evaluate(publicProblem,{schedule:start.schedule,cost:start.cost}).ok)
   throw Error('BASELINE_VERIFICATION_FAILED');
  // Unique research run; cannot name or affect production root records.
  await store.init(run,digest(publicProblem),start.cost,
   roots.map(x=>({id:x.id,rootHash:digest(x.entry)})));
  const begin=await store.summary(run);
  if(begin.total!==3||begin.pending!==3||begin.optimal||begin.lower!==0||begin.upper!==512)
   throw Error('INITIAL_NEON_SUMMARY_INVALID');
  let url=rawAmqp.replace(/^AMQP(?:_URL)?\s*=\s*/i,'').trim();
  if((url[0]==='"'&&url.at(-1)==='"')||(url[0]==="'"&&url.at(-1)==="'"))url=url.slice(1,-1).trim();
  let protocol;try{protocol=new URL(url).protocol}catch{throw Error('BROKER_URL_FORMAT_INVALID')}
  if(protocol!=='amqps:')throw Error('AMQPS_REQUIRED');
  connection=await amqp.connect(url,{timeout:10000});
  report.amqpsConnected=true;
  channel=await connection.createConfirmChannel();
  queue='aau.research.v20.'+run.replaceAll('-','');
  await channel.assertQueue(queue,{durable:true,exclusive:false,autoDelete:false,
   arguments:{'x-expires':600000}});
  for(const root of [...roots,roots[0]]){
   channel.sendToQueue(queue,Buffer.from(JSON.stringify({run,id:root.id})),{
    persistent:true,contentType:'application/json',messageId:randomUUID()});
   report.confirmedPublishes++;
  }
  await channel.waitForConfirms();persist();
  const env={...process.env,AAU_V20_RUN_ID:run,AAU_V20_QUEUE:queue};
  const first=spawnSync(process.execPath,[worker],{
   env:{...env,AAU_V20_PHASE:'crash'},encoding:'utf8',timeout:30000,maxBuffer:500000});
  if(first.signal!=='SIGKILL')throw Error('WORKER_SIGKILL_NOT_OBSERVED');
  report.simulatedKill=true;
  const middle=await store.summary(run);
  if(middle.completed!==1||middle.pending!==2||middle.optimal||middle.gap<=0)
   throw Error('POST_CRASH_NEON_LOST_PROOF_OR_FALSE_OPTIMAL');
  const second=spawnSync(process.execPath,[worker],{
   env:{...env,AAU_V20_PHASE:'recover'},encoding:'utf8',timeout:40000,maxBuffer:500000});
  if(second.status!==0)throw Error('RECOVERY_WORKER_FAILED');
  const line=second.stdout.split('\n').find(x=>x.startsWith('AAU_V20_RECOVERY='));
  if(!line)throw Error('RECOVERY_NO_SAFE_METRICS');
  const c=JSON.parse(line.slice('AAU_V20_RECOVERY='.length));
  report.recoveredRedelivery=c.redelivered;report.duplicateSuppression=c.duplicates;
  report.acknowledged=c.acks;
  if(c.redelivered<1||c.duplicates<2||c.acks!==4||c.commits!==2)
   throw Error('RECOVERY_DELIVERY_COUNTS_INVALID');
  const end=await store.summary(run),rows=await store.rows(run),oracle=exactOracle(publicProblem);
  if(end.total!==3||end.completed!==3||end.pending!==0||end.gap!==0||
    !end.optimal||end.upper!==415||end.lower!==415||oracle.cost!==415)
   throw Error('GLOBAL_EXACT_PROOF_FAILED');
  let leaves=0;
  for(const row of rows){
   const root=roots.find(x=>x.id===row.id),exhausted=solvePartition(publicProblem,root.entry);
   const independently=evaluate(publicProblem,{schedule:exhausted.schedule,cost:exhausted.cost});
   const receipt=sha({root:row.id,cost:exhausted.cost,
    explored:exhausted.explored,schedule:exhausted.schedule});
   if(row.status!=='done'||!independently.ok||independently.cost!==row.exact_cost||
      row.leaves!==exhausted.explored||row.receipt!==receipt)
    throw Error('LEDGER_WITNESS_INDEPENDENT_REPLAY_FAILED');
   leaves+=row.leaves;
  }
  if(leaves!==448)throw Error('ROOT_COVERAGE_INCOMPLETE');
  report.rootsCompleted=end.completed;report.proof={lower:end.lower,upper:end.upper,
   gap:end.gap,independentOracle:oracle.cost,completeLeaves:leaves,
   runHash:sha(run),queueHash:sha(queue),rootResults:rows.map(r=>({id:r.id,cost:r.exact_cost,leaves:r.leaves,fence:r.fence}))};
  report.proofDigest=sha({neon:report.proof,simulatedKill:report.simulatedKill,
   redelivery:report.recoveredRedelivery,acknowledged:report.acknowledged});
  report.status='passed';
 }catch(e){
  report.status='failed';
  const msg=String(e?.message||e);
  // Deliberately do not propagate provider-specific errors or credential values.
  report.errorCategory=/^[A-Z0-9_]+$/.test(msg)?msg.slice(0,120):'SAFE_GENERIC_FAILURE';
 }finally{
  try{if(channel&&queue)await channel.deleteQueue(queue)}catch{}
  try{if(channel)await channel.close()}catch{}
  try{if(connection)await connection.close()}catch{}
  try{if(store)await store.close()}catch{}
  persist();
  console.log('AAU_V20_JOINT_RESULT='+JSON.stringify({
   status:report.status,marker:report.neonMarkerVerified,amqps:report.amqpsConnected,
   killed:report.simulatedKill,redelivery:report.recoveredRedelivery,
   duplicateSkipped:report.duplicateSuppression,acked:report.acknowledged,
   completed:report.rootsCompleted,exact:report.proof?.upper??null,
   proofPresent:!!report.proofDigest,error:report.errorCategory}));
  if(report.status!=='passed')process.exitCode=2;
 }
}
