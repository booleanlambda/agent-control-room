"""Regression tests for the external AAU Stage-One tool proof gate.
Uses immutable A/B/C/D replay bundle downloaded by the workflow.
"""
import copy
import json
import os
from pathlib import Path
import sys
import unittest

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from tool_selection_proof_gate import validate_proposal

class GateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root=HERE/"proof_replay"/"v41_evidence"
        cls.bundle=json.loads((root/"v41-composed-evidence-bundle.json").read_text())
        cls.manifest=json.loads((HERE/"external_tool_proof_obligations_v1.json").read_text())
        # All known narrow probes pass: the gate MUST STILL reject missing real capabilities.
        cls.probes={"probes":{k:{"status":"PASS_NARROW_CAPABILITY_ONLY","evidence":{"synthetic":"unit-test-only"}}
                for k in ["opendss_unbalanced","highs_mip","networkx_radiality","ortools_vrp",
                          "scipy_interpolation","stdlib_manifest"]}}
    def test_original_repaired_plan_is_blocked_even_when_known_smokes_pass(self):
        result=validate_proposal(self.bundle,self.manifest,self.probes)
        self.assertEqual(result["result"],"BLOCKED")
        self.assertFalse(result["stage2_authorized"])
        self.assertIsNone(result["original_rubric_score"])
        self.assertIn("C4-mobile-generator-transport",result["unsubstantiated_or_missing_capability_ids"])
        self.assertIn("C5-island-grid-reconnection",result["unsubstantiated_or_missing_capability_ids"])
        self.assertIn("C5-overcurrent-protection",result["unsubstantiated_or_missing_capability_ids"])
    def test_missing_generator_interface_is_rejected(self):
        result=validate_proposal(self.bundle,self.manifest,self.probes)
        self.assertIn("GEN-ROUTE-TO-RESTORATION",result["unimplemented_interface_contract_ids"])
        self.assertIn("SYNC-MEASUREMENT-TO-CHECK",result["unimplemented_interface_contract_ids"])
    def test_model_claiming_complete_cannot_override_gate(self):
        bundle=copy.deepcopy(self.bundle)
        bundle["v41_D_repair_delta"]["stage1_assessment"]={"status":"PROPOSAL_FOR_EXTERNAL_GATE"}
        bundle["v41_D_repair_delta"]["unresolved_critical_ids"]=[]
        result=validate_proposal(bundle,self.manifest,self.probes)
        self.assertEqual(result["result"],"BLOCKED")
        self.assertFalse(result["stage2_authorized"])
    def test_unknown_tool_id_is_rejected(self):
        bundle=copy.deepcopy(self.bundle)
        bundle["v41_D_repair_delta"]["audit_repairs"][0]["selected_tool_ids"].append("GHOST_SOLVER")
        result=validate_proposal(bundle,self.manifest,self.probes)
        self.assertIn("GHOST_SOLVER",result["structural_issues"]["unknown_tools_in_repair_claims"])
        self.assertEqual(result["result"],"BLOCKED")
    def test_missing_mandatory_audit_row_is_rejected(self):
        bundle=copy.deepcopy(self.bundle)
        bundle["v41_D_repair_delta"]["audit_repairs"]=bundle["v41_D_repair_delta"]["audit_repairs"][1:]
        result=validate_proposal(bundle,self.manifest,self.probes)
        self.assertTrue(result["structural_issues"]["missing_mandatory_audit_repair_ids"]
                         or result["structural_issues"]["duplicate_audit_repair_ids"])
        self.assertEqual(result["result"],"BLOCKED")
    def test_model_requests_stage_two_is_rejected(self):
        bundle=copy.deepcopy(self.bundle)
        bundle["v41_D_repair_delta"]["stage2_authorized"]=True
        result=validate_proposal(bundle,self.manifest,self.probes)
        self.assertTrue(result["structural_issues"]["model_requested_stage2"])
        self.assertFalse(result["stage2_authorized"])
    def test_forged_edge_without_required_typed_fields_does_not_pass(self):
        bundle=copy.deepcopy(self.bundle)
        bundle["v41_D_repair_delta"]["interface_additions"].append({
          "id":"FAKE_SYNC","from_id":"NT6","to_id":"NT6",
          "artifact_with_schema_and_units":"ready:boolean",
          "invalid_data_rejection":"reject bad data"})
        result=validate_proposal(bundle,self.manifest,self.probes)
        self.assertIn("SYNC-MEASUREMENT-TO-CHECK",result["unimplemented_interface_contract_ids"])

if __name__=="__main__":
    unittest.main(verbosity=2)
