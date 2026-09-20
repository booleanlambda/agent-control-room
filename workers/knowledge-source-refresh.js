// AAU Knowledge Pool shared-source refresher v0.3.
// This is not the (operator-paused) stimulus broadcaster. It cannot create wakes.
const SB = String(process.env.AAU_SUPABASE_URL || 'https://mgtilfgygzymxiyixjit.supabase.co').replace(/\/$/, '');
const anon = String(process.env.AAU_SUPABASE_ANON_KEY || '').trim();
const bridge = String(process.env.AAU_BROKER_BRIDGE_TOKEN || '').trim();
const RUN_MS = Math.max(15*60_000, Number(process.env.AAU_KNOWLEDGE_REFRESH_MS || 60*60_000));
let inFlight = false;
const clean = (value) => String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
  .replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")
  .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(0x10ffff,Number(n))))
  .replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const tag = (block, name) => clean(block.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','i'))?.[1]||'');
async function rpc(name,payload) {
 if (!anon || !bridge) throw Error('knowledge_refresh_missing_broker_credentials');
 const res=await fetch(SB+'/rest/v1/rpc/'+name,{method:'POST',headers:{
  apikey:anon,authorization:'Bearer '+anon,'content-type':'application/json'},
  body:JSON.stringify({...payload,p_bridge_token:bridge}),signal:AbortSignal.timeout(20000)});
 const t=await res.text();
 if (!res.ok) throw Error(name+':'+res.status+':'+t.slice(0,350));
 return JSON.parse(t);
}
async function fetchSource(source) {
 const endpoint=String(source.endpoint || '');
 const url=new URL(endpoint);
 if (url.protocol!=='https:' ||
     !['www.federalreserve.gov','www.bls.gov','api.worldbank.org'].includes(url.hostname))
    throw Error('knowledge_refresh_disallowed_endpoint');
 const resp=await fetch(url,{headers:{accept:source.adapter==='rss'?'application/rss+xml, application/xml, text/xml':'application/json',
    'user-agent':'AAU-KnowledgeRefresh/0.3 (+https://github.com/booleanlambda/agent-control-room)'},
    signal:AbortSignal.timeout(15000)});
 if(!resp.ok) throw Error('knowledge_source_http_'+resp.status);
 const body=await resp.text();
 if(body.length>2_000_000) throw Error('knowledge_source_too_large');
 return source.adapter==='rss' ? parseRss(body,source) : parseWorldBank(body,source);
}
export function parseRss(xml, source) {
 if (!/<(?:rss|rdf:RDF)\b/i.test(xml) || !/<item\b/i.test(xml)) throw Error('knowledge_source_not_rss');
 const items=[];
 for (const block of xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi)||[]) {
  const title=tag(block,'title').slice(0,350);
  const href=tag(block,'link').slice(0,1200);
  const date=Date.parse(tag(block,'pubDate') || tag(block,'dc:date'));
  let u;
  try { u=new URL(href); } catch { continue; }
  if (u.protocol!=='https:' || u.hostname!==source.source_host ||
      !title || !Number.isFinite(date) || date>Date.now()+86400000 ||
      date<Date.now()-90*86400000) continue;
  const published_at=new Date(date).toISOString();
  items.push({external_id:(tag(block,'guid')||href).slice(0,200),
    claim:('Official publisher headline: '+title).slice(0,650),source_url:u.toString(),
    published_at,observation_period:published_at.slice(0,10),
    fact_kind:'publisher_headline'});
  if(items.length>=Number(source.max_items||5)) break;
 }
 return items;
}
export function parseWorldBank(raw,source) {
 const parsed=JSON.parse(raw);
 if(!Array.isArray(parsed)||!Array.isArray(parsed[1])) throw Error('knowledge_world_bank_invalid_shape');
 const update=parsed[0]?.lastupdated||null;
 const published_at=/^\d{4}-\d\d-\d\d$/.test(update||'')?update+'T00:00:00Z':new Date().toISOString();
 const rows=[];
 for(const point of parsed[1]) {
  const year=String(point?.date||'');
  const value=Number(point?.value);
  if(!/^\d{4}$/.test(year)||year>String(new Date().getUTCFullYear())||
      point?.value===null||!Number.isFinite(value)||Math.abs(value)>100) continue;
  rows.push({external_id:'NY.GDP.MKTP.KD.ZG:WLD:'+year+':'+value.toFixed(6),
    claim:'World Bank records global real GDP growth for '+year+' as '+value.toFixed(2)+
      '% (annual indicator NY.GDP.MKTP.KD.ZG; revisions possible).',
    source_url:'https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG',
    published_at,observation_period:year,fact_kind:'dated_reference_statistic'});
  if(rows.length>=Number(source.max_items||2)) break;
 }
 return rows;
}
export async function refreshKnowledgeSourcesOnce() {
 if(inFlight) return {status:'already_running'};
 inFlight=true;
 try {
  const due=await rpc('aau_bridge_knowledge_refresh_due_v0_3',{});
  if(!due.enabled) return {status:'disabled'};
  const results=[];
  for(const source of due.sources||[]) {
   try {
    const items=await fetchSource(source);
    const result=await rpc('aau_bridge_knowledge_refresh_record_v0_3',{
      p_source_key:source.source_key,p_items:items,p_error:null});
    results.push({source:source.source_key,items:items.length,...result});
   } catch(error) {
    const errorCode=String(error?.message||error).slice(0,350);
    try {await rpc('aau_bridge_knowledge_refresh_record_v0_3',{
      p_source_key:source.source_key,p_items:[],p_error:errorCode});
    } catch(reportError) {console.error('AAU_KNOWLEDGE_SOURCE_REPORT_FAILED',source.source_key,String(reportError).slice(0,350));}
    results.push({source:source.source_key,status:'failed',error:errorCode});
   }
  }
  return {status:'checked',sources:results};
 } finally {inFlight=false;}
}
export function startKnowledgeSourceRefresh() {
 if(!anon || !bridge) return {started:false,reason:'missing_broker_credentials'};
 void refreshKnowledgeSourcesOnce().then(r=>console.log('AAU_KNOWLEDGE_REFRESH',JSON.stringify(r)))
  .catch(e=>console.error('AAU_KNOWLEDGE_REFRESH_FAILED',String(e?.message||e).slice(0,400)));
 const timer=setInterval(()=>void refreshKnowledgeSourcesOnce()
   .then(r=>console.log('AAU_KNOWLEDGE_REFRESH',JSON.stringify(r)))
   .catch(e=>console.error('AAU_KNOWLEDGE_REFRESH_FAILED',String(e?.message||e).slice(0,400))),RUN_MS);
 timer.unref?.();
 return {started:true,interval_ms:RUN_MS,version:'knowledge_shared_refresh_v0_3'};
}
