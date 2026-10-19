"""Recover AAU v4 stage 1 using immutable completed A/B/C receipts and ONE D delta call.
Never executes chosen computation tools, never authorizes stage two.
"""
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.request

ROOT=Path(__file__).resolve().parent
SEED=ROOT/"reused_v4_original"/"evidence_v4"
OUT=ROOT/"v41_evidence"
OUT.mkdir(parents=True,exist_ok=True)
MODEL="kimi-k2.6"
SHA_RAW={
 "A":"56abf8f9ba5a4a926f1886e25f57c25b4933cb83c7695f8ec47edb91423b4513",
 "B":"69f2f6870230d951a850401a8937c13bb13db6f93c4c6a16a6fc8c466955ff25",
 "C":"87d9baeaf7ed28c2b0e787ed85342e0e5d3ce93accd4d448fe8059f4172e0241"
}
EXPECTED_CHALLENGE="56321d16f88d1c46eec36a6c51a435a75cba6d72f55a824364a4dcf39a636c16"
EXPECTED_RUBRIC="ad8f605c7ee0f885f4c4ca0b891fc9495b5271712114c4c492e17574c8ea95d9"
EXPECTED_APPROPRIATENESS="095c0f2e7c17774c7fd960087237e1bbce1ae0fb8bed0ba14a93eae247be7261"

def sha(x):
 return hashlib.sha256(x).hexdigest()
