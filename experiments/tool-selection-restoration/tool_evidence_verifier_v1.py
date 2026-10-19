"""AAU Stage-1 evidence verifier (standard-library-only).

Inputs MUST cross trust boundaries:
  task JSON: original user problem
  requirements manifest: independently reconciled/approved requirement inventory
  candidate JSON: proposed toolchain (untrusted model output)
  evidence registry: independently reviewed primary docs and probe/contract artifacts

This is a conservative PRE-GATE. It does not validate external documentation's
truth, execute selected packages, certify safety, or authorize stage two.
It can only report missing or inconsistent evidence and readiness for
separate external rubric and domain-specialist approval.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def require_nonempty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def identifiers(rows: Any, collection: str, faults: list[str]) -> dict[str, dict]:
    if not isinstance(rows, list):
        faults.append(f"{collection}: must be an array")
        return {}
    result: dict[str, dict] = {}
    for number, row in enumerate(rows):
        if not isinstance(row, dict) or not require_nonempty(row.get("id")):
            faults.append(f"{collection}[{number}]: missing valid id")
            continue
        key = row["id"]
        if key in result:
            faults.append(f"{collection}: duplicate id {key}")
        else:
            result[key] = row
    return result


def string_set(value: Any) -> set[str]:
    if not isinstance(value, list):
        return set()
    return {v for v in value if require_nonempty(v)}


def verify(
    task_bytes: bytes,
    manifest: dict,
    candidate: dict,
    registry: dict,
    evidence_root: Path,
) -> dict:
    """Deterministic conservative validation; never returns a stage-two PASS.

    The registry is an independent trusted *input* but the verifier cannot
    cryptographically establish its author. Source ownership and reviewer
    independence must be enforced outside this function.
    """
    faults: list[str] = []
    passed: list[str] = []
    task_hash = digest(task_bytes)

    if manifest.get("task_sha256") != task_hash:
        faults.append("task: independent requirements manifest does not match original task bytes")
    if candidate.get("task_sha256") != task_hash:
        faults.append("task: model proposal references the wrong original task")
    if registry.get("task_sha256") != task_hash:
        faults.append("task: trusted evidence registry references the wrong task")
    if manifest.get("approved_by") in (None, "", "model", "kimi"):
        faults.append("requirements: no independent approval recorded")
    if registry.get("maintained_by") in (None, "", "model", "kimi"):
        faults.append("registry: independent evidence ownership not established")
    if candidate.get("stage2_authorized") is not False:
        faults.append("safety: model must explicitly deny stage-two authorization")

    requirements = identifiers(manifest.get("requirements"), "independent_requirements", faults)
    tools = identifiers(candidate.get("tools"), "tools", faults)
    claims = identifiers(candidate.get("capability_claims"), "capability_claims", faults)
    interfaces = identifiers(candidate.get("interfaces"), "interfaces", faults)
    checks = identifiers(candidate.get("independent_checks"), "independent_checks", faults)
    coverage = identifiers(candidate.get("coverage"), "coverage", faults)
    evidence = identifiers(registry.get("records"), "evidence", faults)

    # An evidence entry is useful only after independent human/domain review,
    # the recorded artifact's SHA is checked, and scope is explicit.
    verified: dict[str, dict] = {}
    for evidence_id, item in evidence.items():
        if item.get("result") != "PASS":
            continue
        if not require_nonempty(item.get("reviewer")):
            continue
        if item.get("produced_by") in ("model", "kimi", None, ""):
            continue
        if item.get("kind") not in ("primary_documentation", "capability_probe", "contract_probe", "independent_replay"):
            continue
        if not require_nonempty(item.get("artifact_path")) or not require_nonempty(item.get("artifact_sha256")):
            continue
        if not string_set(item.get("requirement_ids")):
            continue
        if not string_set(item.get("scenarios")):
            continue
        try:
            # Resolve under an explicit trusted root; reject traversal/symlinks
            root = evidence_root.resolve(strict=True)
            path = (root / item["artifact_path"]).resolve(strict=True)
            if not path.is_relative_to(root) or not path.is_file():
                continue
            if digest(path.read_bytes()) != item["artifact_sha256"]:
                continue
        except (OSError, RuntimeError, ValueError):
            continue
        verified[evidence_id] = item

    for req_id, req in requirements.items():
        if req.get("critical") not in (True, False):
            faults.append(f"{req_id}: independent manifest missing boolean criticality")
        source = req.get("original_task_basis")
        if not require_nonempty(source):
            faults.append(f"{req_id}: no trace to original task / independent requirement reasoning")
        required_scenarios = string_set(req.get("scenarios"))
        required_transitions = string_set(req.get("transitions"))
        if not required_scenarios:
            faults.append(f"{req_id}: independent manifest has no scenario/time applicability")
        row = coverage.get(req_id)
        if row is None:
            faults.append(f"{req_id}: missing requirement-to-capability mapping")
            continue
        claim_ids = string_set(row.get("claim_ids"))
        if not claim_ids:
            faults.append(f"{req_id}: no tool-capability claim")
            continue
        found_for_req = False
        for claim_id in claim_ids:
            claim = claims.get(claim_id)
            if not claim:
                faults.append(f"{req_id}/{claim_id}: missing claim object")
                continue
            tool = tools.get(claim.get("tool_id"))
            if not tool or not require_nonempty(tool.get("name")):
                faults.append(f"{req_id}/{claim_id}: unsupported tool ID")
                continue
            if not all(require_nonempty(claim.get(k)) for k in (
                "operation", "method_or_api", "inputs_with_units",
                "outputs_with_units", "applicability", "limits")):
                faults.append(f"{req_id}/{claim_id}: absent method, applicable scope or typed I/O")
                continue
            if req_id not in string_set(claim.get("requirement_ids")):
                faults.append(f"{req_id}/{claim_id}: claim does not cover requested requirement")
                continue

            checker = checks.get(claim.get("independent_check_id"))
            if not checker or checker.get("tool_id") == claim.get("tool_id"):
                faults.append(f"{req_id}/{claim_id}: missing independent checker or self-validation")
                continue
            if not all(require_nonempty(checker.get(k)) for k in (
                "method", "rejection_rule", "output_artifact")):
                faults.append(f"{req_id}/{claim_id}: no independently falsifiable rejection rule")
                continue
            if not required_scenarios.issubset(string_set(checker.get("scenarios"))):
                faults.append(f"{req_id}/{claim_id}: checker does not cover all required scenarios")
                continue
            if not required_transitions.issubset(string_set(checker.get("transitions"))):
                faults.append(f"{req_id}/{claim_id}: checker misses required state transitions")
                continue

            # Documentation and measured capability are separate independent
            # evidence classes. Names/links/status strings from Kimi cannot
            # satisfy this gate by themselves.
            evidence_ids = string_set(claim.get("evidence_ids"))
            doc = [verified[e] for e in evidence_ids if e in verified
                   and verified[e]["kind"] == "primary_documentation"
                   and req_id in string_set(verified[e].get("requirement_ids"))
                   and required_scenarios.issubset(string_set(verified[e].get("scenarios")))]
            probes = [verified[e] for e in evidence_ids if e in verified
                      and verified[e]["kind"] == "capability_probe"
                      and req_id in string_set(verified[e].get("requirement_ids"))
                      and required_scenarios.issubset(string_set(verified[e].get("scenarios")))]
            if not doc or not probes:
                faults.append(f"{req_id}/{claim_id}: independent documentation AND real capability probe required")
                continue

            check_evidence = string_set(checker.get("evidence_ids"))
            checks_proved = [verified[e] for e in check_evidence if e in verified
                            and verified[e]["kind"] == "independent_replay"
                            and req_id in string_set(verified[e].get("requirement_ids"))
                            and required_scenarios.issubset(string_set(verified[e].get("scenarios")))]
            if not checks_proved:
                faults.append(f"{req_id}/{claim_id}: independent rejection test not evidenced")
                continue

            # A contract must be connected and actually tested, not merely
            # described, and must map the relevant producer's outputs.
            interface_ids = string_set(claim.get("interface_ids"))
            if not interface_ids:
                faults.append(f"{req_id}/{claim_id}: missing cross-tool input/output contract")
                continue
            interface_ok = True
            for interface_id in interface_ids:
                interface = interfaces.get(interface_id)
                if (not interface
                    or interface.get("from_tool") not in tools
                    or interface.get("to_tool") not in tools
                    or not all(require_nonempty(interface.get(k)) for k in (
                        "artifact_schema", "units", "join_rule", "invalid_data_rejection"))):
                    faults.append(f"{req_id}/{claim_id}: invalid interface {interface_id}")
                    interface_ok = False
                    continue
                tested = [verified[e] for e in string_set(interface.get("evidence_ids"))
                          if e in verified and verified[e]["kind"] == "contract_probe"
                          and req_id in string_set(verified[e].get("requirement_ids"))]
                if not tested:
                    faults.append(f"{req_id}/{claim_id}: interface {interface_id} has no independent contract test")
                    interface_ok = False
            if not interface_ok:
                continue
            found_for_req = True
        if found_for_req:
            passed.append(req_id)
        elif req.get("critical") is True:
            faults.append(f"{req_id}: CRITICAL requirement not independently substantiated")

    for extraneous in sorted(set(coverage) - set(requirements)):
        faults.append(f"coverage: proposal invented or referenced non-authoritative requirement {extraneous}")
    critical_ids = sorted(rid for rid, item in requirements.items() if item.get("critical") is True)
    missing_critical = sorted(set(critical_ids) - set(passed))
    return {
        "verifier_version": "aau-tool-evidence-v1",
        "original_task_sha256": task_hash,
        "requirements_total": len(requirements),
        "critical_requirements_total": len(critical_ids),
        "requirements_with_evidence": len(passed),
        "unverified_critical_ids": missing_critical,
        "problems": sorted(set(faults)),
        "readiness": "BLOCKED" if faults or missing_critical or not requirements
                    else "READY_FOR_SEPARATE_RUBRIC_REVIEW",
        "stage1_pass": None,
        "stage2_authorized": False,
        "scope": "Evidence consistency only; domain suitability and physical safety NOT certified",
    }


def main() -> None:
    p = argparse.ArgumentParser(description="Conservative, domain-independent Stage-1 tool evidence screening")
    p.add_argument("--task", type=Path, required=True)
    p.add_argument("--requirements", type=Path, required=True)
    p.add_argument("--candidate", type=Path, required=True)
    p.add_argument("--registry", type=Path, required=True)
    p.add_argument("--evidence-root", type=Path, required=True)
    p.add_argument("--out", type=Path)
    args = p.parse_args()
    result = verify(
        args.task.read_bytes(),
        json.loads(args.requirements.read_text()),
        json.loads(args.candidate.read_text()),
        json.loads(args.registry.read_text()),
        args.evidence_root,
    )
    rendered = json.dumps(result, indent=2, ensure_ascii=False)
    if args.out:
        args.out.write_text(rendered + "\n")
    print(rendered)
    if result["readiness"] != "READY_FOR_SEPARATE_RUBRIC_REVIEW":
        raise SystemExit(2)


if __name__ == "__main__":
    main()
