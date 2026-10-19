"""AAU tool selection stage-one v4: four Kimi K2.6 calls, blind investigator.
No executable tools or power system solver run here; no stage two.
Prompt/rubric fixed by git preflight and v4 protocol; forensics per call.
"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.request

ROOT = Path(__file__).resolve().parent
EVIDENCE = ROOT / "evidence_v4"
EVIDENCE.mkdir(parents=True, exist_ok=True)
MODEL = "kimi-k2.6"
PROTOCOL = (ROOT / "TOOL_SELECTION_PROMPT_V4_INDEPENDENT_AUDIT.md").read_text()
CHALLENGE = (ROOT / "challenge.json").read_bytes()
ORIGINAL_RUBRIC = (ROOT / "rubric.json").read_bytes()
APPROPRIATENESS_RUBRIC = (ROOT / "appropriateness_rubric_v1.json").read_bytes()

def sha(v):
    return hashlib.sha256(v).hexdigest()
def canonical(v):
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
def section(start, next_heading):
    return PROTOCOL.split(start + "\n\n", 1)[1].split("\n" + next_heading, 1)[0].strip()
PROMPTS = {
    "A": section("## CALL A — Tool architect (system prompt)", "## CALL B — Blind requirements and failure investigator (system prompt)"),
    "B": section("## CALL B — Blind requirements and failure investigator (system prompt)", "## CALL C — Adversarial toolchain auditor (system prompt)"),
    "C": section("## CALL C — Adversarial toolchain auditor (system prompt)", "## CALL D — Repair architect (system prompt)"),
    "D": section("## CALL D — Repair architect (system prompt)", "## Evaluation notes (NOT included in model messages)"),
}
def save(name, receipt):
    (EVIDENCE / ("call-" + name + "-receipt.json")).write_text(
        json.dumps(receipt, indent=2, ensure_ascii=False)
    )
def request_model(name, task):
    key = os.environ.get("MOONSHOT_API_KEY", "").strip()
    if not key:
        raise RuntimeError("MOONSHOT_PROVIDER_KEY_MISSING")
    messages = [{"role": "system", "content": PROMPTS[name]},
                {"role": "user", "content": json.dumps(task, ensure_ascii=False)}]
    payload = {"model": MODEL, "thinking": {"type": "enabled"},
               "temperature": 1.0, "max_tokens": 32768,
               "response_format": {"type": "json_object"}, "stream": True,
               "stream_options": {"include_usage": True}, "messages": messages}
    receipt = {
        "name": name, "model": MODEL, "thinking": "enabled",
        "status": "STARTED", "attempt_count": 1,
        "stage2_triggered": False, "tools_permitted": False,
        "challenge_sha256": sha(CHALLENGE),
        "original_rubric_sha256": sha(ORIGINAL_RUBRIC),
        "appropriateness_rubric_sha256": sha(APPROPRIATENESS_RUBRIC),
        "v4_protocol_sha256": sha(PROTOCOL.encode()),
        "prompt_sha256": sha(canonical(messages)),
        "request_parameters": {"model": MODEL, "thinking": payload["thinking"],
             "temperature": payload["temperature"], "max_tokens": 32768,
             "response_format": payload["response_format"]},
        "provider_receipt": None, "raw_response_content": None,
        "model_proposal": None,
    }
    save(name, receipt)
    req = urllib.request.Request(
        "https://api.moonshot.ai/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json",
                 "Accept": "text/event-stream"},
        method="POST")
    start = time.monotonic()
    parts = []
    reason_digest = hashlib.sha256()
    reason_chunks = 0
    event_count = 0
    finish = None
    done = False
    usage = {}
    provider_model = None
    provider_id = None
    try:
        with urllib.request.urlopen(req, timeout=420) as stream:
            for raw_line in stream:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    done = True
                    break
                event = json.loads(data)
                event_count += 1
                if event.get("usage"):
                    usage = event["usage"]
                provider_model = event.get("model") or provider_model
                provider_id = event.get("id") or provider_id
                for choice in event.get("choices") or []:
                    if choice.get("finish_reason"):
                        finish = choice["finish_reason"]
                    delta = choice.get("delta") or {}
                    if delta.get("content"):
                        parts.append(delta["content"])
                    if delta.get("reasoning_content"):
                        reason_digest.update(delta["reasoning_content"].encode())
                        reason_chunks += 1
                if event_count % 100 == 0:
                    receipt["stream_progress"] = {"events": event_count,
                         "reasoning_chunks": reason_chunks, "content_chars": sum(map(len, parts)),
                         "elapsed_seconds": round(time.monotonic() - start, 3)}
                    receipt["raw_response_content"] = "".join(parts)
                    save(name, receipt)
        raw = "".join(parts)
        receipt["raw_response_content"] = raw
        receipt["wall_seconds"] = round(time.monotonic() - start, 3)
        receipt["provider_receipt"] = {
            "response_model": provider_model, "response_id": provider_id,
            "finish_reason": finish, "stream_done": done,
            "stream_events": event_count, "reasoning_chunks": reason_chunks,
            "reasoning_content_sha256": reason_digest.hexdigest(),
            "usage": usage,
            "reasoning_tokens": (usage.get("completion_tokens_details") or {}).get("reasoning_tokens"),
            "raw_content_sha256": sha(raw.encode()),
        }
        if not done or finish != "stop":
            receipt["status"] = "INCOMPLETE_PROVIDER_RESPONSE"
        else:
            trim = raw.strip()
            normalized = raw
            receipt["normalization"] = "none"
            if trim.startswith("```json\n") and trim.endswith("\n```"):
                normalized = trim[len("```json\n"):-len("\n```")]
                receipt["normalization"] = "outer_json_fence_only"
            elif trim.startswith("```\n") and trim.endswith("\n```"):
                normalized = trim[len("```\n"):-len("\n```")]
                receipt["normalization"] = "outer_fence_only"
            receipt["normalized_content_sha256"] = sha(normalized.encode())
            parsed = json.loads(normalized)
            if isinstance(parsed, dict):
                receipt["model_proposal"] = parsed
                receipt["status"] = "COMPLETED_PENDING_INDEPENDENT_GATE"
            else:
                receipt["status"] = "INVALID_JSON_ROOT"
    except Exception as ex:
        receipt["status"] = "PROVIDER_OR_FORMAT_ERROR"
        receipt["error_class"] = type(ex).__name__
        receipt["error_code"] = getattr(ex, "code", None)
        receipt["error_detail_sanitized"] = str(ex)[:180] if not hasattr(ex, "code") else str(getattr(ex, "code"))
        receipt["raw_response_content"] = "".join(parts)
        receipt["wall_seconds"] = round(time.monotonic() - start, 3)
    save(name, receipt)
    print("AAU_V4_CALL=" + json.dumps({
        "name": name, "status": receipt["status"],
        "tokens": (receipt.get("provider_receipt") or {}).get("usage", {}).get("total_tokens"),
        "reasoning_tokens": (receipt.get("provider_receipt") or {}).get("reasoning_tokens"),
        "finish_reason": (receipt.get("provider_receipt") or {}).get("finish_reason"),
        "raw_content_sha256": (receipt.get("provider_receipt") or {}).get("raw_content_sha256"),
        "wall_seconds": receipt.get("wall_seconds"),
        "stage2_triggered": False,
    }), flush=True)
    return receipt

def valid(x):
    return x["status"] == "COMPLETED_PENDING_INDEPENDENT_GATE"

def main():
    original = json.loads(CHALLENGE)
    # A and B independently receive only the exact original task in fresh contexts.
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        future_a = pool.submit(request_model, "A", original)
        future_b = pool.submit(request_model, "B", original)
        a = future_a.result()
        b = future_b.result()
    if not all(map(valid, [a, b])):
        raise RuntimeError("A_OR_B_NOT_COMPLETE; ABORT_C_D_WITHOUT_SILENT_RETRY")
    c = request_model("C", {
        "original_task": original, "architect_proposal": a["model_proposal"],
        "blind_investigator": b["model_proposal"]})
    if not valid(c):
        raise RuntimeError("C_NOT_COMPLETE; ABORT_D_WITHOUT_SILENT_RETRY")
    d = request_model("D", {
        "original_task": original, "architect_original_proposal": a["model_proposal"],
        "blind_investigator": b["model_proposal"],
        "adversarial_audit": c["model_proposal"]})
    if not valid(d):
        raise RuntimeError("D_NOT_COMPLETE; STAGE1_NOT_GRADED")
    summary = {
       "status": "COMPLETED_PENDING_INDEPENDENT_GATE",
       "stage1_pass": None, "stage2_triggered": False,
       "models": {"A": a["model_proposal"].get("self_assessment"),
                  "C": c["model_proposal"].get("audit_result"),
                  "D": d["model_proposal"].get("stage1_assessment")},
       "tokens": {k: r["provider_receipt"]["usage"].get("total_tokens") for k,r in
                  [("A",a),("B",b),("C",c),("D",d)]}
    }
    (EVIDENCE / "full-pipeline-summary.json").write_text(json.dumps(summary,indent=2,ensure_ascii=False))
    print("AAU_V4_STAGE1=" + json.dumps(summary), flush=True)

if __name__ == "__main__":
    main()
