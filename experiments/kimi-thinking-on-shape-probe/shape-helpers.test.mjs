import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeFinalStructure} from './shape-helpers.mjs';
test('nested shape metadata omits actual diagnosis and code text',()=>{
 const data={diagnosis:'PRIVATE_TEXT_CANARY',fixes:[{reason:'PRIVATE_VALUE',status:'safe'}],result:{edits:[{replacement:'PRIVATE_SOURCE'}]}};
 const nodes=summarizeFinalStructure(data);
 assert.deepEqual(nodes[0].keys,['diagnosis','fixes','result']);
 assert.equal(nodes.some(x=>x.path==='$.fixes'),true);
 const str=JSON.stringify(nodes);
 assert.equal(str.includes('PRIVATE_TEXT'),false);
 assert.equal(str.includes('PRIVATE_SOURCE'),false);
});
test('nonidentifier property names omitted from saved paths',()=>{
 const nodes=summarizeFinalStructure({'unsupported key with spaces':{someValue:'private'}});
 assert.deepEqual(nodes[0].keys,[]);
 assert.equal(nodes.length,1);
});
test('arrays and nested objects bounded at depth two',()=>{
 const data={payload:{items:Array.from({length:100},(_,i)=>({item:'private_'+i}))}};
 const nodes=summarizeFinalStructure(data);
 const items=nodes.find(x=>x.path==='$.payload.items');
 assert.equal(items.kind,'array');
 assert.equal(items.count,100);
 assert.equal(nodes.length<=28,true);
 assert.equal(JSON.stringify(nodes).includes('private_'),false);
});
