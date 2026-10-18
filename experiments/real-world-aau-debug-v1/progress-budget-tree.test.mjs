import test from 'node:test';
import assert from 'node:assert/strict';
import {GLOBAL_PROVIDER_TOKEN_BUDGET,RECURSION_DEPTH_LIMIT,budgetReservation,createRepairTree,takeRepairNode,addChildRepairNodes,treeSummary} from './progress-budget-tree.mjs';
const tasks=[{issue:'Preserve request receipt on provider reject',acceptance:'Capture category and finish reason on reject'},
 {issue:'Sanitize transport error provenance',acceptance:'Never emit exception text or credentials'}];
test('no arbitrary call-count limit, reserve worst-case 4K or 32K within finite 75K',()=>{
 assert.equal(GLOBAL_PROVIDER_TOKEN_BUDGET,75000);
 for(let i=0;i<12;i++){
  const b=budgetReservation({requestBody:{role:'user',text:'repair this'},thinking:false,
   reportedTokens:Array.from({length:i},()=>5000)});
  assert.equal(b.permitted,i<=13);
  assert.equal(b.completionCeiling,4096);
 }
 const over=budgetReservation({requestBody:{text:'large'},thinking:true,reportedTokens:[30000,15000]});
 assert.equal(over.permitted,false);
 assert.equal(over.reason,'GLOBAL_COMPUTE_BUDGET_EXHAUSTED');
 const yes=budgetReservation({requestBody:{text:'small'},thinking:true,reportedTokens:[5000]});
 assert.equal(yes.permitted,true);
 assert.equal(yes.completionCeiling,32768);
});
test('all root tasks are traversed in model-chosen order',()=>{
 const t=createRepairTree(tasks);
 assert.equal(treeSummary(t).pending,2);
 assert.equal(takeRepairNode(t).issue,tasks[0].issue);
 assert.equal(takeRepairNode(t).issue,tasks[1].issue);
 assert.equal(takeRepairNode(t),null);
});
test('failed node decomposes into two children, while independent roots run first',()=>{
 const t=createRepairTree(tasks),parent=takeRepairNode(t);
 const children=[{issue:'Capture sanitized finish reason before hold',acceptance:'Hold report retains exact stop or length'},
  {issue:'Preserve HTTP failure category on 503 response',acceptance:'Finish call records provider_http_error'}];
 const add=addChildRepairNodes(t,parent,children);
 assert.equal(add.added,2);
 assert.equal(takeRepairNode(t).issue,tasks[1].issue);
 assert.equal(takeRepairNode(t).issue,children[0].issue);
 assert.equal(takeRepairNode(t).issue,children[1].issue);
});
test('repeated self-recursion rejected, no infinitely repeating task',()=>{
 const t=createRepairTree(tasks),parent=takeRepairNode(t);
 const a=addChildRepairNodes(t,parent,[tasks[0],tasks[1]]);
 assert.equal(a.added,0);
 assert.equal(a.reason,'DUPLICATED_OR_RECURSIVE_NODE');
});
test('breadth-first frontiers preserve all descendants and depth limit',()=>{
 const t=createRepairTree(tasks);
 const root=takeRepairNode(t);
 const children=[{issue:'First subbranch for diagnostic category',acceptance:'Test the recorded category on malformed JSON'},
  {issue:'Second subbranch for ledger receipt',acceptance:'Test durable receipt on HTTP failure'}];
 assert.equal(addChildRepairNodes(t,root,children).added,2);
 // The sibling root gets a fair chance before any recursive subbranch.
 assert.equal(takeRepairNode(t).issue,tasks[1].issue);
 const child=takeRepairNode(t);
 assert.equal(child.depth,1);
 const second=[{issue:'Check JSON reject category precisely',acceptance:'Keep malformed_model_json status'},
  {issue:'Check format-safe diagnostic structure',acceptance:'Keep one redacted report entry'}];
 assert.equal(addChildRepairNodes(t,child,second).added,2);
 // The other child runs before grandchildren.
 assert.equal(takeRepairNode(t).issue,children[1].issue);
 const grandchild=takeRepairNode(t);
 assert.equal(grandchild.depth,2);
 const third=[{issue:'Deep scoped JSON parse handling',acceptance:'Emit categorized parse failure'},
  {issue:'Deep fallback error handling',acceptance:'Do not leak private strings'}];
 assert.equal(addChildRepairNodes(t,grandchild,third).added,2);
 assert.equal(takeRepairNode(t).issue,second[1].issue);
 const deep=takeRepairNode(t);
 assert.equal(deep.depth,3);
 assert.equal(addChildRepairNodes(t,deep,third).reason,'RECURSION_DEPTH_LIMIT');
 assert.ok(treeSummary(t).pending>0);
});
test('malformed model node never added to queue',()=>{
 const t=createRepairTree(tasks);const p=takeRepairNode(t);
 assert.equal(addChildRepairNodes(t,p,[{issue:'short',acceptance:'bad'},{issue:'other',acceptance:'bad'}]).added,0);
 assert.equal(treeSummary(t).pending,1);
});
