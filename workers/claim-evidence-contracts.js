// Explicit task-schema registry. Generic claim engine never discovers
// equivalence by prose/field-name similarity; each contract declares it.
import { declaredArrayProjectionContract } from './claim-evidence-continuity.js';

const M10_U2_P2_MRR_GP=declaredArrayProjectionContract({
  contractId:'qda601_m10_u2_problem2_mrr_gp_12_month_projection_v0_1',
  collection:'calculation',
  identityField:'month',
  fields:['mrr','gross_profit'],
  expectedIds:Array.from({length:12},(_,i)=>i+1),
  // The exercise pack supplies monthly ARPA 255 and gross margin 0.72.
  // No ad hoc conversion is authorized here; values copy identically.
  units:{},
  expectedSourceRef:'curriculum/qda601-exercise-packs-v0.1.json#QDA601-M10-U2',
});

export function claimEvidenceContractForRequirement(packet,node){
  const unit=String(packet?.qda_601_context?.next_unit?.unit_code||'').toUpperCase();
  const requirement=String(node?.requirement_text||'');
  const source=String(node?.source_ref||'');
  // Problem-specific opt-in, not a universal schema assumption.
  if(unit==='QDA601-M10-U2'
    &&source.includes('#QDA601-M10-U2')
    &&/\bMRR\b/i.test(requirement)
    &&/\bgross\s+profit\b/i.test(requirement)
    &&/12[- ]month/i.test(requirement))return M10_U2_P2_MRR_GP;
  return null;
}
