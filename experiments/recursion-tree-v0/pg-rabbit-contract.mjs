// Real local PostgreSQL + RabbitMQ, *never* the AAU production database.
// This module is only used in the isolated GitHub Actions service-containers lab.
import pg from 'pg';
import {createHash} from 'node:crypto';
import {authenticateDeep,deepConfig,lightModelDouble,newDeepTree} from './depth10-traversability.mjs';
import {auditCognitiveTree,scriptedSynthesis} from './cognitive-integrity.mjs';
import {bindAndAuthenticateSynthesis} from './synthesis-slots.mjs';
import {recordedKimiSynthesis,SOURCE} from './kimi-k26-recorded-replay.mjs';

export const RUN='real-two-worker-spine';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function pool(){
  const url=process.env.TEST_PG_URL||'';
  const u=new URL(url);
  if(!['localhost','127.0.0.1'].includes(u.hostname)||!['recursion_lab','postgres'].includes(u.pathname.slice(1))||
    process.env.AAU_DISPOSABLE_CI_DB!=='yes')throw Error('NON_DISPOSABLE_DB_FORBIDDEN');
  return new pg.Pool({connectionString:url,max:6,connectionTimeoutMillis:4000});
}
export async function tx(pool,cb){
  const c=await pool.connect();
  try{await c.query('BEGIN');const x=await cb(c);await c.query('COMMIT');return x;}
  catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
  finally{c.release();}
}
export async function setup(p){
  await p.query('DROP SCHEMA IF EXISTS recursion_ci CASCADE');
  await p.query(`
CREATE SCHEMA recursion_ci;
CREATE TABLE recursion_ci.runs(
 id text PRIMARY KEY,budget integer NOT NULL CHECK(budget>=0),
 spent integer NOT NULL DEFAULT 0 CHECK(spent>=0),
 calls integer NOT NULL DEFAULT 0 CHECK(calls>=0),
 CHECK(spent<=budget));
CREATE TABLE recursion_ci.nodes(
 run_id text NOT NULL REFERENCES recursion_ci.runs(id),path text NOT NULL,
 parent_path text,depth integer NOT NULL,from_i integer NOT NULL,to_i integer NOT NULL,
 status text NOT NULL DEFAULT 'pending', generation integer NOT NULL DEFAULT 0,
 leased_until timestamptz, attempt_count integer NOT NULL DEFAULT 0,
 result jsonb,digest text, worker_id text,
 PRIMARY KEY(run_id,path),CHECK(from_i<to_i));
CREATE TABLE recursion_ci.outbox(
 run_id text NOT NULL,path text NOT NULL,published_count integer NOT NULL DEFAULT 0,
 PRIMARY KEY(run_id,path),
 FOREIGN KEY(run_id,path) REFERENCES recursion_ci.nodes(run_id,path));
CREATE TABLE recursion_ci.inbox(
 run_id text NOT NULL,path text NOT NULL,answer jsonb NOT NULL,digest text NOT NULL,
 PRIMARY KEY(run_id,path),
 FOREIGN KEY(run_id,path) REFERENCES recursion_ci.nodes(run_id,path));
CREATE TABLE recursion_ci.charges(
 run_id text NOT NULL,path text NOT NULL,generation integer NOT NULL,units integer NOT NULL,
 PRIMARY KEY(run_id,path,generation));
CREATE TABLE recursion_ci.commits(
 run_id text NOT NULL,path text NOT NULL,kind text NOT NULL,
 digest text, worker_id text NOT NULL,
 PRIMARY KEY(run_id,path),
 FOREIGN KEY(run_id,path) REFERENCES recursion_ci.nodes(run_id,path));
CREATE TABLE recursion_ci.syntheses(
 run_id text NOT NULL,path text NOT NULL,proof jsonb NOT NULL,
 PRIMARY KEY(run_id,path),
 FOREIGN KEY(run_id,path) REFERENCES recursion_ci.nodes(run_id,path));`);
}
export async function seed(p,run=RUN,{budget=55000}={}){
  await tx(p,async c=>{
    await c.query('INSERT INTO recursion_ci.runs(id,budget) VALUES($1,$2)',[run,budget]);
    await c.query('INSERT INTO recursion_ci.nodes(run_id,path,depth,from_i,to_i) VALUES($1,$2,0,0,11)',[run,'R']);
    await c.query('INSERT INTO recursion_ci.outbox(run_id,path) VALUES($1,$2)',[run,'R']);
  });
}
export async function claim(p,run,path,worker,{leaseMs=500}={}){
  return tx(p,async c=>{
    const q=await c.query('SELECT * FROM recursion_ci.nodes WHERE run_id=$1 AND path=$2 FOR UPDATE',[run,path]);
    if(!q.rowCount)return {status:'missing'};
    const n=q.rows[0];
    if(n.status==='split'||n.status==='complete')return {status:'already_accepted'};
    if(n.status!=='pending')return {status:'blocked'};
    // Provider-side execution can outlive a DB outage. A durable request
    // intent prevents even an otherwise valid broker redelivery from
    // blindly creating a second external generation and charge.
    // The relation is optional so older/independent CI experiments keep
    // their original schema and behavior without migrations.
    const relation=await c.query("SELECT to_regclass('recursion_ci.provider_requests') AS reg");
    if(relation.rows[0]?.reg){
      const pendingProvider=await c.query(`SELECT state FROM recursion_ci.provider_requests
        WHERE run_id=$1 AND path=$2`,[run,path]);
      if(pendingProvider.rowCount){
        return {status:'external_request_reconciliation_required',
          providerState:pendingProvider.rows[0].state};
      }
    }
    if(n.leased_until&&new Date(n.leased_until).getTime()>Date.now())return {status:'busy'};
    const generation=n.generation+1;
    const response=await c.query('SELECT answer FROM recursion_ci.inbox WHERE run_id=$1 AND path=$2',[run,path]);
    const cached=Boolean(response.rowCount);
    if(!cached){
      const cost=600;
      const debit=await c.query(
        'UPDATE recursion_ci.runs SET spent=spent+$2,calls=calls+1 WHERE id=$1 AND spent+$2<=budget RETURNING spent',
        [run,cost]);
      if(!debit.rowCount){
        await c.query("UPDATE recursion_ci.nodes SET status='blocked' WHERE run_id=$1 AND path=$2",[run,path]);
        return {status:'budget_denied'};
      }
      await c.query('INSERT INTO recursion_ci.charges(run_id,path,generation,units) VALUES($1,$2,$3,$4)',[run,path,generation,cost]);
    }
    await c.query(`UPDATE recursion_ci.nodes SET generation=$3,
      leased_until=now()+($4::integer*interval '1 millisecond'),
      attempt_count=attempt_count+CASE WHEN $5 THEN 0 ELSE 1 END,worker_id=$6
      WHERE run_id=$1 AND path=$2`,[run,path,generation,leaseMs,cached,worker]);
    return {status:'claimed',path,run,worker,generation,cached,node:{
      path,depth:n.depth,start:n.from_i,end:n.to_i,children:[],
    },answer:cached?response.rows[0].answer:null};
  });
}
export async function journal(p,receipt,answer){
  return tx(p,async c=>{
    const n=await c.query('SELECT * FROM recursion_ci.nodes WHERE run_id=$1 AND path=$2 FOR UPDATE',[receipt.run,receipt.path]);
    if(!n.rowCount||n.rows[0].generation!==receipt.generation||
       n.rows[0].status!=='pending'||
       new Date(n.rows[0].leased_until).getTime()<=Date.now())
      return {status:'stale'};
    const digest=sha(answer);
    const q=await c.query(`INSERT INTO recursion_ci.inbox(run_id,path,answer,digest)
      VALUES($1,$2,$3::jsonb,$4) ON CONFLICT DO NOTHING RETURNING path`,
      [receipt.run,receipt.path,JSON.stringify(answer),digest]);
    if(!q.rowCount){
      const old=await c.query('SELECT digest FROM recursion_ci.inbox WHERE run_id=$1 AND path=$2',[receipt.run,receipt.path]);
      if(old.rows[0].digest!==digest)throw Error('CONFLICTING_JOURNALED_RESPONSE');
    }
    return {status:q.rowCount?'journaled':'already_journaled'};
  });
}
export async function commit(p,receipt){
  return tx(p,async c=>{
    const n=await c.query('SELECT * FROM recursion_ci.nodes WHERE run_id=$1 AND path=$2 FOR UPDATE',[receipt.run,receipt.path]);
    if(!n.rowCount)return {status:'missing'};
    const row=n.rows[0];
    if(row.status!=='pending')return {status:'already_accepted'};
    if(row.generation!==receipt.generation||!row.leased_until||
      new Date(row.leased_until).getTime()<=Date.now())return {status:'stale_fence'};
    const q=await c.query('SELECT * FROM recursion_ci.inbox WHERE run_id=$1 AND path=$2',[receipt.run,receipt.path]);
    if(!q.rowCount)return {status:'missing_response'};
    const answer=q.rows[0].answer;
    const v=authenticateDeep({path:row.path,depth:row.depth,start:row.from_i,end:row.to_i},answer,deepConfig('spine',55000));
    if(!v.ok)throw Error('AUTHENTICATOR_REJECTED:'+v.reason);
    if(v.action==='SPLIT'){
      const children=[[receipt.path+'.001',row.from_i,v.splitAt],
        [receipt.path+'.002',v.splitAt,row.to_i]];
      for(const [path,start,end] of children){
        await c.query(`INSERT INTO recursion_ci.nodes(run_id,path,parent_path,depth,from_i,to_i)
          VALUES($1,$2,$3,$4,$5,$6)`,
          [receipt.run,path,receipt.path,row.depth+1,start,end]);
        await c.query('INSERT INTO recursion_ci.outbox(run_id,path) VALUES($1,$2)',[receipt.run,path]);
      }
      await c.query(`UPDATE recursion_ci.nodes SET status='split',leased_until=NULL
        WHERE run_id=$1 AND path=$2`,[receipt.run,receipt.path]);
    }else{
      await c.query(`UPDATE recursion_ci.nodes SET status='complete',result=$3::jsonb,
        digest=$4,leased_until=NULL WHERE run_id=$1 AND path=$2`,
        [receipt.run,receipt.path,JSON.stringify(v.result),v.hash]);
    }
    await c.query('INSERT INTO recursion_ci.commits(run_id,path,kind,digest,worker_id) VALUES($1,$2,$3,$4,$5)',
      [receipt.run,receipt.path,v.action,v.action==='ATOMIC'?v.hash:null,receipt.worker]);
    // Terminate the actual worker OS process before COMMIT; PostgreSQL must
    // rollback parent/children/outbox/event changes atomically.
    if(receipt.path==='R'&&process.env.AAU_INJECT_SQL_CRASH==='yes'&&
      process.env.AAU_DISPOSABLE_CI_DB==='yes'){
      console.log('INJECTED_SQL_TRANSACTION_CRASH_BEFORE_COMMIT');
      process.exit(89);
    }
    return {status:v.action==='SPLIT'?'split':'complete'};
  });
}
export async function outbox(p,run=RUN){
  const r=await p.query(`SELECT o.path,o.published_count FROM recursion_ci.outbox o
    JOIN recursion_ci.nodes n USING(run_id,path)
    WHERE o.run_id=$1 AND o.published_count<2 AND n.status<>'blocked' ORDER BY n.depth,o.path`,[run]);
  return r.rows;
}
export async function published(p,run,path){
  await p.query('UPDATE recursion_ci.outbox SET published_count=2 WHERE run_id=$1 AND path=$2',[run,path]);
}
export async function metrics(p,run=RUN){
  const [nodes,runRow,charges,commits,inbox,workers,syntheses]=await Promise.all([
    p.query('SELECT status,count(*)::integer n FROM recursion_ci.nodes WHERE run_id=$1 GROUP BY status',[run]),
    p.query('SELECT * FROM recursion_ci.runs WHERE id=$1',[run]),
    p.query('SELECT coalesce(sum(units),0)::integer as units,count(*)::integer n FROM recursion_ci.charges WHERE run_id=$1',[run]),
    p.query('SELECT count(*)::integer n FROM recursion_ci.commits WHERE run_id=$1',[run]),
    p.query('SELECT count(*)::integer n FROM recursion_ci.inbox WHERE run_id=$1',[run]),
    p.query('SELECT count(DISTINCT worker_id)::integer n FROM recursion_ci.commits WHERE run_id=$1',[run]),
    p.query('SELECT count(*)::integer n FROM recursion_ci.syntheses WHERE run_id=$1',[run])]);
  return {statuses:Object.fromEntries(nodes.rows.map(x=>[x.status,x.n])),
    spent:runRow.rows[0].spent,budget:runRow.rows[0].budget,
    providerCalls:runRow.rows[0].calls,chargeSum:charges.rows[0].units,
    chargeCount:charges.rows[0].n,commits:commits.rows[0].n,
    journaled:inbox.rows[0].n,distinctCommitWorkers:workers.rows[0].n,
    syntheses:syntheses.rows[0].n};
}
export async function reconstructedTree(p,run=RUN){
  const r=await p.query('SELECT * FROM recursion_ci.nodes WHERE run_id=$1 ORDER BY depth,path',[run]);
  const t=newDeepTree({...deepConfig('spine',55000),maxCalls:126});
  t.nodes={};t.queue=[];
  for(const row of r.rows)t.nodes[row.path]={
    path:row.path,parent:row.parent_path,depth:row.depth,start:row.from_i,end:row.to_i,
    children:[],status:row.status,attempts:0,result:row.result,hash:row.digest};
  for(const n of Object.values(t.nodes))if(n.parent)t.nodes[n.parent].children.push(n.path);
  for(const n of Object.values(t.nodes))n.children.sort();
  const m=await metrics(p,run);t.spent=m.spent;t.calls=m.providerCalls;
  const charges=await p.query('SELECT path,units FROM recursion_ci.charges WHERE run_id=$1 ORDER BY path,generation',[run]);
  t.ledger=charges.rows.map((c,i)=>({id:'ci-'+(i+1),path:c.path,kind:'reserved',units:c.units}));
  t.seq=t.ledger.length;
  t.complete=Object.values(t.nodes).every(n=>n.status==='split'||n.status==='complete');
  return t;
}
export async function synthesize(p,run=RUN){
  const tree=await reconstructedTree(p,run);
  const audited=auditCognitiveTree(tree);
  if(!audited.complete)throw Error('CANNOT_SYNTHESIZE_UNVERIFIED_TREE');
  const accepted=new Map();
  const parents=Object.values(tree.nodes).filter(n=>n.status==='split').sort((a,b)=>b.depth-a.depth);
  for(const n of parents){
    const children=n.children.map(k=>accepted.get(k)||audited.proofs[k]);
    const answer=recordedKimiSynthesis(n,children);
    const bound=bindAndAuthenticateSynthesis(n,answer,children);
    if(!bound.ok)throw Error('PARENT_REJECTED:'+n.path+':'+bound.reason);
    // Simulated crash after DB commit before app-level acknowledgment: repeat
    // the same insert. Database PK gives one durable proof per parent.
    for(let replay=0;replay<(n.depth===9?2:1);replay++){
      const q=await p.query(`INSERT INTO recursion_ci.syntheses(run_id,path,proof)
         VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING RETURNING path`,
         [run,n.path,JSON.stringify(bound.proof)]);
      if(replay===0&&!q.rowCount)throw Error('UNEXPECTED_SYNTHESIS_DUPLICATE');
      if(replay===1&&q.rowCount)throw Error('SYNTHESIS_DUPLICATED');
    }
    accepted.set(n.path,bound.proof);
  }
  if(accepted.get('R')?.digest!==SOURCE.rootDigest)throw Error('ROOT_PROOF_DRIFT');
  return {rootDigest:accepted.get('R').digest,parents:accepted.size};
}
