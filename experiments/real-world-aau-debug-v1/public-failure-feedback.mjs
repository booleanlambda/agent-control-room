// Deterministic public-test reporting for the historical AAU repair benchmark.
// Do not reveal hidden cases, their count, or gold patches to the model.
// Never forward arbitrary candidate/provider output into the next paid prompt.
const PUBLIC_CASE_NAMES=Object.freeze(['received','malformed','http_error','timeout']);
const PROBLEMS=Object.freeze([
 ['one durable presend expected','PRE_SEND_JOURNAL_COUNT'],
 ['never auto resend paid request','UNSAFE_PAID_REPLAY'],
 ['exactly one receipt write; no overwrite of ledger failure','RECEIPT_WRITE_COUNT'],
 ['must preserve manual hold','MANUAL_HOLD_NOT_PRESERVED'],
 ['valid response must return normal answer','ACCEPTED_RESPONSE_BROKEN'],
 ['confirmed ON length must use authorized exhaustion sentinel','THINKING_EXHAUSTION_ROUTE_BROKEN'],
 ['token receipt lost','TOKEN_RECEIPT_LOST'],
 ['finish reason lost','FINISH_REASON_LOST'],
 ['sensitive exception/provider details leaked into report','SENSITIVE_DIAGNOSTIC_LEAK'],
 ['missing sanitized diagnostic report on hold','MISSING_SANITIZED_DIAGNOSTIC'],
 ['ledger commit ambiguity led to second write','DUPLICATE_LEDGER_WRITE'],
 ['candidate exception during verification','CANDIDATE_EXCEPTION'],
 ['verification did not complete all public cases','INCOMPLETE_PUBLIC_SUITE']
]);
const lookup=new Map(PROBLEMS);
const safeStatus=x=>typeof x==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(x)?x:null;
export function makePublicFeedback(receipt){
 const rows=Array.isArray(receipt?.cases)?receipt.cases:[];
 const map=new Map();
 for(const row of rows){
  if(!PUBLIC_CASE_NAMES.includes(row?.name)||map.has(row.name))continue;
  const problemCodes=[];
  for(const problem of Array.isArray(row.problems)?row.problems:[]){
   if(problem==='wrong failure category: '+String(row.status)){
    problemCodes.push('WRONG_FAILURE_CATEGORY');
   }else if(lookup.has(problem)){
    problemCodes.push(lookup.get(problem));
   }else{
    // Unexpected verifier diagnostics are opaque, never sent as raw text.
    problemCodes.push('OTHER_VERIFIER_FAILURE');
   }
  }
  const safePassed=row.passed===true&&problemCodes.length===0;
  map.set(row.name,Object.freeze({
   case:row.name,passed:safePassed,
   failureCodes:Array.from(new Set(problemCodes)).slice(0,15),
   reportedStatus:safeStatus(row.status)
  }));
 }
 const complete=PUBLIC_CASE_NAMES.every(n=>map.has(n))&&
  rows.length===PUBLIC_CASE_NAMES.length;
 const cases=PUBLIC_CASE_NAMES.map(n=>map.get(n)??{
  case:n,passed:false,failureCodes:['INCOMPLETE_PUBLIC_SUITE'],reportedStatus:null
 });
 const failedCases=cases.filter(row=>!row.passed);
 return Object.freeze({
  suite:'public',
  complete,
  caseCount:cases.length,
  passedCases:cases.length-failedCases.length,
  failedCases,
  modelMustFixAllPublicFailures:true,
  // This is public failure feedback only; never attach hidden oracle data.
  containsHiddenFeedback:false,
  contentSanitized:true
 });
}
