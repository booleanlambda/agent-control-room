// V18B: prove real GitHub Actions job-to-job artifact checkpoints,
// WITHOUT RabbitMQ credentials, production DB access, or paid services.
// Each job restores an immutable SQLite file into a different runner VM.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {publicProblem,exactOracle,evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
import {rootPartitions,solvePartition,digest} from '../rabbitmq-proof-frontier-v17/partition.mjs';
import {scheduleCandidate} from '../deterministic-scheduler-v7/kernel.mjs';

if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_V18_ARTIFACT_ONLY!=='yes')
  throw Error('OFFLINE_ARTIFACT_RESEARCH_ONLY');
const stage=process.argv[2];
if(!['init','root1','root2','root3','verify'].includes(stage))
  throw Error('INVALID_SNAPSHOT_STAGE');
const sha=x=>createHash('sha256').update(x).digest('hex');
const jsonHash=x=>sha(JSON.stringify(x));
const stateDir=resolve('./state'),db=join(stateDir,'proof.sqlite'),meta=join(stateDir,'manifest.json');
const ledgerFile=fileURLToPath(new URL('../rabbitmq-proof-frontier-v17/ledger.py',import.meta.url));
const roots=rootPartitions(publicProblem);
const id=String(process.env.GITHUB_RUN_ID??'');
if(!/^[0-9]+$/.test(id))throw Error('RUN_ID_REQUIRED');
mkdirSync(stateDir,{recursive:true});
function ledger(req){
 const child=spawnSync('python3',[ledgerFile],{input:JSON.stringify({...req,db}),
   encoding:'utf8',timeout:9000,maxBuffer:1000000});
 if(child.status!==0)throw Error('SQL_OPERATION_FAILED_'+req.action);
 let out;try{out=JSON.parse(child.stdout)}catch{throw Error('BAD_SQL_RESPONSE')}
 if(out.error)throw Error('SQL_REJECTED_'+req.action);
 return out;
}
const starting={
 jobs:[{id:'J0',machine:'M0'},{id:'J1',machine:'M1'},{id:'J3',machine:'M0'},
 {id:'J2',machine:'M1'},{id:'J4',machine:'M0'},{id:'J6',machine:'M0'},
 {id:'J5',machine:'M1'}]
};
const start=scheduleCandidate(publicProblem,starting);
if(!start.ok||start.cost!==512||!evaluate(publicProblem,{schedule:start.schedule,cost:start.cost}).ok)
 throw Error('KNOWN_FEASIBLE_SEED_INVALID');
