#!/usr/bin/env python3
"""Kimi K2.6 registry-assisted tool selection: unchanged original problem/prompt; catalog sample added.
SSE transport based on historical AAU 2026-10-19 runner.
No solver or actuator invocation. No auto retry. Complete provider forensics.
"""
import hashlib, json, os, pathlib, time, urllib.request, urllib.error, sys, traceback
ROOT=pathlib.Path(__file__).resolve().parent
E=ROOT/"evidence_registry_v01"
E.mkdir(exist_ok=True)
MODEL="kimi-k2.6"
PIN={
 "challenge.json":"e51781a1a000f59f8c5ba508698c513d6c90bdb6",
 "rubric.json":"e19e740ebbe52c8772faa34685ffb4165b3883ec",
 "appropriateness_rubric_v1.json":"2eab486b7a95ca635637769bf78a4da9a704e380",
 "TOOL_SELECTION_GENERIC_V5_SYSTEM.md":"e520242011970ad10338a9b764896db2ada38bd6",
 "capability_registry_sample_v01.json":"af277812ec2064d3a1456c199da7ae7beb8b07d1"
}
def sha(b):return hashlib.sha256(b).hexdigest()
def canonical(obj):return json.dumps(obj,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode("utf8")
def save(obj,name="run.json"): (E/name).write_text(json.dumps(obj,indent=2,ensure_ascii=False)+"\n",encoding="utf8")
def check_inputs():
  # git blob SHA1 computed with GitHub's blob prefix: no external data mutation.
  for name,want in PIN.items():
    raw=(ROOT/name).read_bytes()
    ident=hashlib.sha1(("blob "+str(len(raw))+"\0").encode()+raw).hexdigest()
    if ident!=want:raise RuntimeError("FROZEN_INPUT_BLOB_MISMATCH:"+name+":"+ident)
  return {name:sha((ROOT/name).read_bytes()) for name in PIN}

def main():
  hashes=check_inputs()
  challenge=json.loads((ROOT/"challenge.json").read_text())
  prompt=(ROOT/"TOOL_SELECTION_GENERIC_V5_SYSTEM.md").read_text()
  catalog=json.loads((ROOT/"capability_registry_sample_v01.json").read_text())
  reference_instruction=("REFERENCE SAMPLE: The following is an INCOMPLETE computational capability registry sample. "+
    "Read it as evidence-scoped reference data, NOT a solution, toolchain or exhaustive catalog. "+
    "When selecting a listed operation, cite its exact operation_id, tested version and relevant scoped evidence "+
    "in your tool_selection_justification; when it lacks an essential computation, independently discover "+
    "and select another concrete tool, mark its capability UNVERIFIED until tested. "+
    "Do not repeat or rely on results from any prior model experiment. "+
    "Do not overclaim package imports, narrow synthetic probes or proposed interfaces. "+
    "Use the same response JSON schema given in the system message. "+
    "Identify catalog insufficiencies in unresolved_gaps and requirement_to_tool_mapping. "+
    "Your final answer must address the ORIGINAL QUESTION in the next message. "+
    "REFERENCE SAMPLE JSON:\n"+json.dumps(catalog,ensure_ascii=False,sort_keys=True))
  messages=[{"role":"system","content":prompt},
            {"role":"user","content":reference_instruction},
            {"role":"user","content":json.dumps(challenge,ensure_ascii=False)}]
  receipt={
    "experiment":"aau-kimi26-registry-reference-v01",
    "stage":"STAGE1_SELECTION_ONLY","model":"kimi-k2.6","thinking_requested":"enabled",
    "prompt_separated_from_question":True,"original_task_not_rewritten":True,
    "catalog_used_as_reference_only":True,"baseline_run_id":39451190485,
    "frozen_file_sha256":hashes,"request_messages_sha256":sha(canonical(messages)),
    "attempt_count":1,"automatic_retries":0,"no_tools_exposed":True,
    "stage2_authorized":False,"status":"STARTED","independent_grade":"NOT_YET_GRADED",
    "provider_receipt":None,"raw_response_content":None,"model_proposal":None
  }
  save(receipt)
  key=os.environ.get("MOONSHOT_API_KEY","").strip()
  if not key:
    receipt["status"]="BLOCKED_MOONSHOT_API_KEY_MISSING";save(receipt)
    print("AAU_REGISTRY_SELECTION="+json.dumps({"status":receipt["status"]}))
    return 2
  payload={"model":MODEL,"thinking":{"type":"enabled"},"temperature":1.0,
    "response_format":{"type":"json_object"},"max_tokens":32768,
    "stream":True,"stream_options":{"include_usage":True},"messages":messages}
  receipt["request_parameters"]={k:payload[k] for k in ("model","thinking","temperature","response_format","max_tokens","stream","stream_options")}
  req=urllib.request.Request("https://api.moonshot.ai/v1/chat/completions",
     data=json.dumps(payload,ensure_ascii=False).encode("utf8"),
     headers={"Authorization":"Bearer "+key,"Content-Type":"application/json","Accept":"text/event-stream",
              "User-Agent":"AAU-Kimi26-Frozen-Tool-Selection-v5"},method="POST")
  started=time.monotonic();parts=[];reason_hasher=hashlib.sha256();usage={}
  packets=0;reason_chunks=0;malformed=0;done=False;finish=None;served=None;response_id=None;first_event=None
  try:
    with urllib.request.urlopen(req,timeout=420) as stream:
      for lineb in stream:
        line=lineb.decode("utf8",errors="replace").strip()
        if not line.startswith("data:"):continue
        data=line[5:].strip()
        if data=="[DONE]":done=True;break
        try:event=json.loads(data)
        except json.JSONDecodeError:
          malformed+=1;continue
        if first_event is None:first_event=round(time.monotonic()-started,3)
        packets+=1
        served=event.get("model") or served
        response_id=event.get("id") or response_id
        if event.get("usage"):usage=event["usage"]
        for choice in event.get("choices") or []:
          if choice.get("finish_reason"):finish=choice["finish_reason"]
          delta=choice.get("delta") or {}
          if isinstance(delta.get("content"),str):parts.append(delta["content"])
          if isinstance(delta.get("reasoning_content"),str):
            reason_hasher.update(delta["reasoning_content"].encode("utf8"));reason_chunks+=1
        if packets%60==0:
          receipt["stream_progress"]={"events":packets,"reasoning_chunks":reason_chunks,
                 "content_chars":sum(len(t) for t in parts),"elapsed_s":round(time.monotonic()-started,3)}
          receipt["raw_response_content"]="".join(parts)
          save(receipt)
    raw="".join(parts);receipt["raw_response_content"]=raw
    receipt["wall_seconds"]=round(time.monotonic()-started,3)
    receipt["provider_receipt"]={
      "model_returned":served,"response_id":response_id,"finish_reason":finish,
      "stream_done":done,"events":packets,"malformed_events":malformed,"first_event_s":first_event,
      "reasoning_chunks":reason_chunks,"reasoning_content_sha256":reason_hasher.hexdigest(),
      "reasoning_observed":reason_chunks>0,"usage":usage,
      "reasoning_tokens":(usage.get("completion_tokens_details") or {}).get("reasoning_tokens"),
      "response_content_sha256":sha(raw.encode("utf8"))
    }
    if not done or finish!="stop" or served!=MODEL or not raw.strip() or reason_chunks==0:
      receipt["status"]="INCOMPLETE_PROVIDER_RESPONSE"
    else:
      normalized=raw
      stripped=raw.strip()
      receipt["normalization"]="none"
      if stripped.startswith("```json\n") and stripped.endswith("\n```"):
        normalized=stripped[len("```json\n"):-len("\n```")]
        receipt["normalization"]="single_outer_json_fence_only"
      elif stripped.startswith("```\n") and stripped.endswith("\n```"):
        normalized=stripped[len("```\n"):-len("\n```")]
        receipt["normalization"]="single_outer_fence_only"
      receipt["normalized_sha256"]=sha(normalized.encode("utf8"))
      try:
        obj=json.loads(normalized)
        if isinstance(obj,dict):
          receipt["model_proposal"]=obj
          receipt["status"]="PROPOSED_PENDING_INDEPENDENT_GATE"
        else:receipt["status"]="INVALID_JSON_ROOT"
      except Exception as exc:
        receipt["status"]="JSON_PARSE_FAILURE"
        receipt["json_error"]=str(exc)[:300]
  except Exception as exc:
    receipt["status"]="PROVIDER_OR_TRANSPORT_FAILURE"
    receipt["error_category"]=type(exc).__name__
    receipt["error_status"]=getattr(exc,"code",None)
    receipt["error_sanitized"]=str(getattr(exc,"code","") or str(exc))[:240]
    receipt["wall_seconds"]=round(time.monotonic()-started,3)
    receipt["raw_response_content"]="".join(parts)
  save(receipt)
  print("AAU_REGISTRY_SELECTION="+json.dumps({
    "status":receipt["status"],"model_returned":(receipt.get("provider_receipt") or {}).get("model_returned"),
    "thinking_observed":(receipt.get("provider_receipt") or {}).get("reasoning_observed"),
    "finish_reason":(receipt.get("provider_receipt") or {}).get("finish_reason"),
    "tokens":(receipt.get("provider_receipt") or {}).get("usage",{}).get("total_tokens"),
    "wall_seconds":receipt.get("wall_seconds"),"error_category":receipt.get("error_category"),
    "stage2_authorized":False
  }),flush=True)
  return 0 if receipt["status"]=="PROPOSED_PENDING_INDEPENDENT_GATE" else 1

if __name__=="__main__":sys.exit(main())
