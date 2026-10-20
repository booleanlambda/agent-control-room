#!/usr/bin/env python3
"""Read-only bounded Parallel Search v1 adapter for AAU UCCR toolchain discovery.

Parallel excerpts are UNTRUSTED DISCOVERY DATA, never API verification receipts.
No mutation, arbitrary target URLs, API key echoes, or tool execution.
"""
import hashlib,json,os,re,time,urllib.request,urllib.error
ENDPOINT="https://api.parallel.ai/v1/search"
MAX_PER_RUN=6
MAX_RESULTS=5
MAX_EXCERPT_CHARS=1200
MAX_QUERY_LENGTH=160
MAX_OBJECTIVE_LENGTH=750
class Discovery:
 def __init__(self):
  self.calls=0;self.records=[]
 def search(self,objective,search_queries):
  if not isinstance(objective,str) or not 12<=len(objective.strip())<=MAX_OBJECTIVE_LENGTH:
   return {"error":"INVALID_OBJECTIVE"}
  if not isinstance(search_queries,list) or not 1<=len(search_queries)<=3 or any(
   not isinstance(x,str) or not 3<=len(x.strip())<=MAX_QUERY_LENGTH for x in search_queries):
   return {"error":"INVALID_SEARCH_QUERIES"}
  if self.calls>=MAX_PER_RUN:
   return {"error":"PARALLEL_BUDGET_EXHAUSTED","limit":MAX_PER_RUN}
  key=os.environ.get("PARALLEL_API_KEY","").strip()
  if not key:return {"error":"PARALLEL_CREDENTIAL_UNAVAILABLE"}
  payload={"objective":objective,"search_queries":search_queries,"mode":"basic",
           "advanced_settings":{"max_results":MAX_RESULTS,
                "excerpt_settings":{"max_chars_per_result":MAX_EXCERPT_CHARS}}}
  self.calls+=1
  start=time.monotonic()
  request=urllib.request.Request(ENDPOINT,data=json.dumps(payload).encode("utf8"),
     method="POST",headers={"x-api-key":key,"Content-Type":"application/json",
                             "Accept":"application/json"})
  try:
   with urllib.request.urlopen(request,timeout=60) as response:
    status=response.status
    raw=response.read(500000)
   parsed=json.loads(raw)
  except urllib.error.HTTPError as exc:
   # Do not echo provider body; it may repeat request/key in some error classes.
   safe={"error":"PARALLEL_HTTP_ERROR","status":exc.code,"query_count":len(search_queries)}
   self.records.append({"request":payload,"response":safe,"latency_seconds":round(time.monotonic()-start,3)})
   return safe
  except Exception as exc:
   safe={"error":"PARALLEL_TRANSPORT_ERROR","kind":type(exc).__name__}
   self.records.append({"request":payload,"response":safe,"latency_seconds":round(time.monotonic()-start,3)})
   return safe
  rows=parsed.get("results",[]) if isinstance(parsed,dict) else []
  out=[]
  for item in rows[:MAX_RESULTS]:
   if not isinstance(item,dict):continue
   url=item.get("url")
   if not isinstance(url,str) or not url.startswith("https://"):continue
   excerpts=item.get("excerpts") or []
   if not isinstance(excerpts,list):excerpts=[]
   out.append({"title":str(item.get("title") or "")[:200],"url":url[:700],
      "excerpts":[str(x)[:MAX_EXCERPT_CHARS] for x in excerpts[:2]],
      "published_date":item.get("publish_date") or item.get("published_date")})
  safe={"result_count":len(out),"results":out,"classification":"UNVERIFIED_WEB_DISCOVERY",
        "verification_required":["official API and version documentation",
         "executable positive and negative probes",
         "interoperability and domain-safety checks"]}
  self.records.append({"request":payload,"response":safe,
    "latency_seconds":round(time.monotonic()-start,3),"http_status":status,
    "provider_result_count":len(rows)})
  return safe

def smoke():
 d=Discovery()
 assert d.search("",["valid"])["error"]=="INVALID_OBJECTIVE"
 assert d.search("Find documented computational programs",[])["error"]=="INVALID_SEARCH_QUERIES"
 if not os.environ.get("PARALLEL_API_KEY","").strip():
  print("PARALLEL_PREFLIGHT=NO_GITHUB_ACTIONS_SECRET");return 2
 x=d.search("Find official documentation for open-source pandapower fault short-circuit calculation module.",
   ["pandapower calc_sc IEC 60909 official documentation"])
 print("PARALLEL_PREFLIGHT="+json.dumps({"status":"CONNECTED" if x.get("result_count",0)>0 else "FAILED",
     "result_count":x.get("result_count",0),
     "first_source":x.get("results",[{}])[0].get("url"),
     "error":x.get("error"),"calls":d.calls}),flush=True)
 return 0 if x.get("result_count",0)>0 else 1

if __name__=="__main__":raise SystemExit(smoke())
