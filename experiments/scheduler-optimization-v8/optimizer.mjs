// AAU v8: deterministic, bounded, model-independent improvement of legal
// topological orders and eligible machine assignments. No LLM-written clocks.
import {scheduleCandidate} from '../deterministic-scheduler-v7/kernel.mjs';
import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function proposals(problem,base,mode='both'){
 const result=[],n=base.length,seen=new Set();
 function add(items,change){
  const candidate={jobs:items};
  const key=sha(candidate);
  if(seen.has(key))return;seen.add(key);
  result.push({candidate,change});
 }
 if(mode==='both'||mode==='relocate'){
  for(let from=0;from<n;from++)for(let to=0;to<n;to++){
   if(to===from)continue;
   const jobs=base.map(x=>({...x}));
   const [removed]=jobs.splice(from,1);jobs.splice(to,0,removed);
   add(jobs,{kind:'relocate',from,to,id:removed.id});
  }
 }
 if(mode==='both'||mode==='reassign'){
  for(let i=0;i<n;i++){
   const j=problem.jobs.find(x=>x.id===base[i].id);
   for(const m of problem.machines){
    if(m.id===base[i].machine||!m.types.includes(j?.type))continue;
    const jobs=base.map(x=>({...x}));jobs[i].machine=m.id;
    add(jobs,{kind:'reassign',index:i,id:base[i].id,machine:m.id});
   }
  }
 }
 return result;
}
export function optimizeProposal(problem,seed,{maxEvaluations=1000,maxRounds=16,mode='both'}={}){
 if(!['both','relocate','reassign'].includes(mode)||!Number.isSafeInteger(maxEvaluations)||maxEvaluations<0||
   !Number.isSafeInteger(maxRounds)||maxRounds<0||maxRounds>100)throw Error('invalid_optimizer_budget');
 const start=scheduleCandidate(problem,seed);
 if(!start.ok)return {ok:false,reason:'initial_candidate_invalid',detail:start};
 let best={jobs:seed.jobs.map(x=>({id:x.id,machine:x.machine}))},current=start;
 const baselineCost=start.cost, trace=[],checked=0;let rounds=0,evaluations=0;
 while(rounds<maxRounds&&evaluations<maxEvaluations){
  let winner=null;
  for(const next of proposals(problem,best.jobs,mode)){
   if(evaluations>=maxEvaluations)break;
   evaluations++;
   const evaluated=scheduleCandidate(problem,next.candidate);
   if(!evaluated.ok)continue;
   if(evaluated.cost>=current.cost)continue;
   if(!winner||evaluated.cost<winner.cost){
    winner={...next,cost:evaluated.cost,execution:evaluated};
   }
  }
  if(!winner)break;
  rounds++;
  trace.push({round:rounds,change:winner.change,previousCost:current.cost,nextCost:winner.cost,
    proposalHash:sha(winner.candidate),scheduleHash:winner.execution.evidence.scheduleDigest});
  best=winner.candidate;
  current=winner.execution;
 }
 return {ok:true,baselineCost,finalCost:current.cost,strictlyImproved:current.cost<baselineCost,
  proposal:best,execution:current,trace,evaluations,rounds,
  evidence:{initialProposalHash:sha(seed),finalProposalHash:sha(best),
   finalLedgerHash:current.evidence.ledgerDigest,traceHash:sha(trace)},
  truncated:maxEvaluations>0&&maxRounds>0&&evaluations>=maxEvaluations};
}
