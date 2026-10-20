#!/usr/bin/env python3
"""Kimi K2.6 real tool-calling against a read-only export from live private UCCR SQL.

One controlled experiment, up to 4 provider turns; zero transport/model retries.
The registry broker has no database credentials, network operations, write methods,
or unregistered capability evidence. It is a read-only snapshot adapter.
"""
import hashlib,json,os,pathlib,sys,time,urllib.request
ROOT=pathlib.Path(__file__).resolve().parent
DEST=ROOT/"evidence_readonly_tools_v01"
DEST.mkdir(exist_ok=True)
FROZEN={
 "challenge.json":"e51781a1a000f59f8c5ba508698c513d6c90bdb6",
 "rubric.json":"e19e740ebbe52c8772faa34685ffb4165b3883ec",
 "TOOL_SELECTION_GENERIC_V5_SYSTEM.md":"e520242011970ad10338a9b764896db2ada38bd6",
 "aau_registry_db_export_v01.json":"ac160bdf4eb0f1ea2d179a6ad355f8235fa19ec0",
}
def sha(blob):return hashlib.sha256(blob).hexdigest()
def rawsha(path):
 data=(ROOT/path).read_bytes()
 return hashlib.sha1(("blob "+str(len(data))+"\0").encode()+data).hexdigest()
def write(name,val): (DEST/name).write_text(json.dumps(val,indent=2,ensure_ascii=False)+"\n")
def jsonbytes(obj):return json.dumps(obj,sort_keys=True,ensure_ascii=False,separators=(",",":")).encode()
def frozen():
 seen={}
 for name,expected in FROZEN.items():
  actual=rawsha(name)
  if actual!=expected:raise RuntimeError("FROZEN_GIT_BLOB_MISMATCH:"+name+" expected="+expected+" got="+actual)
  seen[name]={"git_blob":actual,"sha256":sha((ROOT/name).read_bytes())}
 return seen

CAT=json.loads((ROOT/"aau_registry_db_export_v01.json").read_text())
OP={o["operation_id"]:o for o in CAT["operations"]}
STOPWORDS={"what","which","with","that","this","from","into","than","when","there","under","these","tools","tool","needed","needs","can","its","the","for","and","all","over","are"}
def search_capabilities(query):
 if not isinstance(query,str) or not (2<=len(query)<=160):return {"error":"INVALID_QUERY"}
 tokens={x for x in __import__("re").findall(r"[a-z0-9_]+",query.lower()) if len(x)>=3 and x not in STOPWORDS}
 records=[]
 for op in CAT["operations"]:
  corpus=" ".join(str(op.get(k,"")) for k in ("tool_name","operation_id","capability_description","exact_invocation","limitations")).lower()
  score=sum(3 if t in op["operation_id"].lower() else 1 for t in tokens if t in corpus)
  if score>0:records.append((score,op))
 records.sort(key=lambda x:(-x[0],x[1]["operation_id"]))
 return {"query":query,"registry_id":CAT["registry_id"],"result_count":len(records),
  "operations":[{"operation_id":o["operation_id"],"tool_name":o["tool_name"],
    "capability_description":o["capability_description"],
    "evidence_level":o["evidence_level"],"limitations":o["limitations"]}
    for score,o in records[:6]],
  "scope":"Search six real narrow operations only; empty results means NOT CATALOGED, not impossible.",
  "not_task_verification":True}
def inspect_operation(operation_id):
 if not isinstance(operation_id,str) or len(operation_id)>160:return {"error":"INVALID_OPERATION_ID"}
 o=OP.get(operation_id)
 return {"operation_id":operation_id,"found":o is not None,
   "registry_id":CAT["registry_id"],"record":o,
   "warning":"Evidence remains scoped: narrow synthetic API support != full workload validation."} if o else {
   "operation_id":operation_id,"found":False,"registry_id":CAT["registry_id"],
   "warning":"Not registered. Seek specialist tool and mark UNVERIFIED pending independent tests."}
