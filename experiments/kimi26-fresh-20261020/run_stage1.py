#!/usr/bin/env python3
"""Re-run isolated Kimi K2.6 Stage-1 on proven SSE transport. One provider call; no production side effects."""
import hashlib, json, os, pathlib, platform, sys, time, urllib.request, urllib.error
from datetime import datetime, timezone
from urllib.parse import urlparse

ROOT = pathlib.Path(__file__).resolve().parent
OUTPUT = ROOT / "evidence_stream_v1"
OUTPUT.mkdir(exist_ok=True)
PROMPT_PATH = ROOT / "stage1-prompt.md"
EXPECTED_SHA256 = "c030622cab004c5acb0e79c771b42bba5559b000e08e99289d5a87b4f4e3b473"
MODEL = "kimi-k2.6"

def now():
    return datetime.now(timezone.utc).isoformat()

def sha(data):
    return hashlib.sha256(data).hexdigest()

def save(name, obj):
    (OUTPUT / name).write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

def main():
    prompt = PROMPT_PATH.read_bytes()
    digest = sha(prompt)
    run = {
      "experiment": "kimi26-fresh-toolchain-20261020-stream-v1",
      "retest_reason": "Independent transport remediation of first non-streaming RemoteDisconnected",
      "original_failed_attempt_retained": "evidence/run.json",
      "model_requested": MODEL, "thinking_requested": {"type":"enabled"},
      "prompt_sha256":digest, "prompt_verified":digest == EXPECTED_SHA256,
      "started_at":now(), "runtime":{"python":sys.version,"platform":platform.platform()},
      "status":"STARTED", "stage1_verification":"UNVERIFIED", "model_response_observed":False,
      "stage2_authorized":False, "attempts":1, "streaming":True,
    }
    save("run.json", run)
    if not run["prompt_verified"]:
        run.update(status="BLOCKED",error_category="PROMPT_HASH_MISMATCH")
        save("run.json",run)
        return 2
    api_key = (os.getenv("MOONSHOT_API_KEY") or os.getenv("MOONSHOT_APIKEY") or "").strip()
    if not api_key:
        run.update(status="BLOCKED",error_category="MISSING_GITHUB_MOONSHOT_SECRET")
        save("run.json",run)
        return 2
    endpoint = (os.getenv("MOONSHOT_ENDPOINT") or "https://api.moonshot.ai/v1/chat/completions").rstrip("/")
    if endpoint.endswith("/v1"): endpoint += "/chat/completions"
    elif not endpoint.endswith("/chat/completions"): endpoint += "/v1/chat/completions"
    parsed = urlparse(endpoint)
    if parsed.scheme != "https" or parsed.netloc not in ("api.moonshot.ai","api.moonshot.cn"):
        run.update(status="BLOCKED",error_category="UNTRUSTED_PROVIDER_ENDPOINT")
        save("run.json",run)
        return 2
    run["endpoint_host"]=parsed.netloc
    # Same frozen user prompt; only transport differs from failed first attempt.
    body = {
      "model": MODEL,
      "messages": [{"role":"user","content":prompt.decode("utf-8")}],
      "temperature":1.0,"max_tokens":32768,
      "thinking":{"type":"enabled"},
      "stream":True,"stream_options":{"include_usage":True},
    }
    save("request-metadata.json",{
      "model":MODEL,"temperature":1.0,"max_tokens":32768,
      "thinking":body["thinking"],"stream":True,"stream_options":body["stream_options"],
      "response_format":"provider_default","prompt_sha256":digest,
      "message_count":1,"endpoint_host":parsed.netloc,
      "changed_from_original":["SSE_streaming","explicit_provider_temperature_1"]
    })
    req = urllib.request.Request(endpoint, data=json.dumps(body,ensure_ascii=False).encode("utf-8"),
          headers={"Authorization":"Bearer "+api_key,"Content-Type":"application/json",
                   "Accept":"text/event-stream","User-Agent":"AAU-Stage1-Fresh-SSE-Isolated/1.0"},
          method="POST")
    start=time.monotonic()
    fragments=[]; reason_sha=hashlib.sha256()
    reasoning_chunks=0; event_count=0; malformed_events=0; first_event_seconds=None
    done=False; usage={}; finish_reason=None; response_model=None; response_id=None
    try:
        # Previous AAU Stage-1 streaming transport used urllib read timeout and SSE,
        # avoiding long server-side non-streaming response silence.
        with urllib.request.urlopen(req,timeout=420) as stream:
            run["http_status"]=stream.status
            for source_line in stream:
                line=source_line.decode("utf-8",errors="replace").strip()
                if not line.startswith("data:"):
                    continue
                payload=line[5:].strip()
                if payload=="[DONE]":
                    done=True
                    break
                try:
                    event=json.loads(payload)
                except json.JSONDecodeError:
                    malformed_events+=1
                    continue
                event_count+=1
                if first_event_seconds is None:
                    first_event_seconds=round(time.monotonic()-start,3)
                if event.get("usage"):
                    usage=event["usage"]
                response_model=event.get("model") or response_model
                response_id=event.get("id") or response_id
                for choice in event.get("choices") or []:
                    if choice.get("finish_reason"):
                        finish_reason=choice["finish_reason"]
                    delta=choice.get("delta") or {}
                    if isinstance(delta.get("content"),str):
                        fragments.append(delta["content"])
                    if isinstance(delta.get("reasoning_content"),str):
                        reason_sha.update(delta["reasoning_content"].encode("utf-8"))
                        reasoning_chunks+=1
                if event_count%60==0:
                    text="".join(fragments)
                    (OUTPUT/"stage1-partial-output.md").write_text(text,encoding="utf-8")
                    run["stream_progress"]={
                      "events":event_count,"reasoning_chunks":reasoning_chunks,
                      "content_characters":len(text),
                      "elapsed_seconds":round(time.monotonic()-start,3)}
                    save("run.json",run)
        content="".join(fragments)
        (OUTPUT/"stage1-model-output.md").write_text(content,encoding="utf-8")
        run.update(
          status="MODEL_RESPONDED",model_response_observed=bool(event_count),
          model_returned=response_model,response_id=response_id,
          finish_reason=finish_reason,stream_done=done,stream_events=event_count,
          malformed_stream_events=malformed_events,first_event_seconds=first_event_seconds,
          reasoning_chunks=reasoning_chunks,
          reasoning_content_sha256=reason_sha.hexdigest(),thinking_observed=reasoning_chunks>0,
          usage=usage, reasoning_tokens=(usage.get("completion_tokens_details") or {}).get("reasoning_tokens"),
          content_sha256=sha(content.encode("utf-8")),content_characters=len(content),
          elapsed_seconds=round(time.monotonic()-start,3),
          stage1_verification="UNVERIFIED",
          evaluator_note="Model plan alone is not independently executable toolchain verification."
        )
        if response_model!=MODEL:
            run.update(status="BLOCKED",error_category="UNEXPECTED_MODEL_RETURNED")
        elif not done or finish_reason!="stop":
            run.update(status="INCOMPLETE",error_category="UNFINISHED_PROVIDER_STREAM")
        elif not content.strip():
            run.update(status="INCOMPLETE",error_category="EMPTY_FINAL_OUTPUT")
        elif not reasoning_chunks:
            run.update(status="BLOCKED",error_category="THINKING_NOT_OBSERVED")
    except urllib.error.HTTPError as ex:
        run.update(status="FAILED_PROVIDER",error_category="HTTP_ERROR",
            http_status=ex.code,provider_error_sanitized=ex.read(900).decode(errors="replace")[:900],
            elapsed_seconds=round(time.monotonic()-start,3))
    except Exception as ex:
        run.update(status="FAILED_PROVIDER",error_category=type(ex).__name__,
            error_message=str(ex)[:300],elapsed_seconds=round(time.monotonic()-start,3))
    finally:
        content="".join(fragments)
        if content and not (OUTPUT/"stage1-model-output.md").exists():
            (OUTPUT/"stage1-partial-output.md").write_text(content,encoding="utf-8")
        run.setdefault("elapsed_seconds",round(time.monotonic()-start,3))
        run["completed_at"]=now()
        save("run.json",run)
        print("KIMI26_STAGE1_STREAM_RUN="+json.dumps({
          k:run.get(k) for k in (
          "status","error_category","model_requested","model_returned","prompt_verified",
          "stream_events","stream_done","finish_reason","thinking_observed",
          "reasoning_tokens","usage","elapsed_seconds","content_sha256","stage1_verification")
        },ensure_ascii=False))
    return 0 if run["status"]=="MODEL_RESPONDED" else 1

if __name__=="__main__":
    raise SystemExit(main())
