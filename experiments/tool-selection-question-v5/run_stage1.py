#!/usr/bin/env python3
"""AAU K2.6 question-first Stage-1 tool selection. One SSE inference, research only."""
import hashlib, json, os, pathlib, time, urllib.request, urllib.error
from datetime import datetime, timezone

HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parent/"tool-selection-restoration"
OUTPUT=HERE/"evidence"
OUTPUT.mkdir(exist_ok=True,parents=True)
MODEL="kimi-k2.6"
FROZEN={
    "system_blob":"c26817e308ee4dfb36c98e188e3ff8cbae527163",
    "challenge_blob":"e51781a1a000f59f8c5ba508698c513d6c90bdb6",
    "rubric_blob":"e19e740ebbe52c8772faa34685ffb4165b3883ec",
    "supplement_blob":"2eab486b7a95ca635637769bf78a4da9a704e380"
}
def git_blob(data):
    return hashlib.sha1(b"blob "+str(len(data)).encode()+b"\0"+data).hexdigest()
def sha(data):
    return hashlib.sha256(data).hexdigest()
def dump(name,obj):
    (OUTPUT/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
def now():
    return datetime.now(timezone.utc).isoformat()
def main():
    paths={"system_blob":HERE/"system-prompt.md",
           "challenge_blob":ROOT/"challenge.json",
           "rubric_blob":ROOT/"rubric.json",
           "supplement_blob":ROOT/"appropriateness_rubric_v1.json"}
    bytes_map={k:p.read_bytes() for k,p in paths.items()}
    actual={k:git_blob(value) for k,value in bytes_map.items()}
    entry={"trial":"AAU_K26_QUESTION_TOOL_SELECTION_V5","model_requested":MODEL,
           "thinking":{"type":"enabled"},"stream":True,"temperature":1.0,"max_tokens":32768,
           "started_at":now(),"status":"PREFLIGHT","stage2_authorized":False,
           "frozen_blob_expected":FROZEN,"frozen_blob_actual":actual,
           "file_sha256":{k:sha(v) for k,v in bytes_map.items()},
           "usage":None,"provider_finish_reason":None,
           "model_response_observed":False,"independent_gate_status":"NOT_EVALUATED"}
    dump("run.json",entry)
    if any(actual[k]!=v for k,v in FROZEN.items()):
        entry.update(status="FROZEN_FILE_MISMATCH")
        dump("run.json",entry)
        return 2
    key=os.getenv("MOONSHOT_API_KEY","").strip()
    if not key:
        entry.update(status="MISSING_MOONSHOT_API_KEY")
        dump("run.json",entry)
        return 2
    messages=[{"role":"system","content":bytes_map["system_blob"].decode("utf-8")},
              {"role":"user","content":bytes_map["challenge_blob"].decode("utf-8")}]
    payload={"model":MODEL,"thinking":{"type":"enabled"},"temperature":1.0,
             "response_format":{"type":"json_object"},"max_tokens":32768,
             "stream":True,"stream_options":{"include_usage":True},"messages":messages}
    entry.update(status="STARTED","message_count":2,"request_sha256":sha(json.dumps(
      payload,sort_keys=True,ensure_ascii=False,separators=(",",":")).encode()))
    dump("run.json",entry)
    req=urllib.request.Request("https://api.moonshot.ai/v1/chat/completions",
      data=json.dumps(payload,ensure_ascii=False).encode("utf-8"),
      headers={"Authorization":"Bearer "+key,"Content-Type":"application/json",
               "Accept":"text/event-stream"},method="POST")
    start=time.monotonic();parts=[];reason_hash=hashlib.sha256();reason_count=0
    packet_count=0; first=None; done=False; finish=None; usage={}; model=None; response_id=None
    malformed_events=0
    try:
        with urllib.request.urlopen(req,timeout=420) as stream:
            for raw_line in stream:
                line=raw_line.decode("utf-8",errors="replace").strip()
                if not line.startswith("data:"): continue
                packet_text=line[5:].strip()
                if packet_text=="[DONE]":
                    done=True
                    break
                try:
                    packet=json.loads(packet_text)
                except json.JSONDecodeError:
                    malformed_events+=1
                    continue
                packet_count+=1
                if first is None:first=round(time.monotonic()-start,3)
                if packet.get("usage"):usage=packet["usage"]
                model=packet.get("model") or model
                response_id=packet.get("id") or response_id
                for choice in packet.get("choices") or []:
                    finish=choice.get("finish_reason") or finish
                    delta=choice.get("delta") or {}
                    if isinstance(delta.get("reasoning_content"),str):
                        reason_hash.update(delta["reasoning_content"].encode())
                        reason_count+=1
                    if isinstance(delta.get("content"),str):
                        parts.append(delta["content"])
                if packet_count%50==0:
                    partial="".join(parts)
                    (OUTPUT/"partial_response.txt").write_text(partial,encoding="utf-8")
                    entry["stream_progress"]={"events":packet_count,"reasoning_chunks":reason_count,
                                              "elapsed_seconds":round(time.monotonic()-start,3),
                                              "content_characters":len(partial)}
                    dump("run.json",entry)
        raw="".join(parts)
        (OUTPUT/"raw_response.txt").write_text(raw,encoding="utf-8")
        entry.update(model_response_observed=packet_count>0,model_returned=model,
            response_id=response_id,stream_events=packet_count,stream_done=done,
            malformed_events=malformed_events,first_event_seconds=first,
            reasoning_chunk_count=reason_count,reasoning_sha256=reason_hash.hexdigest(),
            provider_finish_reason=finish,usage=usage,
            reasoning_tokens=(usage.get("completion_tokens_details") or {}).get("reasoning_tokens"),
            response_sha256=sha(raw.encode()),response_characters=len(raw),
            wall_seconds=round(time.monotonic()-start,3))
        if model!=MODEL:
            entry.update(status="MODEL_MISMATCH")
        elif not done or finish!="stop":
            entry.update(status="INCOMPLETE_PROVIDER_OUTPUT")
        else:
            normalized=raw.strip()
            normalization="none"
            fence=chr(96)*3
            if normalized.startswith(fence+"json\n") and normalized.endswith("\n"+fence):
                normalized=normalized[len(fence+"json\n"):-len("\n"+fence)].strip()
                normalization="outer_json_fence_only"
            elif normalized.startswith(fence+"\n") and normalized.endswith("\n"+fence):
                normalized=normalized[len(fence+"\n"):-len("\n"+fence)].strip()
                normalization="outer_fence_only"
            entry["normalization"]=normalization
            entry["normalized_response_sha256"]=sha(normalized.encode())
            try:
                parsed=json.loads(normalized)
                if not isinstance(parsed,dict): raise ValueError("JSON_ROOT_NOT_OBJECT")
                dump("parsed_proposal.json",parsed)
                entry.update(status="COMPLETE_PENDING_EXTERNAL_GATE",
                    thinking_observed=reason_count>0)
            except (json.JSONDecodeError,ValueError) as ex:
                entry.update(status="INVALID_JSON",parse_error=str(ex)[:240])
    except urllib.error.HTTPError as ex:
        entry.update(status="HTTP_PROVIDER_FAILURE",provider_http_status=ex.code,
             error_body_sanitized=ex.read(400).decode(errors="replace")[:400])
    except Exception as ex:
        entry.update(status="PROVIDER_OR_STREAM_FAILURE",error_type=type(ex).__name__,
                     error_sanitized=str(ex)[:300])
    finally:
        raw="".join(parts)
        if raw and not (OUTPUT/"raw_response.txt").exists():
            (OUTPUT/"partial_response.txt").write_text(raw,encoding="utf-8")
        entry.update(completed_at=now(),wall_seconds=round(time.monotonic()-start,3))
        dump("run.json",entry)
        print("AAU_K26_V5="+json.dumps({k:entry.get(k) for k in ["status","model_returned",
             "provider_finish_reason","wall_seconds","response_sha256","reasoning_tokens",
             "usage","independent_gate_status"]},ensure_ascii=False),flush=True)
    return 0 if entry["status"]=="COMPLETE_PENDING_EXTERNAL_GATE" else 1

if __name__=="__main__":
    raise SystemExit(main())
