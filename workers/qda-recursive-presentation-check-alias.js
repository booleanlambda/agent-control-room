// AAU QDA recursive proof/presentation separation v0.1.
// The executive calculation presentation cannot introduce executable checks.
// Only runtime-reverified, hash-bound atomic descendants own Python checks.
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const object=v=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const digestPath=/^R(?:\.\d{3}){1,16}$/;
const hex64=/^[0-9a-f]{64}$/i;
export function reconcileQdaRecursivePresentationCheckAliasV1(artifact){
  if(!object(artifact))return {status:'not_applicable',artifact,changed:false};
  const proof=artifact.runtime_verified_descendant_materialization;
  if(!object(proof)
    ||proof.contract!=='qda_verified_descendant_materialization_v0_2_recursive'
    ||proof.source!=='completed_verified_atomic_descendants'
    ||!Array.isArray(artifact.python_checks)
    ||!artifact.python_checks.length
    ||!Array.isArray(proof.descendants)
    ||!proof.descendants.length)return {status:'not_applicable',artifact,changed:false};
  const count=proof.descendants.reduce((sum,item)=>{
    if(!object(item)
      ||!digestPath.test(String(item.node_path||''))
      ||!hex64.test(String(item.result_hash||''))
      ||!Number.isInteger(Number(item.check_count))
      ||Number(item.check_count)<1)return NaN;
    return sum+Number(item.check_count);
  },0);
  if(!Number.isFinite(count)||count!==artifact.python_checks.length)
    return {status:'unverified_manifest',artifact,changed:false};
  const calc=artifact.calculation;
  if(!object(calc)||!own(calc,'python_checks')||Array.isArray(calc.python_checks))
    return {status:'no_conflicting_presentation_alias',artifact,changed:false};
  // Object-valued check structures are ambiguous, so never reinterpret them
  // as narrative; existing fail-closed validation remains authoritative.
  const value=calc.python_checks;
  if(value!==null&&typeof value==='object')
    return {status:'unsafe_check_structure',artifact,changed:false};
  if(own(calc,'python_checks_presentation_note'))
    return {status:'alias_conflict',artifact,changed:false};
  const {python_checks:note,...otherCalculation}=calc;
  const next={
    ...artifact,
    calculation:{...otherCalculation,python_checks_presentation_note:note},
    runtime_verified_descendant_materialization:{
      ...proof,
      presentation_check_alias_reconciled:{
        contract:'qda_recursive_presentation_python_checks_alias_v0_1',
        original_path:'calculation.python_checks',
        relocated_path:'calculation.python_checks_presentation_note',
        original_type:note===null?'null':typeof note,
        source:'non_executable_agent_presentation',
        executable_checks_source:'verified_atomic_descendants',
        executable_check_count:artifact.python_checks.length,
        descendants_preserved:true,
      },
    },
  };
  return {status:'reconciled',artifact:next,changed:true};
}
export function probeQdaRecursivePresentationCheckAliasV1(){
  const checks=[{label:'atomic_a',expression:'5-2',claimed_result:3},
                {label:'atomic_b',expression:'9-4',claimed_result:5}];
  const proof={
    contract:'qda_verified_descendant_materialization_v0_2_recursive',
    source:'completed_verified_atomic_descendants',
    descendants:[
      {node_path:'R.002.003.002.001',result_hash:'a'.repeat(64),check_count:1},
      {node_path:'R.002.003.002.002',result_hash:'b'.repeat(64),check_count:1},
    ],
  };
  const base={python_checks:checks,calculation:{net_burn:3,python_checks:'2 checks inherited from verified leaves'},runtime_verified_descendant_materialization:proof};
  let n=0;
  const assert=(v,label)=>{if(!v)throw Error('qda_recursive_check_alias_regression:'+label);n++;};
  const actual=reconcileQdaRecursivePresentationCheckAliasV1(base);
  assert(actual.status==='reconciled'&&actual.changed,'renames_non_executable_summary');
  assert(!own(actual.artifact.calculation,'python_checks'),'no_nested_untyped_check');
  assert(actual.artifact.calculation.python_checks_presentation_note==='2 checks inherited from verified leaves','preserve_author_note');
  assert(actual.artifact.python_checks===checks,'preserve_original_checks_array_identity');
  assert(actual.artifact.runtime_verified_descendant_materialization.descendants===proof.descendants,'preserve_manifest');
  assert(base.calculation.python_checks==='2 checks inherited from verified leaves','no_in_place_mutation');
  assert(reconcileQdaRecursivePresentationCheckAliasV1(actual.artifact).changed===false,'idempotent');
  const invalid={...base,runtime_verified_descendant_materialization:{...proof,descendants:[{...proof.descendants[0],result_hash:'invalid'},proof.descendants[1]]}};
  assert(reconcileQdaRecursivePresentationCheckAliasV1(invalid).status==='unverified_manifest','wrong_hash_fails_closed');
  assert(reconcileQdaRecursivePresentationCheckAliasV1({...base,python_checks:[checks[0]]}).status==='unverified_manifest','count_mismatch_fails_closed');
  assert(reconcileQdaRecursivePresentationCheckAliasV1({...base,calculation:{python_checks:{proof:'unknown'}}}).status==='unsafe_check_structure','object_checks_fails_closed');
  assert(reconcileQdaRecursivePresentationCheckAliasV1({...base,calculation:{python_checks:checks}}).changed===false,'valid_nested_array_unchanged');
  assert(reconcileQdaRecursivePresentationCheckAliasV1({...base,calculation:{python_checks:12,python_checks_presentation_note:'prior'}}).status==='alias_conflict','no_alias_overwrite');
  assert(reconcileQdaRecursivePresentationCheckAliasV1({...base,runtime_verified_descendant_materialization:{...proof,source:'model_claim'}}).status==='not_applicable','no_unverified_provider_override');
  return {ok:true,checks:n,contract:'qda_recursive_presentation_python_checks_alias_v0_1',synthetic:true,provider_calls:0,agent_wakes:0};
}
