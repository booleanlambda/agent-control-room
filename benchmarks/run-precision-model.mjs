#!/usr/bin/env node
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { planPrecisionSpecLocal } from '../workers/precision-local-model.js';
import { executePrecisionSpec } from '../workers/precision-engineer.js';

const corpusPath=new URL('./precision-engineer-v0.1.json',import.meta.url);
const corpus=JSON.parse(fs.readFileSync(corpusPath,'utf8'));
const model=String(process.env.PRECISION_LOCAL_MODEL||'').trim();
const endpoint=String(process.env.PRECISION_LOCAL_MODEL_ENDPOINT||'http://127.0.0.1:11434/api/generate').trim();
const protocol=String(process.env.PRECISION_LOCAL_MODEL_PROTOCOL||'ollama').trim();
if(!model) throw new Error('PRECISION_LOCAL_MODEL_required');

const rows=[];
for(const item of corpus.cases){
  const started=performance.now();
  try{
    const planned=await planPrecisionSpecLocal({
      endpoint,model,protocol,request:item.request,
      timeoutMs:Number(process.env.PRECISION_LOCAL_MODEL_TIMEOUT_MS||60000),
    });
    const result=executePrecisionSpec(planned.spec);
    rows.push({
      id:item.id,
      expected_status:item.expected_status,
      actual_status:result.status,
      passed:result.status===item.expected_status,
      verified:result.verified===true,
      mismatch_count:Array.isArray(result.mismatches)?result.mismatches.length:0,
      required_context:Array.isArray(result.required_context)?result.required_context:[],
      latency_ms:Math.round(performance.now()-started),
    });
  }catch(error){
    rows.push({
      id:item.id,
      expected_status:item.expected_status,
      actual_status:'ERROR',
      passed:false,
      error:String(error?.message||error).slice(0,300),
      latency_ms:Math.round(performance.now()-started),
    });
  }
}
const passed=rows.filter(row=>row.passed).length;
const verified=rows.filter(row=>row.verified).length;
const latencies=rows.map(row=>row.latency_ms).filter(Number.isFinite);
const report={
  schema:'aau.precision_benchmark_result.v0_1',
  model,
  endpoint,
  protocol,
  cases:rows.length,
  passed,
  pass_rate:rows.length?passed/rows.length:0,
  verified_cases:verified,
  mean_latency_ms:latencies.length?Math.round(latencies.reduce((a,b)=>a+b,0)/latencies.length):null,
  rows,
};
process.stdout.write(JSON.stringify(report,null,2)+'\n');
process.exit(passed===rows.length?0:4);