def canonical(x):
 return json.dumps(x,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()
def dump(name,obj):
 (OUT/name).write_text(json.dumps(obj,indent=2,ensure_ascii=False))

def load_reuse():
 receipts={}
 for role,expected in SHA_RAW.items():
  path=SEED/("call-"+role+"-receipt.json")
  x=json.loads(path.read_text())
  assert x.get("name")==role and x.get("status")=="COMPLETED_PENDING_INDEPENDENT_GATE",(role,"status")
  p=x.get("provider_receipt") or {}
  assert p.get("finish_reason")=="stop" and p.get("stream_done") is True,(role,"finish_reason")
  raw=x.get("raw_response_content")
  assert isinstance(raw,str) and sha(raw.encode())==expected,(role,"raw_sha")
  assert p.get("raw_content_sha256")==expected,(role,"receipt_sha")
  assert x.get("model")=="kimi-k2.6" and x.get("thinking")=="enabled",(role,"model")
  assert x.get("challenge_sha256")==EXPECTED_CHALLENGE,(role,"challenge")
  assert x.get("original_rubric_sha256")==EXPECTED_RUBRIC,(role,"rubric")
  assert x.get("appropriateness_rubric_sha256")==EXPECTED_APPROPRIATENESS,(role,"extra_rubric")
  assert isinstance(x.get("model_proposal"),dict),(role,"proposal")
  receipts[role]=x
 return receipts

def compact_evidence(architect,blind,auditor):
 a=architect["model_proposal"];b=blind["model_proposal"];c=auditor["model_proposal"]
 return {
  "original_architect":{
   "selected_essential_tools":[{"id":t["id"],"name":t["name"],
      "executable_method":t.get("executable_method_or_api"),
      "limits":t.get("limitations")} for t in a.get("essential_tools",[])],
   "tool_interfaces":[{"from_id":t.get("from_id"),"to_id":t.get("to_id"),
     "artifact":t.get("typed_artifact")} for t in a.get("tool_interfaces",[])],
   "original_self_assessment":a.get("self_assessment")},
  "blind_counterexamples":[{"id":t.get("id"),
     "plausible_wrong_result":t.get("plausible_wrong_result"),
     "missing_check":t.get("missing_check_that_would_expose_it")} for t in b.get("counterexample_tests",[])],
  "independent_audit":{
   "open_critical_ids":c["audit_result"]["critical_open_ids"],
   "open_supporting_ids":c["audit_result"].get("supporting_open_ids",[]),
   "requirements_union":[{"audit_id":t.get("audit_id"),"mandatory":t.get("mandatory"),
       "independent_test":t.get("independent_acceptance_test")} for t in c.get("reconciliation",[])],
   "gaps":c.get("gaps",[]),
   "repair_requests":c.get("repair_requests",[]),
   "contradictions":c.get("contradictions",[])
  }
 }

def run():
 key=os.environ.get("MOONSHOT_API_KEY","").strip()
 if not key:raise RuntimeError("MOONSHOT_PROVIDER_KEY_MISSING")
 challenge_bytes=(ROOT/"challenge.json").read_bytes()
 rubric_bytes=(ROOT/"rubric.json").read_bytes()
 appropriateness_bytes=(ROOT/"appropriateness_rubric_v1.json").read_bytes()
 assert sha(challenge_bytes)==EXPECTED_CHALLENGE
 assert sha(rubric_bytes)==EXPECTED_RUBRIC
 assert sha(appropriateness_bytes)==EXPECTED_APPROPRIATENESS
 receipts=load_reuse()
 protocol_text=(ROOT/"TOOL_SELECTION_V41_DELTA_PROMPT.md").read_text()
 system=protocol_text.split("## System prompt\n\n",1)[1].split("\n## Experiment notes (not sent to model)",1)[0].strip()
 user={"original_task":json.loads(challenge_bytes),
       "prior_independent_evidence":compact_evidence(receipts["A"],receipts["B"],receipts["C"])}
 messages=[{"role":"system","content":system},{"role":"user","content":json.dumps(user,ensure_ascii=False)}]
 payload={"model":MODEL,"thinking":{"type":"enabled"},"temperature":1.0,"max_tokens":32768,
          "response_format":{"type":"json_object"},"stream":True,
          "stream_options":{"include_usage":True},"messages":messages}
 record={"trial":"V4.1_DELTA_ONLY_RECOVERY","model":MODEL,"thinking":"enabled",
         "attempts":1,"status":"STARTED","stage2_triggered":False,
         "tools_permitted":False,"challenge_sha256":EXPECTED_CHALLENGE,
         "original_rubric_sha256":EXPECTED_RUBRIC,
         "appropriateness_rubric_sha256":EXPECTED_APPROPRIATENESS,
         "v41_prompt_sha256":sha(protocol_text.encode()),
         "model_request_sha256":sha(canonical(messages)),
         "original_call_sha256":SHA_RAW,"provider_receipt":None,
         "raw_response_content":None,"model_delta":None}
 dump("v41-D-receipt.json",record)
 req=urllib.request.Request("https://api.moonshot.ai/v1/chat/completions",
       data=json.dumps(payload).encode(),
       headers={"Authorization":"Bearer "+key,"Content-Type":"application/json",
                "Accept":"text/event-stream"},method="POST")
 started=time.monotonic(); parts=[]; reason_sha=hashlib.sha256()
 finish=None; usage={}; response_id=None; provider_model=None; event_count=0;reason_chunks=0;done=False
 try:
  with urllib.request.urlopen(req,timeout=420) as response:
   for bytes_line in response:
    line=bytes_line.decode("utf-8",errors="replace").strip()
    if not line.startswith("data:"):continue
    data=line[5:].strip()
    if data=="[DONE]":
     done=True;break
    packet=json.loads(data); event_count+=1
    if packet.get("usage"):usage=packet["usage"]
    response_id=packet.get("id") or response_id
    provider_model=packet.get("model") or provider_model
    for choice in packet.get("choices") or []:
     if choice.get("finish_reason"):finish=choice["finish_reason"]
     delta=choice.get("delta") or {}
     if delta.get("content"):parts.append(delta["content"])
     if delta.get("reasoning_content"):
      reason_sha.update(delta["reasoning_content"].encode());reason_chunks+=1
    if event_count%80==0:
     record["progress"]={"events":event_count,"reasoning_chunks":reason_chunks,
       "content_characters":sum(map(len,parts)),"wall_seconds":round(time.monotonic()-started,2)}
     record["raw_response_content"]="".join(parts)
     dump("v41-D-receipt.json",record)
  raw="".join(parts); record["raw_response_content"]=raw
  record["provider_receipt"]={"response_model":provider_model,"response_id":response_id,
    "finish_reason":finish,"stream_done":done,"events":event_count,
    "reasoning_chunks":reason_chunks,"reasoning_content_sha256":reason_sha.hexdigest(),
    "usage":usage,"reasoning_tokens":(usage.get("completion_tokens_details") or {}).get("reasoning_tokens"),
    "raw_content_sha256":sha(raw.encode())}
  if not done or finish!="stop":
   record["status"]="INCOMPLETE_PROVIDER_RESPONSE"
  else:
   trimmed=raw.strip()
   normalized=raw;record["normalization"]="none"
   if trimmed.startswith("```json\n") and trimmed.endswith("\n```"):
    normalized=trimmed[len("```json\n"):-len("\n```")];record["normalization"]="outer_json_fence_only"
   elif trimmed.startswith("```\n") and trimmed.endswith("\n```"):
    normalized=trimmed[len("```\n"):-len("\n```")];record["normalization"]="outer_fence_only"
   record["normalized_content_sha256"]=sha(normalized.encode())
   delta=json.loads(normalized)
   if not isinstance(delta,dict):raise ValueError("INVALID_DELTA_JSON_ROOT")
   record["model_delta"]=delta
   record["status"]="COMPLETE_DELTA_PENDING_INDEPENDENT_GATE"
 except Exception as e:
  record["status"]="PROVIDER_OR_PARSER_FAILURE"
  record["error_class"]=type(e).__name__
  record["error_category"]="HTTP" if getattr(e,"code",None) else "TRANSPORT_OR_FORMAT"
  record["error_http_code"]=getattr(e,"code",None)
  record["raw_response_content"]="".join(parts)
 finally:
  record["wall_seconds"]=round(time.monotonic()-started,3)
  dump("v41-D-receipt.json",record)

 print("AAU_V41_DELTA="+json.dumps({"status":record["status"],
   "provider_tokens":(record.get("provider_receipt") or {}).get("usage",{}).get("total_tokens"),
   "reasoning_tokens":(record.get("provider_receipt") or {}).get("reasoning_tokens"),
   "finish_reason":(record.get("provider_receipt") or {}).get("finish_reason"),
   "response_sha256":(record.get("provider_receipt") or {}).get("raw_content_sha256"),
   "wall_seconds":record["wall_seconds"],"stage2_triggered":False}),flush=True)
 if record["status"]!="COMPLETE_DELTA_PENDING_INDEPENDENT_GATE":
  raise RuntimeError(record["status"])
 delta=record["model_delta"]
 audit=receipts["C"]["model_proposal"]
 mandatory=[t["audit_id"] for t in audit["reconciliation"] if t.get("mandatory")]
 repaired_ids=[r.get("audit_id") for r in delta.get("audit_repairs",[]) if isinstance(r,dict)]
 incomplete_mandatory=sorted(set(mandatory)-set(repaired_ids))
 duplicate_repair_ids=sorted({k for k in repaired_ids if repaired_ids.count(k)>1})
 inconsistent_approval=delta.get("stage2_authorized") is not False
 deterministic={"original_mandatory_audit_ids":mandatory,
  "missing_repair_rows":incomplete_mandatory,
  "duplicate_repair_rows":duplicate_repair_ids,
  "stage2_authorized_in_response":delta.get("stage2_authorized"),
  "stage1_pass":None,"stage2_permitted":False,
  "format_and_coverage_check":not (incomplete_mandatory or duplicate_repair_ids or inconsistent_approval),
  "unresolved_critical_ids":delta.get("unresolved_critical_ids")}
 # Deterministic evidence COMPOSITION, not an invented complete toolchain or gate pass.
 combined={
  "original_A_proposal":receipts["A"]["model_proposal"],
  "original_B_independent_requirements":receipts["B"]["model_proposal"],
  "original_C_adversarial_audit":audit,
  "v41_D_repair_delta":delta,
  "provenance":{"source_actions_run":39285019757,
                "original_response_sha256":SHA_RAW,
                "v41_response_sha256":record["provider_receipt"]["raw_content_sha256"]},
  "deterministic_composition_check":deterministic,
  "independent_rubric_status":"NOT_YET_GRADED",
  "stage2_triggered":False
 }
 dump("v41-composed-evidence-bundle.json",combined)
 dump("v41-composition-check.json",deterministic)
 print("AAU_V41_COMPOSITION="+json.dumps({
  "repair_count":len(repaired_ids),"mandatory_count":len(mandatory),
  "missing_repair_ids":incomplete_mandatory,
  "inconsistency":bool(duplicate_repair_ids or inconsistent_approval),
  "stage1_pass":None,"stage2_triggered":False
 }),flush=True)

if __name__=="__main__":
 run()
