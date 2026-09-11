#!/usr/bin/env python3
import os, json, time, hashlib, urllib.request, urllib.error
from pathlib import Path

PORTFOLIO_MANIFEST_SHA256 = os.environ.get("PORTFOLIO_MANIFEST_SHA256", "652d6ec6ec67027ff80a407b1a365c940458972c8706ab802e0dcbf33d40b784")

EVIDENCE = {
    "C1": [["c26aee52-7744-4b10-8ddc-e687329416ea", "workflow discovery/process requirements artifact"], ["73d8ce03-01ca-469d-8b37-62d62b46eccb", "source-clean defended whole-client C1/C8 artifact"]],
    "C2": [["6d3f0eca-468e-4be5-91e0-44603f8b0fae", "API/OpenAPI/JSON Schema contract artifact"], ["57605184-fad0-4353-9ba6-c615df509ee8", "events, pagination and schema-evolution artifact"]],
    "C3": [["02868a14-469f-44d9-a4b8-8bc71a43b17d", "least-privilege authorization artifact"], ["c79d4d6e-310e-40fe-9b47-3553db7f8deb", "AI security/trust-boundary artifact"]],
    "C4": [["93b9b352-4517-4e67-a251-bfdcd64e51a1", "source-clean corrected executable orchestration artifact"], ["e9c41627-52bb-47ff-9dfe-54faf2200f74", "source-clean changed-case transfer artifact"], ["7b72f67e-eb75-4fb3-af92-fd29dcea7b2f", "source-clean adversarial artifact"]],
    "C5": [["fdaa026e-3558-40af-8c42-6f0f8b3f3d56", "source-clean state/recovery correction artifact"], ["e9c41627-52bb-47ff-9dfe-54faf2200f74", "source-clean changed-case transfer artifact"], ["7b72f67e-eb75-4fb3-af92-fd29dcea7b2f", "source-clean adversarial reliability artifact"]],
    "C6": [["93b9b352-4517-4e67-a251-bfdcd64e51a1", "source-clean corrected evaluation/guardrail artifact"], ["7b72f67e-eb75-4fb3-af92-fd29dcea7b2f", "source-clean adversarial evaluation artifact"], ["c5b29d52-965f-4337-9418-7bae770f81f5", "source-clean reproduction bridge"]],
    "C7": [["a765a3c8-1fb7-4612-9231-018086a99ca9", "source-clean observability correction artifact"], ["7b72f67e-eb75-4fb3-af92-fd29dcea7b2f", "source-clean adversarial observability artifact"], ["c5b29d52-965f-4337-9418-7bae770f81f5", "source-clean reproduction bridge"]],
    "C8": [["73d8ce03-01ca-469d-8b37-62d62b46eccb", "source-clean defended whole-client delivery artifact"], ["e9c41627-52bb-47ff-9dfe-54faf2200f74", "source-clean changed-case transfer artifact"], ["c5b29d52-965f-4337-9418-7bae770f81f5", "source-clean reproduction bridge"]],
}

def die(msg):
    print(msg)
    raise SystemExit(1)

def canonical_bytes(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()

def sha_obj(obj):
    return hashlib.sha256(canonical_bytes(obj)).hexdigest()

def gh_output(name, value):
    p = os.environ.get("GITHUB_OUTPUT")
    if p:
        with open(p, "a") as f:
            f.write(f"{name}={value}\n")

def get_free_models():
    req = urllib.request.Request("https://api.xkiro.com/v1/models")
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read().decode())
    models = []
    for m in data.get("data", []):
        mid = m.get("id", "")
        if m.get("access_tier") == "free" and mid and not mid.startswith("openai/"):
            models.append(mid)
    preferred_prefixes = ["qwen/", "mistral", "google/", "meta-llama/", "deepseek/"]
    def rank(mid):
        for i, p in enumerate(preferred_prefixes):
            if mid.startswith(p):
                return (i, mid)
        return (len(preferred_prefixes), mid)
    models = sorted(set(models), key=rank)
    # The previously working DeepSeek endpoint returned 403 in the first final-assessment run.
    # Keep it available as a fallback but do not make it first choice on this retry.
    models = [m for m in models if m != "deepseek/deepseek-v4-flash"] + (["deepseek/deepseek-v4-flash"] if "deepseek/deepseek-v4-flash" in models else [])
    return models

