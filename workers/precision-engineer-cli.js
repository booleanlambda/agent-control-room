#!/usr/bin/env node
import fs from 'node:fs';
import { executePrecisionSpec } from './precision-engineer.js';

try{
  const input=fs.readFileSync(0,'utf8');
  const spec=JSON.parse(input||'{}');
  const result=executePrecisionSpec(spec);
  process.stdout.write(JSON.stringify(result));
  process.exit(result.status==='VERIFIED'?0:result.status==='RECONCILE'?3:2);
}catch(error){
  process.stdout.write(JSON.stringify({
    schema:'aau.precision_result.v0_1',
    engine:'aau_precision_engineer_v0_1',
    status:'ESCALATE',
    verified:false,
    reason:'precision_cli_failure',
    error:String(error?.message||error).slice(0,500),
  }));
  process.exit(2);
}
