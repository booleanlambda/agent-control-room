"""Synthetic, domain-neutral unit tests. Passing DOES NOT certify any real tools."""
import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from tool_evidence_verifier_v1 import verify


class ToolEvidenceVerifierTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.task = b'{"abstract_task":"Process records with independent rejection."}'
        h = hashlib.sha256(self.task).hexdigest()
        self.manifest = {
            "task_sha256": h,
            "approved_by": "independent_domain_reviewer",
            "requirements": [{
                "id": "REQ-1", "critical": True,
                "original_task_basis": "Process records with independent rejection",
                "scenarios": ["nominal", "edge"],
                "transitions": ["raw-to-validated"]
            }]
        }
        self.candidate = {
            "task_sha256": h, "stage2_authorized": False,
            "tools": [{"id": "T1", "name": "processing_engine"},
                      {"id": "T2", "name": "independent_checker"},
                      {"id": "T3", "name": "input_validator"}],
            "capability_claims": [{
                "id": "CAP1", "tool_id": "T1", "requirement_ids": ["REQ-1"],
                "operation": "transform", "method_or_api": "transform_records",
                "inputs_with_units": "record_id:string, value:unit",
                "outputs_with_units": "record_id:string, result:unit",
                "applicability": "nominal and edge rows",
                "limits": "does not itself independently validate",
                "independent_check_id": "CHECK1",
                "evidence_ids": ["DOC", "PROBE"],
                "interface_ids": ["I1"]
            }],
            "interfaces": [{
                "id": "I1", "from_tool": "T1", "to_tool": "T3",
                "artifact_schema": "record_id:string,value:number",
                "units": "unit", "join_rule": "record_id",
                "invalid_data_rejection": "reject missing id",
                "evidence_ids": ["CONTRACT"]
            }],
            "independent_checks": [{
                "id": "CHECK1", "tool_id": "T2", "method": "recompute fixture",
                "rejection_rule": "mismatch != 0",
                "output_artifact": "independent replay log",
                "scenarios": ["nominal", "edge"],
                "transitions": ["raw-to-validated"],
                "evidence_ids": ["REPLAY"]
            }],
            "coverage": [{"id": "REQ-1", "claim_ids": ["CAP1"]}]
        }
        def art(name):
            body = ("independently verified " + name).encode()
            (self.root / (name + ".txt")).write_bytes(body)
            return {"artifact_path": name + ".txt",
                    "artifact_sha256": hashlib.sha256(body).hexdigest()}
        self.registry = {
            "task_sha256": h, "maintained_by": "independent_reviewer",
            "records": [{
                "id": code, "kind": kind, "result": "PASS",
                "reviewer": "independent_reviewer",
                "produced_by": "separate_test_harness",
                "requirement_ids": ["REQ-1"],
                "scenarios": ["nominal", "edge"], **art(code)
            } for code, kind in [
                ("DOC", "primary_documentation"),
                ("PROBE", "capability_probe"),
                ("CONTRACT", "contract_probe"),
                ("REPLAY", "independent_replay")
            ]]
        }

    def run_verifier(self):
        return verify(self.task, self.manifest, self.candidate, self.registry, self.root)

    def assert_blocked(self, fragment=None):
        result = self.run_verifier()
        self.assertEqual(result["readiness"], "BLOCKED")
        self.assertFalse(result["stage2_authorized"])
        self.assertIsNone(result["stage1_pass"])
        if fragment:
            self.assertTrue(any(fragment in p for p in result["problems"]), result["problems"])

    def test_complete_synthetic_bundle_is_only_ready_for_external_review(self):
        result = self.run_verifier()
        self.assertEqual(result["readiness"], "READY_FOR_SEPARATE_RUBRIC_REVIEW")
        self.assertEqual(result["requirements_with_evidence"], 1)
        self.assertIsNone(result["stage1_pass"])
        self.assertIs(result["stage2_authorized"], False)

    def test_unmapped_independent_critical_requirement_blocks(self):
        self.manifest["requirements"].append({
            "id": "REQ-2", "critical": True,
            "original_task_basis": "separate adverse case",
            "scenarios": ["edge"], "transitions": []
        })
        self.assert_blocked("REQ-2: missing requirement-to-capability mapping")

    def test_documentation_without_probe_is_not_capability_proof(self):
        self.candidate["capability_claims"][0]["evidence_ids"] = ["DOC"]
        self.assert_blocked("documentation AND real capability probe required")

    def test_model_provided_pass_status_does_not_substitute_for_registry(self):
        self.candidate["capability_claims"][0]["status"] = "VERIFIED"
        self.registry["records"][1]["produced_by"] = "model"
        self.assert_blocked("documentation AND real capability probe required")

    def test_mutated_artifact_fails_sha(self):
        (self.root / "PROBE.txt").write_text("tampered")
        self.assert_blocked("documentation AND real capability probe required")

    def test_replay_requires_independent_falsification_evidence(self):
        self.candidate["independent_checks"][0]["evidence_ids"] = []
        self.assert_blocked("independent rejection test not evidenced")

    def test_self_check_is_rejected(self):
        self.candidate["independent_checks"][0]["tool_id"] = "T1"
        self.assert_blocked("self-validation")

    def test_missing_scenario_is_rejected(self):
        self.candidate["independent_checks"][0]["scenarios"] = ["nominal"]
        self.assert_blocked("does not cover all required scenarios")

    def test_missing_transition_is_rejected(self):
        self.candidate["independent_checks"][0]["transitions"] = []
        self.assert_blocked("misses required state transitions")

    def test_untested_interface_is_rejected(self):
        self.candidate["interfaces"][0]["evidence_ids"] = []
        self.assert_blocked("no independent contract test")

    def test_wrong_task_hash_is_rejected(self):
        self.manifest["task_sha256"] = "fake"
        self.assert_blocked("requirements manifest does not match original task")

    def test_duplicate_claims_are_rejected(self):
        self.candidate["capability_claims"].append(
            copy.deepcopy(self.candidate["capability_claims"][0]))
        self.assert_blocked("duplicate id CAP1")

    def test_model_cannot_authorize_stage_two(self):
        self.candidate["stage2_authorized"] = True
        self.assert_blocked("model must explicitly deny stage-two authorization")

    def test_untrusted_provenance_is_rejected(self):
        self.registry["maintained_by"] = "model"
        self.assert_blocked("independent evidence ownership not established")

    def test_path_escape_fails_even_with_correct_digest(self):
        # No files outside the evidence root can establish proof.
        self.registry["records"][1]["artifact_path"] = "../outside.txt"
        self.assert_blocked("documentation AND real capability probe required")


if __name__ == "__main__":
    unittest.main()
