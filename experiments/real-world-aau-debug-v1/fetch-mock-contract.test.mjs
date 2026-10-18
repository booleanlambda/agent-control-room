import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const legacy=readFileSync(new URL('./legacy-model-source.txt',import.meta.url),'utf8');
const anchor="const j=await res.json().catch(()=>({}));";
test('mock accurately supports valid Fetch response.text JSON parsing',()=>{
 assert.equal(legacy.split(anchor).length,2);
 // Test interface compatibility, not a gold solution for the historical bug.
 const usingText=legacy.replace(anchor,"const j=JSON.parse(await res.text());");
 const temp=mkdtempSync(path.join(tmpdir(),'aau-fetchmock-'));
 const source=path.join(temp,'source.js');writeFileSync(source,usingText);
 const run=spawnSync(process.execPath,[new URL('./verify-candidate.mjs',import.meta.url).pathname,
  'public',source],{encoding:'utf8',timeout:12000});
 const records=run.stdout.split('\n').filter(Boolean).flatMap(line=>{
  try{return [JSON.parse(line)]}catch{return []}
 });
 assert.equal(records.find(r=>r.case==='received')?.passed,true,
  'A valid response must not fail merely because a patch uses response.text()');
 const failing=records.filter(r=>r.case&&r.passed===false);
 assert.ok(failing.length>=1,'Interface test must not hide the historical defect');
});
test('runtime mock exposes json and text for successful and failed HTTP responses',()=>{
 const src=readFileSync(new URL('./verify-candidate.mjs',import.meta.url),'utf8');
 assert.match(src,/json:async\(\)=>structuredClone\(body\)/);
 assert.match(src,/text:async\(\)=>JSON\.stringify\(body\)/);
 assert.match(src,/reply:response\(\{error:/);
});