def call_model(key, model, system, user, timeout=180):
    body = {
        "model": model,
        "temperature": 0.2,
        "max_tokens": 1100,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }
    req = urllib.request.Request(
        "https://api.xkiro.com/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        obj = json.loads(r.read().decode())
    content = obj.get("choices", [{}])[0].get("message", {}).get("content") or ""
    served = obj.get("model") or model
    return obj, content, served

def main():
    key = os.environ.get("XKIRO_API_KEY")
    if not key:
        die("LEARNER_SECRET_MISSING")
    packet = json.load(open("tasks.json"))
    if packet.get("portfolio_manifest_sha256") != PORTFOLIO_MANIFEST_SHA256:
        die("PORTFOLIO_MANIFEST_HASH_MISMATCH")

    candidates = get_free_models()
    if not candidates:
        die("NO_XKIRO_FREE_NON_OPENAI_MODELS")
    print(f"XKIRO_FREE_NON_OPENAI_MODEL_COUNT={len(candidates)}")

    answers = []
    active_model = None
    for task in packet["tasks"]:
        cid = task["id"]
        ev_lines = "\n".join(f"- {eid}: {desc}" for eid, desc in EVIDENCE[cid])
        system = (
            "You are the active inference runtime for a frozen AAU agent whose bounded field is AI workflow integration "
            "and automation for SMB operational workflows. This is a final unseen assessment, not training. Solve the "
            "task from first principles. Be concrete about states, controls, tests, failure handling and business "
            "consequences. Do not claim live-provider or production execution. Cite at least one exact allowed frozen "
            "evidence ID supplied for this competency. Do not invent evidence IDs. Do not mention prior grades or assessment scores."
        )
        user = f"""COMPETENCY: {cid}
SCENARIO:
{task['scenario']}

TASK:
{task['prompt']}

ALLOWED FROZEN EVIDENCE REFERENCES:
{ev_lines}

Answer in roughly 300-600 words. Use the evidence ID(s) only to trace relevant prior competence; the reasoning for this fresh task must stand on its own."""

        ordered = ([active_model] if active_model else []) + [m for m in candidates if m != active_model]
        content = ""
        served = ""
        used_requested = ""
        last_status = None
        for model in ordered:
            for attempt in range(1, 3):
                try:
                    _, content, served = call_model(key, model, system, user)
                    if content.strip():
                        used_requested = model
                        active_model = model
                        break
                    print(f"LEARNER_{cid}_{model}_ATTEMPT_{attempt}_EMPTY=true")
                except urllib.error.HTTPError as e:
                    last_status = e.code
                    print(f"LEARNER_{cid}_{model}_ATTEMPT_{attempt}_HTTP={e.code}")
                    if e.code in (400, 401, 403, 404):
                        break
                except Exception as e:
                    print(f"LEARNER_{cid}_{model}_ATTEMPT_{attempt}_ERROR={type(e).__name__}")
                time.sleep(attempt)
            if content.strip():
                break
        if not content.strip():
            die(f"LEARNER_NO_USABLE_ANSWER_{cid}_LAST_STATUS={last_status}")

        allowed_ids = [x[0] for x in EVIDENCE[cid]]
        found = [eid for eid in allowed_ids if eid in content]
        answers.append({
            "id": cid,
            "competency": cid,
            "answer": content,
            "model": served,
            "requested_model": used_requested,
            "input_sha256": hashlib.sha256((system + "\n" + user).encode()).hexdigest(),
            "output_sha256": hashlib.sha256(content.encode()).hexdigest(),
            "allowed_evidence_ids": allowed_ids,
            "evidence_ids_found": found,
        })
        print(f"LEARNER_{cid}_MODEL={served}")
        print(f"LEARNER_{cid}_EVIDENCE_IDS_FOUND={len(found)}")

    served_models = sorted(set(a["model"] for a in answers))
    model_label = served_models[0] if len(served_models) == 1 else "mixed_free_pool:" + ",".join(served_models)
    out_obj = {
        "packet_full_sha256": packet["full_packet_sha256"],
        "tasks_sha256": packet["tasks_sha256"],
        "portfolio_manifest_sha256": packet["portfolio_manifest_sha256"],
        "learner_model": model_label,
        "learner_models": served_models,
        "model_selection_policy": "live_xkiro_free_non_openai_pool_with_audited_fallback",
        "answers": answers,
    }
    ans_hash = sha_obj(out_obj)
    out_obj["answers_sha256"] = ans_hash
    Path("answers.json").write_text(json.dumps(out_obj, indent=2, sort_keys=True))
    gh_output("learner_model", model_label)
    gh_output("answers_sha256", ans_hash)
    print(f"LEARNER_MODEL_LABEL={model_label}")
    print(f"LEARNER_MODELS_USED={','.join(served_models)}")
    print(f"ANSWERS_SHA256={ans_hash}")
    print("ALL_8_TASKS_ATTEMPTED=true")

if __name__ == "__main__":
    main()