TOOLS=[
 {"type":"function","function":{"name":"search_capabilities",
  "description":"Read-only UCCR SQL-export catalog search. Discover tested numerical/graph/routing/electrical operations. Search missing safety/transport concepts too: an empty catalog result is not proof that no tool exists.",
  "parameters":{"type":"object","additionalProperties":False,"properties":{"query":{"type":"string","description":"One mathematical capability, e.g. electric three-phase power flow, graph radiality, generator transport, protective relay, synchronism"}},"required":["query"]}}},
 {"type":"function","function":{"name":"inspect_operation",
  "description":"Read full evidence-scoped exact API, tested version, input/output, positive/negative test statuses and limitations by operation_id. Does not execute any software or write data.",
  "parameters":{"type":"object","additionalProperties":False,"properties":{"operation_id":{"type":"string"}},"required":["operation_id"]}}}
]
def api_call(key,messages,turn,with_tools):
 req={
  "model":"kimi-k2.6","thinking":{"type":"enabled"},"temperature":1.0,
  "max_tokens":32768,"stream":True,"stream_options":{"include_usage":True},
  "messages":messages
 }
 if with_tools:
  req["tools"]=TOOLS
  req["tool_choice"]="auto"
 else:req["response_format"]={"type":"json_object"}
 start=time.monotonic();parts=[];thought=[];calls={};usage={};events=0;done=False;finish=None;provider=None;response_id=None;malformed=0
 http=urllib.request.Request("https://api.moonshot.ai/v1/chat/completions",
  data=json.dumps(req,ensure_ascii=False).encode(),
  headers={"Authorization":"Bearer "+key,"Content-Type":"application/json","Accept":"text/event-stream"},method="POST")
 with urllib.request.urlopen(http,timeout=540) as stream:
  for b in stream:
   line=b.decode("utf8",errors="replace").strip()
   if not line.startswith("data:"):continue
   data=line[5:].strip()
   if data=="[DONE]":done=True;break
   try:ev=json.loads(data)
   except json.JSONDecodeError: malformed+=1;continue
   events+=1;provider=ev.get("model") or provider;response_id=ev.get("id") or response_id
   if ev.get("usage"):usage=ev["usage"]
   for choice in ev.get("choices") or []:
    if choice.get("finish_reason"):finish=choice["finish_reason"]
    d=choice.get("delta") or {}
    if isinstance(d.get("content"),str):parts.append(d["content"])
    if isinstance(d.get("reasoning_content"),str):thought.append(d["reasoning_content"])
    for c in d.get("tool_calls") or []:
     idx=c.get("index",0)
     row=calls.setdefault(idx,{"id":"","type":"function","function":{"name":"","arguments":""}})
     if c.get("id"):row["id"]=c["id"]
     fn=c.get("function") or {}
     if fn.get("name"):row["function"]["name"]+=fn["name"]
     if fn.get("arguments"):row["function"]["arguments"]+=fn["arguments"]
     if c.get("type"):row["type"]=c["type"]
   if events%60==0:
    write("progress.json",{"provider_turn":turn,"events":events,"elapsed_seconds":round(time.monotonic()-start,3),
         "content_chars":sum(len(x) for x in parts),"reasoning_chunks":len(thought),"tool_call_slots":len(calls)})
 elapsed=round(time.monotonic()-start,3)
 ordered=[calls[i] for i in sorted(calls)]
 content="".join(parts);reason="".join(thought)
 metadata={"turn":turn,"status":"PROVIDER_COMPLETED" if done else "INCOMPLETE_STREAM",
           "model_requested":"kimi-k2.6","model_returned":provider,"response_id":response_id,
           "finish_reason":finish,"done":done,"usage":usage,"elapsed_seconds":elapsed,
           "stream_events":events,"malformed_events":malformed,
           "reasoning_chunks":len(thought),"reasoning_chars":len(reason),
           "reasoning_sha256":sha(reason.encode()),"content_sha256":sha(content.encode()),
           "tool_calls_sha256":sha(jsonbytes(ordered)),"tool_call_count":len(ordered)}
 # Preserve raw *assistant content* and tool-call arguments; keep reasoning in RAM
 # only for Moonshot history continuation to avoid publishing private CoT.
 write("provider_turn_%s.json"%turn,{"metadata":metadata,"assistant_content":content,"tool_calls":ordered})
 return {"content":content,"reasoning_content":reason,"tool_calls":ordered,"metadata":metadata}
