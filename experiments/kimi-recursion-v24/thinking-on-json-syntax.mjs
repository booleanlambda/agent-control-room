// Bounded syntax diagnostics for Kimi thinking-ON *final* message content.
// No raw content, message excerpts, exception messages, or private reasoning
// may be persisted. Deterministic recovery is narrowly limited to a complete
// JSON Markdown fence or one leading BOM; never invent closing tokens.
const MAX_CHARS=262144;
function safeSyntaxCategory(error){
 const msg=typeof error?.message==='string'?error.message:'';
 if(/unterminated string/i.test(msg))return 'UNTERMINATED_STRING';
 if(/unexpected end|end of JSON input/i.test(msg))return 'UNEXPECTED_END';
 if(/expected property name|property names must be double-quoted|expected double-quoted property name/i.test(msg))
  return 'INVALID_PROPERTY_NAME';
 if(/unexpected non-whitespace character after JSON|after JSON at position/i.test(msg))
  return 'TRAILING_CONTENT';
 if(/bad escaped character|bad control character|invalid escape|unicode escape/i.test(msg))
  return 'INVALID_ESCAPE_OR_CONTROL';
 if(/unexpected token|unexpected character|is not valid JSON/i.test(msg))return 'UNEXPECTED_TOKEN';
 if(/no number after minus|exponent|decimal point/i.test(msg))return 'INVALID_NUMBER';
 return 'OTHER_JSON_SYNTAX';
}
function safeOffset(error,chars){
 const msg=typeof error?.message==='string'?error.message:'';
 const hit=/(?:at )position ([0-9]{1,9})(?:\b|$)/i.exec(msg);
 if(!hit)return null;
 const offset=Number(hit[1]);
 return Number.isSafeInteger(offset)&&offset>=0&&offset<=chars?offset:null;
}
// Complete fence only, no prefixes, suffixes or multiple competing payloads.
const tick=String.fromCharCode(96);
const fenceRE=new RegExp('^'+tick.repeat(3)+'(?:json)?[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n'+tick.repeat(3)+'[ \\t]*$','i');
function completeJsonFence(value){
 const trimmed=value.trim();
 const m=fenceRE.exec(trimmed);
 return m?.[1]??null;
}
export function inspectThinkingOnFinalJson(content){
 const meta={
  rawContentChars:typeof content==='string'?Math.min(content.length,MAX_CHARS+1):null,
  rawSyntax:'not_checked',syntaxClass:null,syntaxOffset:null,
  recoveryStrategy:'NONE',recoveryResult:'not_attempted'
 };
 if(typeof content!=='string')return {answer:null,meta};
 if(content.length>MAX_CHARS){
  meta.rawSyntax='invalid';meta.syntaxClass='CONTENT_TOO_LONG';
  return {answer:null,meta};
 }
 try{
  const answer=JSON.parse(content);
  meta.rawSyntax='valid';
  return {answer,meta};
 }catch(e){
  meta.rawSyntax='invalid';
  meta.syntaxClass=safeSyntaxCategory(e);
  meta.syntaxOffset=safeOffset(e,content.length);
 }
 // JSON whitespace does not include a UTF-8 BOM. Strip ONLY a single leading
 // BOM, preserving the rest of the response unchanged.
 let candidate=null;
 if(content.startsWith('\uFEFF')){
  candidate=content.slice(1);
  meta.recoveryStrategy='LEADING_BOM';
 }else{
  const fence=completeJsonFence(content);
  if(fence!==null){
   candidate=fence;
   meta.recoveryStrategy='COMPLETE_JSON_FENCE';
  }
 }
 if(candidate===null)return {answer:null,meta};
 meta.recoveryResult='rejected';
 if(candidate.length>MAX_CHARS)return {answer:null,meta};
 try{
  const answer=JSON.parse(candidate);
  if(!answer||typeof answer!=='object'||Array.isArray(answer))return {answer,meta};
  meta.recoveryResult='accepted';
  return {answer,meta};
 }catch{
  return {answer:null,meta};
 }
}
