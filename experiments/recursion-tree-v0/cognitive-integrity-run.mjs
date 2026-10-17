// Standalone cognitive-integrity attack report, no model calls or live DB.
import {writeFileSync} from 'node:fs';
import {deepConfig,newDeepTree,lightModelDouble,executeDeep} from './depth10-traversability.mjs';
import {auditCognitiveTree,scriptedSynthesis} from './cognitive-integrity.mjs';

const summary=(name,a,s)=>({
  scenario:name,
  certified:a.complete,rootDigest:a.rootDigest,
  accepted:a.accepted,acceptedLeaves:a.acceptedLeaves,
  acceptedParents:a.acceptedParents,rejected:a.rejected,
  inspected:a.traversed,
  errors:[...a.preflightErrors,...a.rejectedNodes].slice(0,16),
  calls:s.calls,debited:s.spent,budget:s.config.budget,
});
const base=newDeepTree(deepConfig('balanced',1800000));
await executeDeep(base);
const ok=auditCognitiveTree(base);
if(!ok.complete||ok.accepted!==2047)throw Error('baseline_not_authenticated');
const rows=[summary('clean_2047_nodes',ok,base)];

const brokenChild=structuredClone(base);
delete brokenChild.nodes['R.002.002.002.002.002.002.002.002.002.002'];
const auditMissing=auditCognitiveTree(brokenChild);
if(auditMissing.complete)throw Error('missing_child_false_accept');
rows.push(summary('missing_child_depth10',auditMissing,brokenChild));

const empty=auditCognitiveTree(base,{proposeSynthesis:(node,children)=>
  node.path==='R.002.002.002.002.002.002.002'
    ?{...scriptedSynthesis(node,children),summary:'   '}
    :scriptedSynthesis(node,children)});
if(empty.complete)throw Error('empty_synthesis_false_accept');
rows.push(summary('empty_synthesis_depth7',empty,base));

const fabricated=auditCognitiveTree(base,{proposeSynthesis:(node,children)=>{
  const proposed=scriptedSynthesis(node,children);
  if(node.path==='R.002.002.002.002.002.002.002.002.002')
    proposed.children[1].digest='f'.repeat(64);
  return proposed;
}});
if(fabricated.complete)throw Error('forged_provenance_false_accept');
rows.push(summary('forged_provenance_depth9',fabricated,base));

const badActionTree=newDeepTree(deepConfig('balanced',1800000));
await executeDeep(badActionTree,async(node,config)=>node.path==='R.002.002.002'
  ?{action:'INVALID_NEXT_ACTION'}:lightModelDouble(node,config));
const badAction=auditCognitiveTree(badActionTree);
if(badAction.complete||badActionTree.nodes['R.002.002.002'].status!=='blocked')
  throw Error('invalid_action_false_accept');
rows.push(summary('invalid_action_depth3',badAction,badActionTree));

const wrong=structuredClone(base);
wrong.nodes['R.002.002.002.002.002.002.002.002.002.002'].result.classification='unknown';
const wrongAnswer=auditCognitiveTree(wrong);
if(wrongAnswer.complete)throw Error('wrong_atomic_false_accept');
rows.push(summary('wrong_terminal_classification_depth10',wrongAnswer,wrong));
writeFileSync('cognitive-integrity-fault-report.json',
  JSON.stringify({contract:'aau_cognitive_integrity_v0_1',
    source:'synthetic fault injection based on Silas recorded failure types',
    simulatedModel:true,baseNodes:2047,baselineCompleted:ok.complete,
    scenarios:rows,realModelCalls:0},null,2)+'\n');
for(const row of rows)console.log('COGNITIVE_INTEGRITY='+JSON.stringify({
  scenario:row.scenario,certified:row.certified,accepted:row.accepted,
  rejected:row.rejected,calls:row.calls,rootDigest:row.rootDigest,
}));
if(rows.slice(1).some(x=>x.certified))process.exitCode=1;
