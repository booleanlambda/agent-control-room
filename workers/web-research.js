// AAU bounded web research v0.1. Fetched pages are evidence, NEVER instructions.
// No authenticated browser, private network access, credentials in sources, or bypass of site controls.
import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { tavilyConfigured, tavilyDiscover, tavilyExtract } from './tavily-research.js';

const MAX_QUERY = 180, MAX_BODY = 550000, MAX_TEXT = 15000;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const decode = (s) => String(s || '').replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(\d+);|&#x([a-f0-9]+);/gi,(m,d,h) =>
  d ? String.fromCodePoint(Math.min(0x10ffff,Number(d))) : h ? String.fromCodePoint(Math.min(0x10ffff,parseInt(h,16))) :
  ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '}[m.toLowerCase()]||m));

function safeHost(host) {
  if (!host || host.length > 230 || /[^\da-z.-]/i.test(host) || host.startsWith('-')
    || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')
    || host.endsWith('.localhost') || host.endsWith('.test')
    || /^\d+(?:\.\d+){3}$/.test(host) || !host.includes('.')) return false;
  return true;
}
function privateIP(ip) {
  const s = String(ip).toLowerCase();
  if (s.includes(':')) return s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd')
    || /^fe[89ab]/.test(s) || s.startsWith('::ffff:') || s.startsWith('2001:db8:');
  const p = s.split('.').map(Number);
  return p.length !== 4 || p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224
    || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
    || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
    || (p[0] === 192 && p[1] === 0) || (p[0] === 198 && (p[1] === 18 || p[1] === 19));
}
async function validateUrl(raw) {
  const u = new URL(String(raw));
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')
    || !safeHost(u.hostname.toLowerCase())) throw Error('research_url_not_public_https');
  const ips = await lookup(u.hostname,{all:true,verbatim:true});
  if (!ips.length || ips.some((v) => privateIP(v.address))) throw Error('research_private_dns_result');
  u.hash = '';
  return u;
}
async function boundedGet(raw, accept, timeout = 9000) {
  let dest = String(raw);
  for (let redirects=0; redirects<=2; redirects++) {
    const u = await validateUrl(dest);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const response = await fetch(u,{redirect:'manual',signal:ctrl.signal,headers:{
        accept,'user-agent':'AAU-ResearchBot/0.1 (+source-attributed-research; contact operator)',
      }});
      if ([301,302,303,307,308].includes(response.status)) {
        if (redirects === 2) throw Error('research_too_many_redirects');
        const location=response.headers.get('location');
        if (!location) throw Error('research_redirect_without_location');
        dest=new URL(location,u).toString(); continue;
      }
      if (!response.ok) throw Error('research_http_'+response.status);
      const len=Number(response.headers.get('content-length')||0);
      if (len > MAX_BODY) throw Error('research_document_too_large');
      const chunks=[]; let bytes=0;
      for await (const piece of response.body) {
        bytes+=piece.length;
        if (bytes>MAX_BODY) throw Error('research_document_too_large');
        chunks.push(piece);
      }
      return {url:u.toString(),type:String(response.headers.get('content-type')||''),body:Buffer.concat(chunks).toString('utf8'),bytes};
    } finally { clearTimeout(timer); }
  }
  throw Error('research_redirect_limit');
}
function rssItems(xml) {
  const list=[];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const tag=(k)=>decode(clean(m[1].match(new RegExp('<'+k+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+k+'>','i'))?.[1]||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,''));
    const url=tag('link');
    if (!url.startsWith('https://') || list.some(x=>x.url===url)) continue;
    list.push({url,title:tag('title'),summary:tag('description'),published_at:tag('pubDate')||null,discovery:'bing_rss_unverified_snippet'});
    if (list.length >= 6) break;
  }
  return list;
}
function relevanceTokens(v) {
  const stop=new Set(['about','with','from','2026','2025','2024','2023','official','latest','current','report','study','evidence','data','source','what','when','where','this','that','the','and','for','into','how','does','find','paper','research']);
  return [...new Set(clean(v).toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>=4&&!stop.has(x)))];
}
function relevant(item,query) {
  const terms=relevanceTokens(query);
  const corpus=clean([item.title,item.summary,new URL(item.url).hostname].join(' ')).toLowerCase();
  const hits=terms.filter(t=>corpus.includes(t)).length;
  return hits>=Math.min(2,terms.length) && hits>0;
}
function primaryRank(item) {
  const h=new URL(item.url).hostname;
  return /(?:^|\.)(?:gov|edu)$/.test(h)?3:
    /(?:^|\.)(?:imf\.org|worldbank\.org|who\.int|oecd\.org|un\.org|doi\.org)$/.test(h)?2:1;
}
async function discover(query) {
  // Authenticated primary provider: fail closed when configured rather than silently
  // falling through to low-quality public RSS / unrelated scholarly metadata.
  if (tavilyConfigured()) {
    try {
      const found=await tavilyDiscover(query);
      const items=found.items.filter(item=>{
        try {
          const u=new URL(item.url);
          if(u.pathname==='/' && !query.toLowerCase().includes(u.hostname.toLowerCase())) return false;
          return relevant(item,query) && (item.relevance_score===null || item.relevance_score>=0.2);
        } catch{return false;}
      }).sort((a,b)=>primaryRank(b)-primaryRank(a) || (b.relevance_score??0)-(a.relevance_score??0));
      return {provider:'tavily_authenticated',items,provider_error:items.length?null:'tavily_results_not_relevant'};
    } catch(error) {
      return {provider:'tavily_authenticated',items:[],
        provider_error:String(error?.message||error).slice(0,160)};
    }
  }
  let bingError=null;
  try {
    const url='https://www.bing.com/search?'+new URLSearchParams({q:query,format:'rss'});
    const response=await boundedGet(url,'application/rss+xml, application/xml, text/xml',9000);
    const list=rssItems(response.body);
    const relevantItems=list.filter(item=>relevant(item,query)).sort((a,b)=>primaryRank(b)-primaryRank(a));
    if (relevantItems.length) return {provider:'bing_public_rss',items:relevantItems,provider_error:null};
    bingError=list.length?'bing_rss_results_not_relevant':'bing_rss_no_search_items';
  } catch(e) { bingError=clean(e.message).slice(0,120); }
  // Official U.S. government dataset discovery. Data.gov contains metadata, not datasets themselves.
  // Require direct source fetch below; never claim the metadata alone is a full research document.
  try {
    const u='https://catalog.data.gov/api/3/action/package_search?'+new URLSearchParams({q:query,rows:'6'});
    const data=JSON.parse((await boundedGet(u,'application/json',9000)).body);
    const items=(data?.result?.results||[]).slice(0,6).map(v=>({
      url:v.url||('https://catalog.data.gov/dataset/'+encodeURIComponent(v.name||'')),
      title:clean(v.title),summary:clean(v.notes).replace(/<[^>]+>/g,' ').slice(0,450),
      published_at:v.metadata_modified||null,publisher:v.organization?.title||null,
      discovery:'data_gov_catalog_metadata_not_underlying_dataset'
    })).filter(x=>x.url?.startsWith('https://')&&relevant(x,query));
    if(items.length) return {provider:'data_gov_catalog',items,provider_error:bingError};
  } catch(e) {
    bingError=[bingError,'data_gov:'+clean(e.message).slice(0,100)].filter(Boolean).join('; ');
  }
  // Crossref is open scholarly metadata, NOT a substitute for full, general web search.
  try {
    const url='https://api.crossref.org/works?'+new URLSearchParams({'query.bibliographic':query,rows:'5',select:'DOI,title,URL,published,author,publisher,abstract'});
    const res=await boundedGet(url,'application/json',9000);
    const data=JSON.parse(res.body);
    const list=(data?.message?.items||[]).slice(0,5).map(v=>({
      url:v.URL,title:clean(v.title?.[0]),summary:clean(String(v.abstract||'').replace(/<[^>]+>/g,' ')).slice(0,450),
      published_at:v.published?.['date-parts']?.[0]?.join('-')||null,publisher:v.publisher||null,
      discovery:'crossref_bibliographic_metadata_not_full_text'
    })).filter(x=> {
      if(!x.url?.startsWith('https://')||!relevant(x,query))return false;
      // A generic historical paper is not evidence for a dated current-event query.
      const years=query.match(/\b20\d{2}\b/g)||[];
      return years.length===0 || years.some(year=>
        String(x.published_at||'').startsWith(year) || [x.title,x.summary].some(v=>String(v||'').includes(year))
      );
    }).sort((a,b)=>primaryRank(b)-primaryRank(a));
    return {provider:'crossref_scholarly_only',items:list,provider_error:bingError};
  } catch(e) {
    return {provider:'none',items:[],provider_error:[bingError,clean(e.message)].filter(Boolean).join('; ').slice(0,250)};
  }
}
function htmlSource(page) {
  const title=decode(clean(page.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').replace(/<[^>]+>/g,''));
  const date=page.body.match(/<meta[^>]+(?:property|name)=["'](?:article:published_time|date|citation_date|DC.date)["'][^>]+content=["']([^"']+)/i)?.[1] || null;
  const article=page.body.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
    || page.body.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || page.body;
  const extracted=decode(article.replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ')
    .replace(/<(?:nav|header|footer|aside|form)\b[\s\S]*?<\/(?:nav|header|footer|aside|form)>/gi,' ')
    .replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
  return {title:title.slice(0,350),published_at:date,excerpt:extracted.slice(0,MAX_TEXT),sha256:sha(page.body),bytes:page.bytes,
    coverage:extracted.length>MAX_TEXT?'partial_text_truncated':'html_text_extracted_completeness_not_guaranteed'};
}
export async function researchWeb({queries,urls}={}) {
  const submitted=Array.isArray(queries)?queries:[];
  const requested=[...new Set(submitted.filter(q=>typeof q==='string').map(q=>clean(q).slice(0,MAX_QUERY)).filter(q=>q.length>=4))].slice(0,3);
  const direct=[...new Set((Array.isArray(urls)?urls:[]).filter(u=>typeof u==='string'&&u.length<1200&&u.startsWith('https://')))].slice(0,4);
  const report={version:'aau_web_research_v0_2',search_provider_configured:tavilyConfigured()?'tavily_authenticated':'legacy_unconfigured',requested_queries:requested,requested_direct_urls:direct,
    searches:[],sources:[],limits:{queries:3,sources:4,body_bytes:MAX_BODY,excerpt_chars:MAX_TEXT},
    restrictions:'Public HTTPS only; short bounded fetch. HTML text extraction may be incomplete. PDFs, protected pages and paywalls are not read in full.'};
  for(const url of direct) {
    if(report.sources.length>=4) break;
    const record={query:null,url,discovery:'agent_requested_direct_url',search_title:null,search_snippet:null};
    try {
      const page=await boundedGet(url,'text/html, text/plain, application/xhtml+xml, application/pdf',9000);
      record.url=page.url; record.mime_type=page.type.split(';')[0];
      if (/html|text\/plain|xhtml/i.test(page.type)) {
        const parsed=/html|xhtml/i.test(page.type)?htmlSource(page):{
          title:page.url,published_at:null,excerpt:page.body.slice(0,MAX_TEXT),
          sha256:sha(page.body),bytes:page.bytes,coverage:page.body.length>MAX_TEXT?'partial_text_truncated':'plain_text'};
        Object.assign(record,parsed);record.fetch_status='fetched_text';
      } else {
        record.fetch_status='unsupported_mime';record.coverage='metadata_only_document_not_read';
        record.sha256=sha(page.body);record.bytes=page.bytes;
      }
    } catch(e) {record.fetch_status='blocked';record.coverage='direct_url_unavailable';record.fetch_error=clean(e.message).slice(0,160);}
    report.sources.push(record);
  }
  for (const q of requested) {
    const discovery=await discover(q);
    report.searches.push({query:q,provider:discovery.provider,result_count:discovery.items.length,provider_error:discovery.provider_error});
    for (const item of discovery.items.slice(0,2)) {
      if (report.sources.length>=4 || report.sources.some(s=>s.url===item.url)) continue;
      const record={query:q,url:item.url,search_title:item.title,discovery:item.discovery,
        publisher:item.publisher||null,search_publication_date:item.published_at,search_snippet:item.summary||null};
      try {
        if(item.discovery==='tavily_search_snippet_not_fetched') {
          // Check public HTTPS & DNS before sending a result URL to the extract tool.
          const safe=await validateUrl(item.url);
          try {
            const extraction=await tavilyExtract(safe.toString());
            if(extraction.fetch_status==='fetched_text') {
              Object.assign(record,extraction);
              report.sources.push(record);
              continue;
            }
            record.provider_extract_error=extraction.fetch_error||'tavily_extract_empty';
          } catch(error) {
            record.provider_extract_error=String(error?.message||error).slice(0,160);
          }
        }
        const page=await boundedGet(item.url,'text/html, text/plain, application/xhtml+xml, application/pdf',9000);
        record.url=page.url;record.mime_type=page.type.split(';')[0];
        if (/html|text\/plain|xhtml/i.test(page.type)) {
          const parsed=/html|xhtml/i.test(page.type)?htmlSource(page):{
            title:item.title,published_at:null,excerpt:page.body.slice(0,MAX_TEXT),
            sha256:sha(page.body),bytes:page.bytes,coverage:page.body.length>MAX_TEXT?'partial_text_truncated':'plain_text'};
          Object.assign(record,parsed);record.fetch_status='fetched_text';
        } else {
          record.fetch_status='unsupported_mime';record.coverage='metadata_only_document_not_read';
          record.sha256=sha(page.body);record.bytes=page.bytes;
        }
      } catch(e) {record.fetch_status='blocked';record.coverage='search_snippet_only';record.fetch_error=clean(e.message).slice(0,160);}
      report.sources.push(record);
    }
  }
  report.status=report.sources.some(s=>s.fetch_status==='fetched_text')?'fetched_text'
    :report.sources.length?'metadata_only':'blocked';
  return report;
}
export async function smokeWebResearch() {
  const probes=[];
  for(const query of ['Federal Reserve September 2026 monetary policy statement official',
    'US voter registration official usa.gov']) {
    const report=await researchWeb({queries:[query]});
    probes.push({query,ok:report.status==='fetched_text',status:report.status,searches:report.searches,
      sources:report.sources.map(({url,search_title,fetch_status,coverage,fetch_error,bytes})=>({url,search_title,fetch_status,coverage,fetch_error,bytes}))});
  }
  const direct=await researchWeb({urls:['https://www.usa.gov/voter-registration/']});
  const direct_probe={status:direct.status,ok:direct.status==='fetched_text',sources:direct.sources.map(({url,fetch_status,coverage,bytes,fetch_error})=>({url,fetch_status,coverage,bytes,fetch_error}))};
  return {ok:direct_probe.ok && (tavilyConfigured() ? probes.some(p=>p.searches.some(s=>s.provider==='tavily_authenticated' && s.result_count>0) && p.sources.some(s=>s.fetch_status==='fetched_text')) : true),tavily_key_configured:tavilyConfigured(),probes,direct_probe};
}
