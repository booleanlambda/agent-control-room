// V22 shared research ledger. A completed *case* may have a nonzero certified
// gap; unlike V19 "exact root" rows it MUST NOT mean the case was proven optimal.
import {Pool} from 'pg';
const TARGET='br-cold-rice-b4m3l9qu';
export const config={maxExpansions:2200,maxFrontier:2400,warmEvaluations:400};
export function store(url){
 if(!url||!/^postgres(?:ql)?:\/\//.test(url))throw Error('NEON_ISOLATED_SECRET_REQUIRED');
 const pool=new Pool({connectionString:url,ssl:{rejectUnauthorized:true},max:4,
  connectionTimeoutMillis:10000,idleTimeoutMillis:5000,statement_timeout:25000,
  application_name:'AAU_V22_ISOLATED_QUEUE_BENCH'});
 return {
 async verify(){
  const x=await pool.query('select branch_id,marker from aau_research_v19.integration_scope');
  if(x.rows.length!==1||x.rows[0].branch_id!==TARGET||
    x.rows[0].marker!=='AAU_V20_ISOLATED_LIVE_WORKER')throw Error('PRODUCTION_OR_WRONG_NEON_BRANCH');
  const s=await pool.query("select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='aau_research_v22' and c.relkind='r' and c.relrowsecurity");
  if(s.rows[0].n!==3)throw Error('V22_SCHEMA_RLS_MISSING');
 },
 async init(run,mode,digest,entries){
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   await c.query('insert into aau_research_v22.runs(run_id,mode,fixture_digest,expected_cases,node_budget) values($1,$2,$3,9,2200)',[run,mode,digest]);
   for(const x of entries)await c.query(
    'insert into aau_research_v22.cases(run_id,id,input_digest) values($1,$2,$3)',[run,x.id,x.inputHash]);
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 },
 async claim(run,id,worker){
  const r=await pool.query('select * from aau_research_v22.claim($1,$2,$3,120)',[run,id,worker]);
  return {ok:r.rows[0].ok,epoch:Number(r.rows[0].epoch)};
 },
 async complete(run,id,worker,epoch,x){
  const r=await pool.query('select aau_research_v22.complete($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as result',
  [run,id,worker,epoch,x.lowerBound,x.upperBound,x.expanded,x.certificateDigest,x.witnessDigest,x.solverElapsedMs]);
  return r.rows[0].result;
 },
 async row(run,id){
  const r=await pool.query('select status,lower_bound,upper_bound,expanded from aau_research_v22.cases where run_id=$1 and id=$2',[run,id]);
  if(r.rows.length!==1)throw Error('UNKNOWN_CASE');
  return r.rows[0];
 },
 async cases(run){
  const r=await pool.query('select id,status,lower_bound,upper_bound,expanded,certificate_digest,witness_digest,attempts,fence,solver_elapsed_ms from aau_research_v22.cases where run_id=$1 order by id',[run]);
  return r.rows.map(x=>({...x,lower_bound:x.lower_bound===null?null:Number(x.lower_bound),
   upper_bound:x.upper_bound===null?null:Number(x.upper_bound),
   solver_elapsed_ms:x.solver_elapsed_ms===null?null:Number(x.solver_elapsed_ms),
   fence:Number(x.fence)}));
 },
 async summary(run){
  const r=await pool.query('select * from aau_research_v22.summary($1)',[run]);
  if(r.rows.length!==1)throw Error('V22_SUMMARY_MISSING');
  const x=r.rows[0];
  return {mode:x.mode,total:x.total,complete:x.complete,pending:x.pending,
   gapSum:Number(x.summed_gap),optimalCases:x.optimal_cases,
   expansions:Number(x.sum_expanded)};
 },
 async close(){await pool.end()}
 };
}