def run():
 receipt={"experiment":"aau-k26-uccr-readonly-toolcalls-v01","status":"INITIALIZING",
   "stage":"TOOL_SELECTION_ONLY","stage2_authorized":False,
   "comparison_baseline_run":39451190485,"sample_reference_run":39455936347,
   "no_model_retry":True,"no_live_sql_credential":True,
   "tool_calls_are_real_provider_function_calls":True,"registry_source":"private Supabase SQL export from UCCR",
   "frozen":frozen(),"attempts":[],"tool_invocations":[],"proposal":None}
 write("summary.json",receipt)
 key=os.environ.get("MOONSHOT_API_KEY","").strip()
 if not key:
  receipt["status"]="NO_PROVIDER_SECRET";write("summary.json",receipt)
  return 2
 challenge=json.loads((ROOT/"challenge.json").read_text())
 prompt=(ROOT/"TOOL_SELECTION_GENERIC_V5_SYSTEM.md").read_text()
 messages=[
  {"role":"system","content":prompt},
  {"role":"user","content":"You have two read-only computational-capability registry lookup tools. BEFORE writing your Stage-1 tool selection, call search_capabilities to investigate at least three different computational needs from the user's problem, including one complex requirement likely missing from the small registry; then call inspect_operation for relevant exact APIs. Search results may be empty; if absent, select suitable specialist tools independently and label them UNVERIFIED. Keep the original Stage-1 JSON contract and do not solve the problem."},
  {"role":"user","content":json.dumps(challenge,ensure_ascii=False)}]
 receipt["request_messages_sha256"]=sha(jsonbytes(messages))
 try:
  for turn in range(1,5):
   result=api_call(key,messages,turn,with_tools=(turn<=3))
   meta=result["metadata"];receipt["attempts"].append(meta)
   if meta["status"]!="PROVIDER_COMPLETED" or meta["model_returned"]!="kimi-k2.6" or meta["finish_reason"] not in ("stop","tool_calls"):
    receipt["status"]="PROVIDER_INCOMPLETE_OR_TRUNCATED";break
   if meta["finish_reason"]=="tool_calls":
    if turn>=4:
     receipt["status"]="MAX_TOOL_TURNS_EXCEEDED";break
    calls=result["tool_calls"]
    if not calls:receipt["status"]="TOOL_FINISH_WITH_NO_CALLS";break
    messages.append({"role":"assistant","content":result["content"] or None,
      "reasoning_content":result["reasoning_content"],"tool_calls":calls})
    for call in calls:
     name=call["function"]["name"]
     try:args=json.loads(call["function"]["arguments"])
     except json.JSONDecodeError:args={"_error":"INVALID_TOOL_ARGUMENTS"}
     if name=="search_capabilities" and set(args)=={"query"}:
      output=search_capabilities(args["query"])
     elif name=="inspect_operation" and set(args)=={"operation_id"}:
      output=inspect_operation(args["operation_id"])
     else:output={"error":"UNKNOWN_OR_INVALID_READONLY_TOOL_CALL","name":name}
     call_receipt={"turn":turn,"id":call["id"],"name":name,"arguments":args,
       "output_sha256":sha(jsonbytes(output)),"output":output}
     receipt["tool_invocations"].append(call_receipt)
     messages.append({"role":"tool","tool_call_id":call["id"],"name":name,
                      "content":json.dumps(output,ensure_ascii=False)})
    write("tool_call_receipts.json",receipt["tool_invocations"])
    receipt["status"]="TOOL_CALLS_EXECUTED_READ_ONLY"
    write("summary.json",receipt)
   else:
    raw=result["content"];write("raw_final_response.json",{"raw":raw,"sha256":sha(raw.encode())})
    try:
     candidate=json.loads(raw)
     if not isinstance(candidate,dict):raise ValueError("Expected JSON object root")
     receipt["proposal"]=candidate
     receipt["status"]="PROPOSAL_PENDING_EXTERNAL_VERIFICATION" if receipt["tool_invocations"] else "PROPOSAL_WITHOUT_ANY_REGISTRY_TOOL_CALL"
    except Exception as exc:
     receipt["status"]="FINAL_JSON_PARSE_FAILURE"
     receipt["parse_error"]=str(exc)[:280]
    break
  else:receipt["status"]="MAX_PROVIDER_TURNS_EXCEEDED"
 except Exception as exc:
  receipt["status"]="PROVIDER_OR_TRANSPORT_FAILURE"
  receipt["error_kind"]=type(exc).__name__
  receipt["sanitized_error"]=str(getattr(exc,"code","") or str(exc))[:280]
 write("summary.json",receipt)
 print("AAU_UCCR_KIMI="+json.dumps({
   "status":receipt["status"],"provider_turns":len(receipt["attempts"]),
   "tool_invocations":len(receipt["tool_invocations"]),
   "tool_names":[x["name"] for x in receipt["tool_invocations"]],
   "output_present":receipt["proposal"] is not None,
   "provider_finish_reasons":[a["finish_reason"] for a in receipt["attempts"]],
   "provider_tokens":sum(int(a.get("usage",{}).get("total_tokens") or 0) for a in receipt["attempts"]),
   "stage2_authorized":False
  }),flush=True)
 return 0 if receipt["status"]=="PROPOSAL_PENDING_EXTERNAL_VERIFICATION" else 1

if __name__=="__main__":sys.exit(run())
