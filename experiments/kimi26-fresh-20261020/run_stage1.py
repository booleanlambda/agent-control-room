#!/usr/bin/env python3
"""Isolated Kimi K2.6 Stage-1 selection probe. No production agent or DB calls."""
import hashlib, json, os, pathlib, platform, sys, time, urllib.request, urllib.error
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent
OUTPUT = ROOT / "evidence"
OUTPUT.mkdir(exist_ok=True)
PROMPT_PATH = ROOT / "stage1-prompt.md"
EXPECTED_SHA256 = "c030622cab004c5acb0e79c771b42bba5559b000e08e99289d5a87b4f4e3b473"
MODEL = "kimi-k2.6"
def now():
    return datetime.now(timezone.utc).isoformat()
def save(name, obj):
    (OUTPUT / name).write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
def main():
    prompt = PROMPT_PATH.read_bytes()
    digest = hashlib.sha256(prompt).hexdigest()
    run = {"experiment":"kimi26-fresh-toolchain-20261020", "model_requested":MODEL,
           "thinking_requested":{"type":"enabled"}, "prompt_sha256":digest,
           "prompt_verified":digest == EXPECTED_SHA256, "started_at":now(),
           "runtime":{"python":sys.version,"platform":platform.platform()},
           "status":"STARTED","stage1_verification":"UNVERIFIED","model_response_observed":False}
    if digest != EXPECTED_SHA256:
        run.update(status="BLOCKED",error_category="PROMPT_HASH_MISMATCH")
        save("run.json",run)
        return 2
    api_key = (os.getenv("MOONSHOT_APIKEY") or os.getenv("MOONSHOT_API_KEY") or "").strip()
    if not api_key:
        run.update(status="BLOCKED",error_category="MISSING_GITHUB_MOONSHOT_SECRET",
                   explanation="Secret absent in workflow; no provider request made.")
        save("run.json",run)
        return 2
    endpoint = os.getenv("MOONSHOT_ENDPOINT") or "https://api.moonshot.ai/v1/chat/completions"
    endpoint = endpoint.rstrip("/")
    if endpoint.endswith("/v1"): endpoint += "/chat/completions"
    elif not endpoint.endswith("/chat/completions"): endpoint += "/v1/chat/completions"
    from urllib.parse import urlparse
    parsed = urlparse(endpoint)
    if parsed.scheme != "https" or parsed.netloc not in ("api.moonshot.ai","api.moonshot.cn"):
        run.update(status="BLOCKED",error_category="UNTRUSTED_PROVIDER_ENDPOINT")
        save("run.json",run)
        return 2
    run["endpoint_host"] = parsed.netloc
    body = {"model": MODEL, "messages":[{"role":"user","content":prompt.decode("utf-8")}],
            "max_tokens": 32768, "stream": False, "thinking":{"type":"enabled"}}
    save("request-metadata.json",{"model":MODEL,"max_tokens":32768,"thinking":body["thinking"],
             "prompt_sha256":digest,"message_count":1,"endpoint_host":parsed.netloc})
    req = urllib.request.Request(endpoint,data=json.dumps(body,ensure_ascii=False).encode("utf-8"),
              headers={"Authorization":"Bearer "+api_key, "Content-Type":"application/json",
                       "Accept":"application/json", "User-Agent":"AAU-Stage1-Fresh-Isolated/1.0"},
              method="POST")
    started=time.monotonic()
    try:
        with urllib.request.urlopen(req,timeout=830) as res:
            response_bytes=res.read()
            status=res.status
        run["http_status"]=status
        run["elapsed_seconds"]=round(time.monotonic()-started,3)
        response = json.loads(response_bytes)
        save("provider-response.json",response)
        choice=(response.get("choices") or [{}])[0]
        message=choice.get("message") or {}
        content=message.get("content") or ""
        reasoning=message.get("reasoning_content") or ""
        (OUTPUT/"stage1-model-output.md").write_text(content,encoding="utf-8")
        run.update(status="MODEL_RESPONDED",model_response_observed=True,
          model_returned=response.get("model"),response_id=response.get("id"),
          finish_reason=choice.get("finish_reason"),usage=response.get("usage"),
          content_characters=len(content),reasoning_characters=len(reasoning),
          thinking_observed=bool(reasoning),
          stage1_verification="UNVERIFIED",
          evaluator_note="Raw model output is not independent execution/physics verification.")
        if response.get("model") != MODEL:
            run.update(status="BLOCKED",error_category="UNEXPECTED_MODEL_RETURNED")
        elif not reasoning:
            run.update(status="BLOCKED",error_category="THINKING_NOT_OBSERVED")
        elif not content:
            run.update(status="BLOCKED",error_category="EMPTY_OR_EXHAUSTED_FINAL_OUTPUT")
        elif choice.get("finish_reason") != "stop":
            run.update(status="INCOMPLETE",error_category="NON_STOP_FINISH_REASON")
    except urllib.error.HTTPError as exc:
        run.update(status="FAILED_PROVIDER",error_category="HTTP_ERROR",
            http_status=exc.code,provider_error_sanitized=exc.read(1200).decode(errors="replace")[:1200],
            elapsed_seconds=round(time.monotonic()-started,3))
    except Exception as exc:
        run.update(status="FAILED_PROVIDER",error_category=type(exc).__name__,
            error_message=str(exc)[:350],elapsed_seconds=round(time.monotonic()-started,3))
    run["completed_at"]=now()
    save("run.json",run)
    print("KIMI26_STAGE1_RUN_JSON="+json.dumps({k:v for k,v in run.items() if k != "runtime"},ensure_ascii=False))
    return 0 if run["status"]=="MODEL_RESPONDED" else 1
if __name__=="__main__":
    raise SystemExit(main())
