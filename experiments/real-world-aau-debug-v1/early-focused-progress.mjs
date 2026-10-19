// Independent public-oracle monotonicity check for low-cost focused patches.
// The verifier, not the model, decides whether a child changed correctness.
// Do not examine hidden tests here and never accept a regression as progress.
export const EARLY_REPAIR_MAX_CALLS=6;
export const FOCUSED_OFF_NODES=2;
export function focusedPatchDecision(before,after){
 const oldRows=before?.cases,newRows=after?.cases;
 const valid=Array.isArray(oldRows)&&Array.isArray(newRows)&&
  oldRows.length===4&&newRows.length===4&&
  before.suite==='public'&&after.suite==='public';
 if(!valid)return Object.freeze({accept:false,reason:'INCOMPLETE_PUBLIC_EVALUATION'});
 const names=['received','malformed','http_error','timeout'];
 const one=rows=>new Map(rows.map(r=>[r?.name,r]));
 const old=one(oldRows),cur=one(newRows);
 if(old.size!==4||cur.size!==4||names.some(n=>!old.has(n)||!cur.has(n)))
  return Object.freeze({accept:false,reason:'INCOMPLETE_PUBLIC_EVALUATION'});
 if(newRows.some(r=>typeof r?.passed!=='boolean'||!Array.isArray(r?.problems)))
  return Object.freeze({accept:false,reason:'INVALID_PUBLIC_RECEIPT'});
 const regression=names.some(n=>old.get(n).passed===true&&cur.get(n).passed!==true);
 const oldPassed=names.filter(n=>old.get(n).passed===true).length;
 const newPassed=names.filter(n=>cur.get(n).passed===true).length;
 const oldProblems=names.reduce((t,n)=>t+(Array.isArray(old.get(n).problems)?old.get(n).problems.length:0),0);
 const newProblems=names.reduce((t,n)=>t+cur.get(n).problems.length,0);
 const progress=newPassed>oldPassed||newProblems<oldProblems;
 return Object.freeze({
  accept:!regression&&progress,
  reason:regression?'PUBLIC_REGRESSION':progress?'MEASURABLE_PUBLIC_PROGRESS':'NO_MEASURABLE_PROGRESS',
  previousPassed:oldPassed,currentPassed:newPassed,
  previousProblems:oldProblems,currentProblems:newProblems
 });
}
export function validateNodeOrder(tasks){
 if(!Array.isArray(tasks)||tasks.length<2||tasks.length>3)return false;
 if(tasks.some(t=>!Number.isSafeInteger(t?.id)||typeof t.issue!=='string'||
  typeof t.acceptance!=='string'||t.issue.length<8||t.acceptance.length<8))return false;
 return new Set(tasks.map(t=>t.issue.toLowerCase())).size===tasks.length;
}