let evidence;
if(stage==='init'){
 if(existsSync(meta)||existsSync(db))throw Error('EXISTING_STATE_REJECTED');
 ledger({action:'init',roots});
 evidence={kind:'AAU_V18B_INDEPENDENT_RUNNER_CHECKPOINT',runIdHash:sha(id),
  problemHash:digest(publicProblem),latestStage:'init',rootProofs:[],
  predecessorChain:null,stages:[],noBrokerCalls:true,modelCalls:0};
}else{
 if(!existsSync(meta)||!existsSync(db))throw Error('CHECKPOINT_MISSING');
 evidence=JSON.parse(readFileSync(meta,'utf8'));
 const previous=stage==='root1'?'init':stage==='root2'?'root1':stage==='root3'?'root2':'root3';
 if(evidence.kind!=='AAU_V18B_INDEPENDENT_RUNNER_CHECKPOINT'||
    evidence.runIdHash!==sha(id)||evidence.problemHash!==digest(publicProblem)||
    evidence.latestStage!==previous||evidence.dbSha!==sha(readFileSync(db)))
  throw Error('CHECKPOINT_FENCING_OR_DIGEST_REJECTED');
}
const summary=()=>ledger({action:'summary',verifiedIncumbentCost:start.cost});
if(stage.startsWith('root')){
 const index=Number(stage.slice(-1))-1,root=roots[index];
 const claimed=ledger({action:'claim',id:root.id});
 if(claimed.done)throw Error('REPEATED_ROOT_STAGE_REJECTED');
 const solution=solvePartition(publicProblem,root.entry);
 const verified=evaluate(publicProblem,{schedule:solution.schedule,cost:solution.cost});
 if(!verified.ok||verified.cost!==solution.cost)throw Error('INDEPENDENT_WITNESS_FAIL');
 const receipt=jsonHash({id:root.id,cost:solution.cost,explored:solution.explored,schedule:solution.schedule});
 const payload={action:'complete',id:root.id,cost:solution.cost,explored:solution.explored,
   schedule:solution.schedule,hash:receipt};
 if(!ledger(payload).committed)throw Error('NOT_FIRST_COMMIT');
 if(!ledger(payload).duplicate)throw Error('EXACT_DUPLICATE_REJECTED');
 const conflict=spawnSync('python3',[ledgerFile],{
  input:JSON.stringify({...payload,db,cost:solution.cost+1}),
  encoding:'utf8',timeout:9000});
 if(conflict.status===0)throw Error('CONFLICTING_DUPLICATE_ACCEPTED');
 evidence.rootProofs.push({id:root.id,cost:solution.cost,explored:solution.explored,
   receipt,partHash:solution.proof});
}
const result=summary();
const expectedCompleted=stage==='init'?0:stage==='verify'?3:Number(stage.slice(-1));
if(result.completed!==expectedCompleted||result.pending!==3-expectedCompleted||
   result.optimal!==(expectedCompleted===3))
 throw Error('UNSOUND_INCOMPLETE_OR_COMPLETE_PROOF');
if(expectedCompleted<3 &&(result.lower!==0||result.upper>512))
 throw Error('FALSE_PARTIAL_LOWER_BOUND');
if(expectedCompleted===3){
 const independent=exactOracle(publicProblem);
 if(result.lower!==415||result.upper!==415||independent.cost!==415||result.explored!==448)
  throw Error('EXACT_ORACLE_COVERAGE_FAIL');
 for(const line of result.branches){
  const root=roots.find(x=>x.id===line.id),replay=solvePartition(publicProblem,root.entry);
  const verified=evaluate(publicProblem,{schedule:line.schedule,cost:line.cost});
  if(!verified.ok||verified.cost!==line.cost||replay.cost!==line.cost||
    replay.explored!==line.explored)throw Error('CHECKPOINT_INDEPENDENT_REPLAY_FAILED');
 }
}
evidence.stages.push({stage,completed:result.completed,pending:result.pending,
 lower:result.lower,upper:result.upper,gap:result.gap,optimal:result.optimal,
 stageIdentityHash:jsonHash({id,stage}),branchProofHash:jsonHash(result.branches.map(x=>({
  id:x.id,cost:x.cost,explored:x.explored,hash:x.hash})))});
evidence.latestStage=stage;
evidence.predecessorChain=jsonHash({previous:evidence.predecessorChain,stage,rows:evidence.stages.at(-1)});
evidence.dbSha=sha(readFileSync(db));
if(stage==='verify'){
 evidence.complete=true;
 evidence.proof={lower:result.lower,upper:result.upper,optimum:415,
  enumerated:result.explored,exact:true};
 evidence.proofDigest=jsonHash({chain:evidence.predecessorChain,dbSha:evidence.dbSha,proof:evidence.proof});
}
writeFileSync(meta,JSON.stringify(evidence,null,2)+'\n');
console.log('AAU_V18B_ARTIFACT_PROOF='+JSON.stringify({
 stage,completed:result.completed,pending:result.pending,lower:result.lower,
 upper:result.upper,gap:result.gap,optimal:result.optimal,
 rootCount:evidence.rootProofs.length,chain:evidence.predecessorChain.slice(0,20),
 finalProof:stage==='verify'?evidence.proofDigest:null,noBrokerCalls:true}));
