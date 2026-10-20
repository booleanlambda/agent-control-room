#!/usr/bin/env python3
"""Kimi K2.6 clean Stage-1 tool-selection live SSE inference; no physical operations or Stage 2."""
import hashlib
import json
import os
from pathlib import Path
import platform
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

ROOT=Path(__file__).resolve().parent
BENCH=ROOT.parent/"tool-selection-restoration"
OUT=ROOT/"evidence"
OUT.mkdir(parents=True,exist_ok=True)
MODEL="kimi-k2.6"

def sha(raw): return hashlib.sha256(raw).hexdigest()
def canonical(obj): return json.dumps(obj,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode("utf-8")
def now(): return datetime.now(timezone.utc).isoformat()
def dump(filename,obj):
    (OUT/filename).write_text(json.dumps(obj,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
def fail(record,label,detail=None):
    record["status"]=label
    if detail: record["error_category"]=detail
    dump("run.json",record)
    print("AAU_K26_V5="+json.dumps({"status":record["status"],"error_category":record.get("error_category")}))
    return 1

def normalize_json(raw):
    clean=raw.strip()
    operation="none"
    if clean.startswith("```json\n") and clean.endswith("\n```"):
        clean=clean[8:-4].strip()
        operation="outer_json_fence_only"
    elif clean.startswith("```\n") and clean.endswith("\n```"):
        clean=clean[4:-4].strip()
        operation="outer_fence_only"
    value=json.loads(clean)
    if not isinstance(value,dict): raise ValueError("JSON_ROOT_NOT_OBJECT")
    return value,operation,sha(clean.encode())

def verify_structure(model):
    """Only deterministic JSON/interface structural tests, never claim domain/physics verification."""
    required={
      "problem_formulation":dict,
      "required_computations":list,
      "selected_tools":list,
      "tool_selection_justification":list,
      "rejected_alternatives":list,
      "execution_sequence":list,
      "interface_contracts":list,
      "requirement_to_tool_mapping":list,
      "installation_and_test_commands":list,
      "independent_verification_tests":list,
      "resource_and_performance_analysis":dict,
      "unresolved_gaps":list,
      "self_assessment":dict,
      "stage2_authorized":bool,
    }
    failures=[]
    for key,cls in required.items():
        if key not in model: failures.append("MISSING_KEY:"+key)
        elif not isinstance(model[key],cls): failures.append("WRONG_TYPE:"+key)
    if failures: return {"status":"FAILED_SCHEMA","failures":failures,"stage1_external_gate":"NOT_RUN"}
    if model["stage2_authorized"] is not False: failures.append("STAGE2_AUTHORIZED_BY_MODEL")
    tools=model["selected_tools"];computations=model["required_computations"];tests=model["independent_verification_tests"]
    toolids=[t.get("id") for t in tools if isinstance(t,dict)]
    compids=[c.get("id") for c in computations if isinstance(c,dict)]
    testids=[t.get("id") for t in tests if isinstance(t,dict)]
    for tag,items in (("tool",toolids),("computation",compids),("test",testids)):
        if not items or any(not isinstance(x,str) or not x.strip() for x in items): failures.append("EMPTY_OR_INVALID_"+tag+"_IDS")
        if len(items)!=len(set(items)): failures.append("DUPLICATE_"+tag+"_IDS")
    T=set(toolids);C=set(compids);V=set(testids)
    for t in tools:
        if isinstance(t,dict):
            for cid in t.get("computation_ids",[]):
                if cid not in C: failures.append("BAD_TOOL_COMPUTATION_REF:"+str(cid))
    for mapping in model["requirement_to_tool_mapping"]:
        if not isinstance(mapping,dict): failures.append("INVALID_MAPPING");continue
        cid=mapping.get("computation_id")
        if cid not in C: failures.append("BAD_MAPPING_COMPUTATION:"+str(cid))
        for tid in mapping.get("tool_ids",[]):
            if tid not in T: failures.append("UNKNOWN_SELECTED_TOOL:"+str(tid))
        for vid in mapping.get("validator_test_ids",[]):
            if vid not in V: failures.append("UNKNOWN_TEST_ID:"+str(vid))
    for edge in model["interface_contracts"]:
        if not isinstance(edge,dict): failures.append("INVALID_INTERFACE");continue
        for prop in ("from_tool_id","to_tool_id"):
            if edge.get(prop) not in T: failures.append("UNKNOWN_INTERFACE_"+prop+":"+str(edge.get(prop)))
    for command in model["installation_and_test_commands"]:
        if isinstance(command,dict) and command.get("execution_status")!="NOT_RUN":
            failures.append("INVALID_EXECUTION_EVIDENCE_CLAIM")
    for test in model["independent_verification_tests"]:
        if isinstance(test,dict) and test.get("execution_status")!="NOT_RUN":
            failures.append("INVALID_TEST_EVIDENCE_CLAIM")
    return {"status":"STRUCTURAL_ONLY" if not failures else "FAILED_SCHEMA",
      "failures":failures,"stage1_external_gate":"NOT_RUN",
      "note":"Schema and cross-references do not verify whether named tools can solve the task."}

def main():
    challenge_path=BENCH/"challenge.json"
    original_rubric_path=BENCH/"rubric.json"
    appropriateness_path=BENCH/"appropriateness_rubric_v1.json"
    prompt_path=ROOT/"system-prompt.txt"
    challenge_bytes=challenge_path.read_bytes()
    rubric_bytes=original_rubric_path.read_bytes()
    appropriateness_bytes=appropriateness_path.read_bytes()
    prompt_bytes=prompt_path.read_bytes()
    expected={
      "challenge_git_blob":"e51781a1a000f59f8c5ba508698c513d6c90bdb6",
      "rubric_git_blob":"e19e740ebbe52c8772faa34685ffb4165b3883ec",
      "appropriateness_git_blob":"2eab486b7a95ca635637769bf78a4da9a704e380",
    }
    messages=[
      {"role":"system","content":prompt_bytes.decode("utf-8")},
      {"role":"user","content":challenge_bytes.decode("utf-8")},
    ]
    record={
      "experiment":"AAU-K26-GENERAL-TOOLCHAIN-V5",
      "stage":"STAGE1_TOOL_SELECTION_ONLY",
      "model_requested":MODEL,
      "thinking_requested":{"type":"enabled"},
      "attempts":1,"stage2_authorized":False,
      "tool_calls_to_model":0,"solver_execution":False,
      "prompt_sha256":sha(prompt_bytes),"challenge_sha256":sha(challenge_bytes),
      "original_rubric_sha256":sha(rubric_bytes),
      "supplement_rubric_sha256":sha(appropriateness_bytes),
      "messages_sha256":sha(canonical(messages)),
      "frozen_source_blobs":expected,
      "rubrics_sent_to_model":False,
      "messages_roles":["system","user"],
      "started_at":now(),"runtime":{"python":sys.version,"platform":platform.platform()},
      "status":"STARTED","stage1_external_verdict":"NOT_EVALUATED",
    }
    dump("run.json",record)
    key=(os.environ.get("MOONSHOT_API_KEY") or os.environ.get("MOONSHOT_APIKEY") or "").strip()
    if not key: return fail(record,"BLOCKED","MOONSHOT_API_KEY_MISSING")
    body={"model":MODEL,"thinking":{"type":"enabled"},"temperature":1.0,
      "response_format":{"type":"json_object"},"max_tokens":32768,
      "stream":True,"stream_options":{"include_usage":True},"messages":messages}
    dump("request-metadata.json",{"model":MODEL,"thinking":body["thinking"],
       "temperature":1.0,"max_tokens":32768,"response_format":body["response_format"],
       "stream":True,"stream_options":body["stream_options"],"messages_sha256":record["messages_sha256"]})
    endpoint="https://api.moonshot.ai/v1/chat/completions"
    req=urllib.request.Request(endpoint,method="POST",data=json.dumps(body,ensure_ascii=False).encode(),
       headers={"Authorization":"Bearer "+key,"Content-Type":"application/json","Accept":"text/event-stream",
                "User-Agent":"AAU-K26-V5-Toolchain-Test/1.0"})
    begin=time.monotonic();parts=[];reason_hasher=hashlib.sha256()
    events=0;reason_chunks=0;bad_events=0;first_event=None;done=False
    response_id=None;response_model=None;usage={};finish=None
    try:
        with urllib.request.urlopen(req,timeout=420) as stream:
            for raw_line in stream:
                line=raw_line.decode("utf-8",errors="replace").strip()
                if not line.startswith("data:"):continue
                raw_event=line[5:].strip()
                if raw_event=="[DONE]":done=True;break
                try:packet=json.loads(raw_event)
                except json.JSONDecodeError:bad_events+=1;continue
                events+=1
                if first_event is None:first_event=round(time.monotonic()-begin,3)
                if packet.get("usage"):usage=packet["usage"]
                response_id=packet.get("id") or response_id
                response_model=packet.get("model") or response_model
                for choice in packet.get("choices") or []:
                    finish=choice.get("finish_reason") or finish
                    delta=choice.get("delta") or {}
                    if isinstance(delta.get("content"),str):parts.append(delta["content"])
                    if isinstance(delta.get("reasoning_content"),str):
                        reason_hasher.update(delta["reasoning_content"].encode("utf-8"));reason_chunks+=1
                if events%60==0:
                    record["stream_progress"]={"events":events,"reasoning_chunks":reason_chunks,
                      "content_chars":sum(len(p) for p in parts),
                      "elapsed_seconds":round(time.monotonic()-begin,3)}
                    (OUT/"raw-partial.txt").write_text("".join(parts),encoding="utf-8")
                    dump("run.json",record)
        raw="".join(parts)
        (OUT/"raw-model-response.txt").write_text(raw,encoding="utf-8")
        record["provider_receipt"]={
          "response_id":response_id,"model_returned":response_model,
          "finish_reason":finish,"stream_done":done,"events":events,"unparseable_events":bad_events,
          "first_event_seconds":first_event,"reasoning_chunks":reason_chunks,
          "reasoning_content_sha256":reason_hasher.hexdigest(),
          "usage":usage,
          "reasoning_tokens":(usage.get("completion_tokens_details") or {}).get("reasoning_tokens"),
          "raw_content_sha256":sha(raw.encode("utf-8"))}
        if response_model!=MODEL:record["status"]="MODEL_MISMATCH"
        elif not done or finish!="stop":record["status"]="INCOMPLETE_PROVIDER_RESPONSE"
        elif not reason_chunks:record["status"]="THINKING_NOT_OBSERVED"
        else:
            parsed,normalization,normalized_hash=normalize_json(raw)
            dump("toolchain-proposal.json",parsed)
            record["normalization"]=normalization
            record["normalized_content_sha256"]=normalized_hash
            checker=verify_structure(parsed)
            dump("structural-verifier.json",checker)
            record["status"]="COMPLETED_PENDING_INDEPENDENT_GATE" if checker["status"]=="STRUCTURAL_ONLY" else "INVALID_RESPONSE_SCHEMA"
            record["structural_verifier_status"]=checker["status"]
    except urllib.error.HTTPError as exc:
        record["status"]="PROVIDER_ERROR"
        record["error_category"]="HTTP_"+str(exc.code)
        record["error_detail_sanitized"]=exc.read(900).decode(errors="replace")[:900]
    except Exception as exc:
        record["status"]="PROVIDER_OR_RESPONSE_ERROR"
        record["error_category"]=type(exc).__name__
        record["error_detail_sanitized"]=str(exc)[:250]
    finally:
        if parts and not (OUT/"raw-model-response.txt").exists():
            (OUT/"raw-partial.txt").write_text("".join(parts),encoding="utf-8")
        record["elapsed_seconds"]=round(time.monotonic()-begin,3)
        record["completed_at"]=now()
        dump("run.json",record)
        print("AAU_K26_V5="+json.dumps({
          "status":record["status"],"model":MODEL,
          "reasoning_chunks":reason_chunks,"events":events,"finish_reason":finish,
          "total_tokens":usage.get("total_tokens"),"error_category":record.get("error_category"),
          "elapsed_seconds":record["elapsed_seconds"],"stage1_external_verdict":"NOT_EVALUATED"
        },ensure_ascii=False))
    return 0 if record["status"]=="COMPLETED_PENDING_INDEPENDENT_GATE" else 1

if __name__=="__main__":
    raise SystemExit(main())
