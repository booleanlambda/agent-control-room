"""One streamed Moonshot thinking-ON call: select tools for a difficult task.
No computational tools installed or used; strictly phase-one hypothesis generation.
Pre-registered grade rubric remains withheld from the model.
"""
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.request
import urllib.error

ROOT=Path(__file__).resolve().parent
EVIDENCE=ROOT/"evidence"
EVIDENCE.mkdir(parents=True,exist_ok=True)
MODEL="kimi-k3"
def sha(blob):
    return hashlib.sha256(blob).hexdigest()
def canonical(x):
    return json.dumps(x,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()

def main():
    challenge_bytes=(ROOT/"challenge.json").read_bytes()
    rubric_bytes=(ROOT/"rubric.json").read_bytes()
    challenge=json.loads(challenge_bytes)
    key=os.environ.get("MOONSHOT_API_KEY","").strip()
    if not key:
        raise RuntimeError("MOONSHOT_PROVIDER_KEY_MISSING")
    system=("You are Kimi, a resource-constrained autonomous research and engineering "
            "coordinator. Thinking is enabled. You must FIRST determine which "
            "computational tools are actually needed to solve a difficult physical "
            "operations problem. No tools, installed packages, pre-selected tool "
            "catalog, or answer key are supplied. Do not run tools, solve the "
            "restoration problem, fabricate data, or claim real operations. "
            "Choose named software deliberately and justify what each tool does, "
            "its required inputs, produced outputs and known limitations. "
            "Return a single complete JSON object with keys: "
            "problem_interpretation (string), essential_tools (array of objects), "
            "optional_tools (array of objects), execution_graph (array of steps), "
            "validation_and_independent_audit (object), uncertainty_strategy (object), "
            "missing_inputs (array), resource_budget_and_fallback (object), "
            "safety_constraints (array), evidence_gaps (array). Each essential or "
            "optional tool should have name, purpose, input_requirements, output_artifact, "
            "limits, justification fields. Your success is assessed on whether this "
            "set of tools genuinely suffices to build and verify a feasible solution. "
            "An expensive or unsuitable tool should not be recommended without a reason. "
            "No numerical solution is requested at this stage. JSON only.")
    messages=[{"role":"system","content":system},
              {"role":"user","content":json.dumps(challenge,ensure_ascii=False)}]
    payload={"model":MODEL,"thinking":{"type":"enabled"},"temperature":1.0,
             "response_format":{"type":"json_object"},"max_tokens":32768,
             "stream":True,"stream_options":{"include_usage":True},"messages":messages}
    receipt={
      "stage":"STAGE1_TOOL_SELECTION_ONLY",
      "attempts":1,"model":MODEL,"thinking":"enabled",
      "tool_calls_permitted":0,"solver_executions_permitted":0,
      "challenge_sha256":sha(challenge_bytes),
      "sealed_rubric_sha256":sha(rubric_bytes),
      "prompt_sha256":sha(canonical(messages)),
      "request_parameters":{"model":MODEL,"thinking":payload["thinking"],
                            "temperature":payload["temperature"],
                            "max_tokens":payload["max_tokens"],
                            "response_format":payload["response_format"]},
      "status":"STARTED_STREAMING","streaming":True,"provider_receipt":None,
      "raw_response_content":None,
      "model_proposal":None,"stage2_triggered":False}
    def save():
        (EVIDENCE/"stage1-provider-receipt.json").write_text(json.dumps(receipt,indent=2,ensure_ascii=False))
    save()
    req=urllib.request.Request("https://api.moonshot.ai/v1/chat/completions",
      data=json.dumps(payload).encode(),
      headers={"Authorization":"Bearer "+key,
               "Content-Type":"application/json","Accept":"text/event-stream"},
      method="POST")
    begin=time.monotonic()
    try:
        raw_parts=[]
        reason_hasher=hashlib.sha256()
        reason_chunks=0
        chunks=0
        usage={}
        finish_reason=None
        model_name=None
        response_id=None
        done=False
        first_event_seconds=None
        with urllib.request.urlopen(req,timeout=300) as response:
            for bytes_line in response:
                line=bytes_line.decode("utf-8",errors="replace").strip()
                if not line.startswith("data:"):
                    continue
                payload_line=line[5:].strip()
                if payload_line=="[DONE]":
                    done=True
                    break
                try:
                    packet=json.loads(payload_line)
                except json.JSONDecodeError:
                    receipt["unparseable_stream_events"]=receipt.get("unparseable_stream_events",0)+1
                    continue
                chunks+=1
                if first_event_seconds is None:
                    first_event_seconds=round(time.monotonic()-begin,3)
                if packet.get("usage"):
                    usage=packet["usage"]
                model_name=packet.get("model") or model_name
                response_id=packet.get("id") or response_id
                for choice in packet.get("choices") or []:
                    if choice.get("finish_reason"):
                        finish_reason=choice["finish_reason"]
                    delta=choice.get("delta") or {}
                    if delta.get("content"):
                        raw_parts.append(delta["content"])
                    if delta.get("reasoning_content"):
                        reason_hasher.update(delta["reasoning_content"].encode())
                        reason_chunks+=1
                if chunks%60==0:
                    receipt["stream_progress"]={
                       "events":chunks,"reasoning_chunks":reason_chunks,
                       "content_chars":sum(len(x) for x in raw_parts),
                       "elapsed_seconds":round(time.monotonic()-begin,3)}
                    save()
        receipt["wall_seconds"]=round(time.monotonic()-begin,3)
        raw="".join(raw_parts)
        receipt["provider_receipt"]={
          "response_model":model_name,
          "finish_reason":finish_reason,
          "stream_done":done,
          "stream_events":chunks,
          "first_event_seconds":first_event_seconds,
          "reasoning_chunks":reason_chunks,
          "usage":usage,
          "reasoning_tokens":(usage.get("completion_tokens_details") or {}).get("reasoning_tokens"),
          "reasoning_content_sha256":reason_hasher.hexdigest(),
          "reasoning_content_present":reason_chunks>0,
          "content_sha256":sha(raw.encode()),
          "provider_response_id":response_id}
        receipt["raw_response_content"]=raw
        if not done or finish_reason!="stop":
            receipt["status"]="UNFINISHED_MODEL_STREAM"
        else:
            proposal=json.loads(raw)
            receipt["model_proposal"]=proposal
            receipt["status"]="PROPOSED_PENDING_INDEPENDENT_GATE" if isinstance(proposal,dict) else "INVALID_JSON_ROOT"
    except Exception as ex:
        receipt["wall_seconds"]=round(time.monotonic()-begin,3)
        receipt["error_class"]=type(ex).__name__
        receipt["error_http_code"]=getattr(ex,"code",None)
        receipt["status"]="PROVIDER_OR_JSON_FAILURE"
    save()
    print("AAU_HARD_STAGE1="+json.dumps({
       "status":receipt["status"],
       "thinking":receipt["thinking"],
       "stage2_triggered":False,
       "provider_tokens":(receipt.get("provider_receipt") or {}).get("usage",{}).get("total_tokens"),
       "reasoning_tokens":(receipt.get("provider_receipt") or {}).get("reasoning_tokens"),
       "finish_reason":(receipt.get("provider_receipt") or {}).get("finish_reason"),
       "content_sha256":(receipt.get("provider_receipt") or {}).get("content_sha256"),
       "challenge_sha256":receipt["challenge_sha256"],
       "rubric_sha256":receipt["sealed_rubric_sha256"]}))
    if receipt["status"]!="PROPOSED_PENDING_INDEPENDENT_GATE":
        raise RuntimeError(receipt["status"])
if __name__=="__main__":
    main()
