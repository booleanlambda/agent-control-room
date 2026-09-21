// AAU Tavily provider v0.1 — authenticated search and source extraction.
// API key is only read from Render runtime environment. NEVER return, log, or persist it.
import { createHash } from 'node:crypto';
const KEY = String(process.env.TAVILY_API_KEY || process.env.tavily_apikey || '').trim();
const API = 'https://api.tavily.com';
const sha = v => createHash('sha256').update(v).digest('hex');
const MAX_RESPONSE = 850000;
const MAX_TEXT = 15000;
const clean = v => String(v || '').replace(/\s+/g, ' ').trim();

export function tavilyConfigured() { return KEY.length > 0; }

async function post(route,payload,timeoutMs=12000) {
  if (!tavilyConfigured()) throw Error('tavily_api_key_not_configured');
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),timeoutMs);
  try {
    const res=await fetch(API+route,{
      method:'POST',redirect:'error',signal:ctrl.signal,
      headers:{authorization:'Bearer '+KEY,accept:'application/json','content-type':'application/json'},
      body:JSON.stringify(payload),
    });
    if(!res.ok) throw Error('tavily_'+route.slice(1)+'_http_'+res.status);
    const size=Number(res.headers.get('content-length')||0);
    if(size>MAX_RESPONSE) throw Error('tavily_response_too_large');
    let total=0;const chunks=[];
    for await(const chunk of res.body){
      total+=chunk.length;
      if(total>MAX_RESPONSE) throw Error('tavily_response_too_large');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch(error) {
    if(ctrl.signal.aborted) throw Error('tavily_'+route.slice(1)+'_timeout');
    if(String(error?.message||'').startsWith('tavily_')) throw error;
    throw Error('tavily_'+route.slice(1)+'_request_failed');
  } finally {clearTimeout(timer);}
}

export async function tavilyDiscover(query) {
  const data=await post('/search',{
    query,topic:'general',search_depth:'basic',max_results:20,
    include_answer:false,include_raw_content:false,include_images:false,
  });
  const items=(Array.isArray(data.results)?data.results:[]).map(v=>({
    url:typeof v.url==='string'?v.url:'',
    title:clean(v.title).slice(0,350),
    summary:clean(v.content).slice(0,650),
    published_at:typeof v.published_date==='string'?v.published_date:null,
    discovery:'tavily_search_snippet_not_fetched',
    relevance_score:Number.isFinite(Number(v.score))?Number(v.score):null,
  })).filter(v=>v.url.startsWith('https://')&&v.url.length<1200);
  return {provider:'tavily_authenticated',items,provider_error:null};
}

export async function tavilyExtract(url) {
  const data=await post('/extract',{
    urls:[url],extract_depth:'basic',format:'markdown',include_images:false,
  },14000);
  const result=(Array.isArray(data.results)?data.results:[]).find(v=>v.url===url)
    ||(Array.isArray(data.results)?data.results:[])[0];
  if(!result||typeof result.raw_content!=='string'||!result.raw_content.trim()) {
    const fail=(Array.isArray(data.failed_results)?data.failed_results:[])[0];
    return {fetch_status:'blocked',coverage:'search_snippet_only',
      fetch_error:'tavily_extract_no_text'+(fail?.error?':'+clean(fail.error).slice(0,80):'')};
  }
  const raw=result.raw_content;
  return {fetch_status:'fetched_text',mime_type:'text/markdown',
    excerpt:raw.slice(0,MAX_TEXT),sha256:sha(raw),bytes:Buffer.byteLength(raw),
    coverage:raw.length>MAX_TEXT?'provider_extracted_text_truncated':
      'provider_extracted_text_completeness_not_guaranteed',
    extraction_provider:'tavily_extract'};
}
