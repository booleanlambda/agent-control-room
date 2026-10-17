// AAU V20 isolated Neon branch only. This adapter does not own proof arithmetic:
// deterministic V6/V7 decides feasible complete partition minima.
import {Pool} from 'pg';
export const BRANCH='br-cold-rice-b4m3l9qu';
const MARKER='AAU_V20_ISOLATED_LIVE_WORKER';
export function newStore(url){
 if(!url||!/^postgres(?:ql)?:\/\//.test(url))throw Error('ISOLATED_NEON_SECRET_UNAVAILABLE');
 const pool=new Pool({connectionString:url,ssl:{rejectUnauthorized:true},
  max:2,connectionTimeoutMillis:10000,idleTimeoutMillis:5000,
  statement_timeout:12000,application_name:'AAU_V20_ISOLATED_RESEARCH'});
 return {
  async verify(){
   const r=await pool.query('select branch_id,marker from aau_research_v19.integration_scope');
   if(r.rows.length!==1||r.rows[0].branch_id!==BRANCH||r.rows[0].marker!==MARKER)
    throw Error('NEON_RESEARCH_BRANCH_SCOPE_MISMATCH');
  },
  async init(run,hash,baseline,roots){
   const c=await pool.connect();
   try{
    await c.query('BEGIN');
    await c.query('insert into aau_research_v19.runs(run_id,problem_hash,expected_roots,incumbent) values($1,$2,$3,$4)',
     [run,hash,roots.length,baseline]);
    for(const root of roots)
     await c.query('insert into aau_research_v19.branches(run_id,id,root_hash) values($1,$2,$3)',
      [run,root.id,root.rootHash]);
    await c.query('COMMIT');
   }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
  },
  async row(run,id){
   const r=await pool.query('select status,exact_cost,leaves,receipt from aau_research_v19.branches where run_id=$1 and id=$2',[run,id]);
   if(r.rowCount!==1)throw Error('UNKNOWN_RESEARCH_BRANCH_ROOT');
   return r.rows[0];
  },
  async claim(run,id,worker,seconds=90){
   const r=await pool.query('select ok,epoch from aau_research_v19.claim($1,$2,$3,$4)',[run,id,worker,seconds]);
   return {ok:r.rows[0].ok,epoch:Number(r.rows[0].epoch)};
  },
  async complete(run,id,worker,epoch,cost,leaves,receipt){
   const r=await pool.query('select aau_research_v19.complete($1,$2,$3,$4,$5,$6,$7) as result',
    [run,id,worker,epoch,cost,leaves,receipt]);
   return r.rows[0].result;
  },
  async summary(run){
   const r=await pool.query('select * from aau_research_v19.summary($1)',[run]);
   if(r.rows.length!==1)throw Error('NEON_RESEARCH_PROOF_SUMMARY_MISSING');
   const x=r.rows[0];
   return {total:x.total,completed:x.completed,pending:x.pending,
    lower:Number(x.lower_bound),upper:Number(x.upper_bound),gap:Number(x.gap),optimal:x.optimal};
  },
  async rows(run){
   const r=await pool.query('select id,status,exact_cost,leaves,receipt,attempts,fence from aau_research_v19.branches where run_id=$1 order by id',[run]);
   return r.rows.map(x=>({...x,exact_cost:x.exact_cost===null?null:Number(x.exact_cost),
    leaves:x.leaves===null?null:Number(x.leaves),fence:Number(x.fence)}));
  },
  async close(){await pool.end();}
 };
}
