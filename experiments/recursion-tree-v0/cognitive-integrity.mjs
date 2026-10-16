// AAU cognition-integrity lab: proof-carrying, bottom-up parent synthesis.
// Pure read-only audit of the isolated depth-10 tree; never marks execution complete.
import {createHash} from 'node:crypto';
import {CASES,LABELS} from './engine.mjs';

const digest = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const emptyCounts = () => Object.fromEntries(LABELS.map(label=>[label,0]));
const expectedCase = i => ({
  id:'CASE-'+String(i+1).padStart(4,'0'),
  classification:CASES[i%CASES.length].expected,
});
const same = (a,b) => JSON.stringify(a)===JSON.stringify(b);
const keys = o => Object.keys(o||{}).sort();
const total = c => Object.values(c).reduce((a,b)=>a+b,0);

export function scriptedSynthesis(node,children) {
  const counts=emptyCounts();
  for(const child of children)for(const label of LABELS)counts[label]+=child.counts[label];
  return {
    summary:'Verified aggregation of '+(node.end-node.start)+' diagnostic cases',
    children:children.map(child=>({path:child.path,digest:child.digest})),
    covered:node.end-node.start,
    counts,
  };
}

// A structurally correct but substantively fabricated summary is NOT independently
// adjudicated here; only reference identity, ledger and known-case totals are.
export function authenticateParentSynthesis(node,proposal,children){
  if(!node||node.status!=='split'||node.children?.length!==2)
    return {ok:false,reason:'not_a_split_parent'};
  if(children?.length!==2||children.some(c=>!c||c.accepted!==true))
    return {ok:false,reason:'child_unverified'};
  if(children[0].path!==node.children[0]||children[1].path!==node.children[1])
    return {ok:false,reason:'child_path_mismatch'};
  if(children[0].range[0]!==node.start||
     children[0].range[1]!==children[1].range[0]||
     children[1].range[1]!==node.end)
    return {ok:false,reason:'child_coverage_invalid'};
  if(!proposal||typeof proposal!=='object'||Array.isArray(proposal)||
    typeof proposal.summary!=='string'||!proposal.summary.trim())
    return {ok:false,reason:'empty_synthesis'};
  if(!Array.isArray(proposal.children)||proposal.children.length!==2)
    return {ok:false,reason:'missing_child_evidence'};
  for(let i=0;i<2;i++){
    const claim=proposal.children[i],child=children[i];
    if(claim?.path!==child.path)return {ok:false,reason:'child_path_mismatch'};
    if(claim?.digest!==child.digest)return {ok:false,reason:'child_digest_mismatch'};
  }
  const counts=emptyCounts();
  for(const child of children)for(const label of LABELS)counts[label]+=child.counts[label];
  if(!proposal.counts||!same(keys(proposal.counts),keys(counts))||
     !LABELS.every(label=>Number.isSafeInteger(proposal.counts[label])&&
       proposal.counts[label]===counts[label]))
    return {ok:false,reason:'aggregate_count_mismatch'};
  if(!Number.isSafeInteger(proposal.covered)||
     proposal.covered!==node.end-node.start||
     proposal.covered!==total(counts))
    return {ok:false,reason:'aggregate_coverage_mismatch'};
  const attestation={
    type:'parent',path:node.path,range:[node.start,node.end],
    summary:proposal.summary.trim(),children:proposal.children,
    counts,covered:proposal.covered,
  };
  return {ok:true,proof:{
    accepted:true,path:node.path,range:[node.start,node.end],
    digest:digest(attestation),counts,covered:proposal.covered,
    childEvidence:proposal.children,summary:attestation.summary,
  }};
}
function leafProof(node){
  if(node.status!=='complete')return {ok:false,reason:'leaf_unfinished'};
  if(node.end-node.start!==1||node.children?.length)return {ok:false,reason:'leaf_not_atomic'};
  const expected=expectedCase(node.start);
  if(!same(node.result,{id:expected.id,classification:expected.classification}))
    return {ok:false,reason:'leaf_result_mismatch'};
  // This matches the leaf SHA-256 convention in the existing depth-ten runtime.
  if(node.hash!==digest(node.result))return {ok:false,reason:'leaf_digest_mismatch'};
  const counts=emptyCounts();counts[expected.classification]=1;
  return {ok:true,proof:{
    accepted:true,path:node.path,range:[node.start,node.end],
    digest:node.hash,counts,covered:1,childEvidence:[],
  }};
}
function structuralProblem(tree,n){
  if(n.path==='R'){
    if(n.parent!==null||n.depth!==0)return 'invalid_root';
  }else{
    if(!n.parent||!tree.nodes[n.parent]?.children?.includes(n.path))
      return 'parent_unreachable_or_mismatch';
  }
  if(n.depth!==n.path.split('.').length-1||n.depth>tree.config.depthLimit)
    return 'invalid_depth';
  if(n.status==='split'){
    if(n.children?.length!==2||
      n.children[0]!==n.path+'.001'||n.children[1]!==n.path+'.002')
      return 'invalid_split_children';
    if(n.children.some(path=>!tree.nodes[path]))return 'missing_child_node';
    const a=tree.nodes[n.children[0]],b=tree.nodes[n.children[1]];
    if(a.parent!==n.path||b.parent!==n.path||
       a.depth!==n.depth+1||b.depth!==n.depth+1||
       a.start!==n.start||a.end!==b.start||b.end!==n.end||
       a.start>=a.end||b.start>=b.end)
      return 'split_coverage_invalid';
  }else if(n.children?.length)return 'unaccepted_children';
  return null;
}
function ledgerProblem(tree){
  if(tree.spent<0||tree.spent>tree.config.budget||
     tree.calls<0||tree.calls>tree.config.maxCalls||
     tree.ledger.reduce((s,e)=>s+e.units,0)!==tree.spent||
     tree.seq!==tree.ledger.length||
     new Set(tree.ledger.map(e=>e.id)).size!==tree.ledger.length)
    return 'execution_ledger_invalid';
  return null;
}

