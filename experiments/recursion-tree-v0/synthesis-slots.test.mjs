import test from 'node:test';
import assert from 'node:assert/strict';
import {newDeepTree,deepConfig,executeDeep} from './depth10-traversability.mjs';
import {auditCognitiveTree,scriptedSynthesis} from './cognitive-integrity.mjs';
import {bindAndAuthenticateSynthesis} from './synthesis-slots.mjs';

const make=async()=>{
  const tree=newDeepTree(deepConfig('spine',50000));await executeDeep(tree);
  const proof=auditCognitiveTree(tree);
  assert.equal(proof.complete,true);
  const parentPath='R'+'.002'.repeat(9);
  const parent=tree.nodes[parentPath];
  const children=parent.children.map(path=>proof.proofs[path]);
  const accepted=scriptedSynthesis(parent,children);
  return {tree,parent,children,accepted};
};

test('deep child paths never need to be copied by a model',async()=>{
  const {parent,children,accepted}=await make();
  const model={summary:'Verified first stage synthesis',slots:[0,1],
    covered:accepted.covered,counts:accepted.counts};
  const result=bindAndAuthenticateSynthesis(parent,model,children);
  assert.equal(result.ok,true);
  assert.deepEqual(result.proposal.children,children.map(c=>({path:c.path,digest:c.digest})));
  assert.equal(result.proof.childEvidence.length,2);
  assert.ok(result.proof.digest);
});

test('missing, duplicated, reversed and invented child slot references fail closed',async()=>{
  const {parent,children,accepted}=await make();
  for(const slots of [[],[0],[0,0],[1,0],[0,2],['0','1'],[0,1,2]]){
    const v=bindAndAuthenticateSynthesis(parent,{slots,
      summary:'test',covered:accepted.covered,counts:accepted.counts},children);
    assert.equal(v.reason,'slot_coverage_invalid');
  }
});

test('model-written long paths or digests remain forbidden even when plausible',async()=>{
  const {parent,children,accepted}=await make();
  for(const extra of [{children:children.map(c=>({path:c.path,digest:c.digest}))},
    {path:parent.path},{digest:'f'.repeat(64)}]){
    const v=bindAndAuthenticateSynthesis(parent,{summary:'test',slots:[0,1],
      covered:accepted.covered,counts:accepted.counts,...extra},children);
    assert.equal(v.reason,'model_authored_provenance_forbidden');
  }
});

test('model cannot forge aggregate counts or coverage with valid slots',async()=>{
  const {parent,children,accepted}=await make();
  const inflated={...accepted.counts,budget:accepted.counts.budget+1};
  assert.equal(bindAndAuthenticateSynthesis(parent,{
    summary:'good',slots:[0,1],counts:inflated,covered:accepted.covered,
  },children).reason,'aggregate_count_mismatch');
  assert.equal(bindAndAuthenticateSynthesis(parent,{
    summary:'good',slots:[0,1],counts:accepted.counts,covered:5,
  },children).reason,'aggregate_coverage_mismatch');
});

test('empty synthesis and invalid child evidence still fail despite slot validation',async()=>{
  const {parent,children,accepted}=await make();
  const answer={summary:' ',slots:[0,1],counts:accepted.counts,covered:accepted.covered};
  assert.equal(bindAndAuthenticateSynthesis(parent,answer,children).reason,'empty_synthesis');
  const bad=[{...children[0],accepted:false},children[1]];
  assert.equal(bindAndAuthenticateSynthesis(parent,{...answer,summary:'good'},bad).reason,
    'missing_verified_children');
});

test('runtime-provided stale digest is NOT silently corrected to a trusted result',async()=>{
  const {parent,children,accepted}=await make();
  const wrong=[{...children[0],digest:'0'.repeat(64)},children[1]];
  // A wrong provided digest cannot be authenticated against a globally trusted
  // checkpoint until caller verifies the checkpoint. The adapter only checks
  // child proofs it was given; it does not invent a stronger oracle.
  const a=bindAndAuthenticateSynthesis(parent,{summary:'good',slots:[0,1],
    counts:accepted.counts,covered:accepted.covered},wrong);
  assert.equal(a.ok,true);
  assert.notEqual(a.proof.digest,bindAndAuthenticateSynthesis(parent,{
    summary:'good',slots:[0,1],counts:accepted.counts,covered:accepted.covered,
  },children).proof.digest);
});
