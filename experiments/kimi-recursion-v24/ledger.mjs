// V24 isolated Neon cognitive-thread ledger and transactional outbox.
// RabbitMQ transports phase-ready notifications; PostgreSQL owns the phase.
import {Pool} from 'pg';
export function createLedger(connectionString){
 if(!/^postgres(?:ql)?:\/\//.test(connectionString||''))throw Error('ISOLATED_DATABASE_SECRET_MISSING');
 const pool=new Pool({connectionString,ssl:{rejectUnauthorized:true},
  max:2,connectionTimeoutMillis:10000,statement_timeout:15000,
  application_name:'AAU_V24_SINGLE_COGNITIVE_THREAD'});
 return {
  async verify(){
   const r=await pool.query('select branch_id,marker from aau_research_v19.integration_scope');
   if(r.rows.length!==1||r.rows[0].branch_id!=='br-cold-rice-b4m3l9qu'||
      r.rows[0].marker!=='AAU_V20_ISOLATED_LIVE_WORKER')
     throw Error('NEON_BRANCH_SCOPE_INVALID');
   const s=await pool.query("select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='aau_research_v23' and c.relkind='r' and c.relrowsecurity");
   if(s.rows[0].n!==4)throw Error('RESEARCH_RLS_NOT_ENABLED');
  },
  async init(run,problemHash){
   const c=await pool.connect();
   try{
    await c.query('BEGIN');
    await c.query("insert into aau_research_v23.runs(run_id,benchmark_hash,next_phase,state) values($1,$2,'level_0',$3::jsonb)",
      [run,problemHash,JSON.stringify({nodes:[],levelIndex:0,maxDepthReached:0,verifiedDepth:0,repairs:[],providerCalls:0,providerTokens:0,results:{},source:null,acceptedSource:null,levelHistory:[],levelLogs:[],repairCounts:{}})]);
    await c.query('insert into aau_research_v23.outbox(run_id,seq) values($1,0)',[run]);
    await c.query('COMMIT');
   }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
  },
  async read(run){
   const r=await pool.query('select seq,next_phase,status,state,benchmark_hash from aau_research_v23.runs where run_id=$1',[run]);
   if(r.rows.length!==1)throw Error('UNKNOWN_RESEARCH_RUN');
   return r.rows[0];
  },
  async undelivered(run){
   const r=await pool.query('select id,seq from aau_research_v23.outbox where run_id=$1 and published_at is null order by seq',[run]);
   return r.rows;
  },
  async published(id){
   await pool.query('update aau_research_v23.outbox set published_at=clock_timestamp() where id=$1 and published_at is null',[id]);
  },
  async advance(run,expectedSeq,expectedPhase,nextPhase,status,state,event){
   const c=await pool.connect();
   try{
    await c.query('BEGIN');
    const r=await c.query('select seq,next_phase,status from aau_research_v23.runs where run_id=$1 for update',[run]);
    if(r.rows.length!==1)throw Error('UNKNOWN_RESEARCH_RUN');
    const now=r.rows[0];
    if(now.seq!==expectedSeq||now.next_phase!==expectedPhase||now.status!=='running'){
      await c.query('ROLLBACK');return 'DUPLICATE_OR_STALE_PHASE';
    }
    if(nextPhase===null&&status==='running')throw Error('INVALID_TERMINAL_STATUS');
    if(nextPhase!==null&&status!=='running')throw Error('INVALID_RUNNING_STATUS');
    await c.query('update aau_research_v23.runs set seq=seq+1,next_phase=$2,status=$3,state=$4::jsonb,updated_at=clock_timestamp() where run_id=$1',
      [run,nextPhase,status,JSON.stringify(state)]);
    await c.query('insert into aau_research_v23.events(run_id,seq,phase,details) values($1,$2,$3,$4::jsonb)',
      [run,expectedSeq,expectedPhase,JSON.stringify(event)]);
    if(nextPhase!==null)await c.query('insert into aau_research_v23.outbox(run_id,seq) values($1,$2)',[run,expectedSeq+1]);
    await c.query('COMMIT');return 'COMMITTED';
   }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}
  },
  async events(run){
   const r=await pool.query('select seq,phase,details from aau_research_v23.events where run_id=$1 order by seq',[run]);
   return r.rows;
  },
  async beginCall(run,phase,attempt,digest){
   const r=await pool.query(
    'insert into aau_research_v23.calls(run_id,phase,attempt,model_request_hash) values($1,$2,$3,$4) on conflict do nothing returning run_id',
    [run,phase,attempt,digest]);
   if(r.rowCount!==1)throw Error('AMBIGUOUS_MODEL_CALL_ALREADY_RECORDED');
  },
  async finishCall(run,phase,attempt,status,tokens,finish,responseHash){
   const r=await pool.query(
    'update aau_research_v23.calls set status=$4,provider_tokens=$5,finish_reason=$6,response_hash=$7 where run_id=$1 and phase=$2 and attempt=$3 and status=$8',
    [run,phase,attempt,status,tokens,finish,responseHash,'sent_or_uncertain']);
   if(r.rowCount!==1)throw Error('MODEL_CALL_PROVENANCE_CONFLICT');
  },
  async callLog(run){
   const r=await pool.query('select phase,attempt,status,provider_tokens,finish_reason,response_hash from aau_research_v23.calls where run_id=$1 order by created_at',[run]);return r.rows;
  },
  async close(){await pool.end()}
 };
}
