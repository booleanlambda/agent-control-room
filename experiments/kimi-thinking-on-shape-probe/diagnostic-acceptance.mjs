// Independent, predeclared acceptance criteria for the historical AAU
// thinking-ON diagnostic *strategy* prompt. This is not a code-execution proof.
// Never persist model text, excerpts, sample completions, or private reasoning.
export const RUBRIC_VERSION='aau-real-v28-diagnostic-strategy-1';
export const REQUIREMENTS=Object.freeze([
 {id:'broad_catch_root_cause',description:'Explains broad catch/masking provenance',
  match:[/\bcatch\b/i,/\b(overwrit|clobber|mask|eras|los|loss|discard|flatten|collaps|obscur|swallow|reset)/i]},
 {id:'preserve_provider_receipt',description:'Preserve usage/tokens and provider finish',
  match:[/\b(token|usage|completion[_ ]?tokens?|billing)\b/i,/\b(finish[_ ]?reason|finish reason|termination|stop|length)\b/i]},
 {id:'malformed_json',description:'Handle JSON parse/syntax failure independently',
  match:[/\b(json|pars|syntax|decod)/i,/\b(malform|invalid|fail|reject|classif|categor|diagnos|hold)/i]},
 {id:'http_rejection',description:'Distinguish provider HTTP failure',
  match:[/\b(http|5[0-9]{2}|4[0-9]{2}|non.?2xx|status code|server response)\b/i,/\b(error|fail|reject|classif|categor|hold|record)/i]},
 {id:'transport_timeout',description:'Distinguish abort/timeout/transport error',
  match:[/\b(timeout|abort|network|transport|connection|socket)\b/i,/\b(error|fail|reject|classif|categor|hold|manual|ambigu)/i]},
 {id:'completion_length',description:'Keep completion length distinct from JSON failure',
  match:[/\b(length|truncat|exhaust|budget|finish[_ ]?reason)\b/i,/\b(reason|finish|token|think|fallback|decompos|limit|stop|classif|categor)/i]},
 {id:'durable_ledger_ambiguity',description:'Handle ambiguous storage receipt and duplicate writes',
  match:[/\b(ledger|database|db|persist|write|commit|journal)\b/i,/\b(ambigu|uncertain|duplicat|idempoten|fail|atomic|recover|hold|acknowledg)/i]},
 {id:'no_ambiguous_auto_retry',description:'No automatic resend after uncertain paid call',
  match:[/\b(retry|replay|resend|duplicate|double[_ -]?send|manual hold)\b/i,/\b(no|not|never|avoid|prevent|prohibit|block|manual|uncertain|ambigu)/i]},
 {id:'testable_verification',description:'Provides concrete tests or assertions for failures',
  match:[/\b(test|assert|validat|verif|replay|fault.?inject|mock)\b/i,/\b(case|scenario|expected|check|assert|simulat|failure|response|outcome)\b/i]}
]);
function isObject(x){return x!==null&&typeof x==='object'&&!Array.isArray(x)}
function corpus(answer){
 const fragments=[],whole=[],seen=new Set(),queue=[{x:answer,level:0,path:''}];
 while(queue.length&&fragments.length<550){
  const {x,level,path}=queue.shift();
  if(!x||typeof x!=='object'||seen.has(x)||level>7)continue;
  seen.add(x);
  const strings=[];
  const entries=Array.isArray(x)?x.slice(0,50).map((v,i)=>[String(i),v]):Object.entries(x).slice(0,65);
  for(const [k,v] of entries){
   if(typeof v==='string'&&v.length<=4000){
    const val=path+' '+k+' '+v;
    fragments.push(val);
    strings.push(k+' '+v);
    whole.push(val);
   }else if((isObject(v)||Array.isArray(v))&&level<7)queue.push({x:v,level:level+1,path:path+' '+k});
  }
  if(strings.length)fragments.push(path+' '+strings.join(' '));
 }
 return {fragments,whole:whole.join(' ').slice(0,120000)};
}
function hasStructure(answer){
 if(!isObject(answer))return false;
 const s=Object.keys(answer);
 if(s.length<2||s.length>60)return false;
 const text=JSON.stringify(answer);
 return text.length>=140&&text.length<=262144;
}
export function assessDiagnosticStrategy(answer){
 const ids=REQUIREMENTS.map(r=>r.id);
 if(!hasStructure(answer)){
  return {rubric:RUBRIC_VERSION,verdict:'RESPONSE_SHAPE_INSUFFICIENT',
   criterionResults:ids.map(id=>({id,met:false})),metCount:0,requiredCount:ids.length,
   limitations:['Heuristic coverage only; no executable repair verification']};
 }
 const {fragments}=corpus(answer);
 const criterionResults=REQUIREMENTS.map(req=>({
  id:req.id,met:fragments.some(fragment=>req.match.every(rx=>rx.test(fragment)))
 }));
 const metCount=criterionResults.filter(x=>x.met).length;
 return {rubric:RUBRIC_VERSION,
  verdict:metCount===REQUIREMENTS.length?'REQUIREMENTS_COVERED':'REQUIREMENTS_NOT_COVERED',
  criterionResults,metCount,requiredCount:ids.length,
  limitations:['This test checks specified diagnostic coverage, not substantive correctness or executable fixes']};
}