export function auditCognitiveTree(tree,{
  proposeSynthesis=scriptedSynthesis,
}={}){
  // Traverse only from root, never accept an orphan as evidence.
  const reachable=new Set(),toVisit=['R'],preflightErrors=[];
  while(toVisit.length){
    const path=toVisit.pop();
    if(reachable.has(path)){preflightErrors.push({path,reason:'cycle_or_duplicate_link'});continue;}
    const n=tree.nodes[path];
    if(!n){preflightErrors.push({path,reason:'missing_child_node'});continue;}
    reachable.add(path);
    for(const child of n.children||[])toVisit.push(child);
  }
  const orphans=Object.keys(tree.nodes).filter(path=>!reachable.has(path));
  if(orphans.length)preflightErrors.push({path:'R',reason:'orphan_nodes',count:orphans.length});
  const ledgerFault=ledgerProblem(tree);
  if(ledgerFault)preflightErrors.push({path:'R',reason:ledgerFault});
  const proofs=new Map(),results={};
  const ordered=[...reachable].sort((a,b)=>
    (tree.nodes[b]?.depth??0)-(tree.nodes[a]?.depth??0)||a.localeCompare(b));
  for(const path of ordered){
    const n=tree.nodes[path];
    if(!n){results[path]={accepted:false,reason:'missing_child_node'};continue;}
    const structural=structuralProblem(tree,n);
    if(structural){results[path]={accepted:false,reason:structural,depth:n.depth};continue;}
    if(n.status==='complete'){
      const r=leafProof(n);
      results[path]=r.ok?{accepted:true,digest:r.proof.digest,depth:n.depth}:
        {accepted:false,reason:r.reason,depth:n.depth};
      if(r.ok)proofs.set(path,r.proof);
      continue;
    }
    if(n.status!=='split'){
      results[path]={accepted:false,reason:'node_not_completed',depth:n.depth};
      continue;
    }
    const children=n.children.map(child=>proofs.get(child));
    if(children.some(c=>!c)){
      results[path]={accepted:false,reason:'child_unverified',depth:n.depth};
      continue;
    }
    let proposal;
    try{proposal=proposeSynthesis(n,children.map(c=>({...c})))}
    catch(error){
      results[path]={accepted:false,reason:'synthesis_proposer_error',depth:n.depth};
      continue;
    }
    const verdict=authenticateParentSynthesis(n,proposal,children);
    results[path]=verdict.ok?{accepted:true,digest:verdict.proof.digest,depth:n.depth}:
      {accepted:false,reason:verdict.reason,depth:n.depth};
    if(verdict.ok)proofs.set(path,verdict.proof);
  }
  const root=proofs.get('R');
  const accepted=Object.values(results).filter(r=>r.accepted).length;
  const rejected=Object.entries(results).filter(([,v])=>!v.accepted)
    .map(([path,v])=>({path,depth:v.depth??null,reason:v.reason}));
  const complete=Boolean(root)&&!preflightErrors.length&&!rejected.length&&
    !tree.queue.length&&tree.complete===true&&
    Object.keys(tree.nodes).length===reachable.size;
  return {
    contract:'aau_cognitive_integrity_v0_1',
    complete,rootDigest:complete?root.digest:null,
    traversed:reachable.size,accepted,rejected:rejected.length,
    acceptedLeaves:[...proofs.values()].filter(p=>p.childEvidence.length===0).length,
    acceptedParents:[...proofs.values()].filter(p=>p.childEvidence.length===2).length,
    preflightErrors,rejectedNodes:rejected,
    results,proofs:Object.fromEntries(proofs),
  };
}
