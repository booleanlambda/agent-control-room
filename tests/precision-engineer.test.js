import test from 'node:test';
import assert from 'node:assert/strict';
import { executePrecisionSpec, getPrecisionCapabilities, validatePrecisionSpec } from '../workers/precision-engineer.js';
import { runPrecisionEngineerSmoke } from '../workers/precision-engineer-smoke.js';

test('verified arithmetic job passes deterministic engine',()=>{
  const result=executePrecisionSpec({
    schema:'aau.precision_spec.v0_1',
    job_id:'t1',
    intent:'verify compound growth',
    assumptions:[{statement:'18% annual growth for 3 periods'}],
    missing_information:[],
    arithmetic_checks:[
      {id:'fv',expression:'2400000 * (1.18 ** 3)',claimed_result:3943276.8,unit:'USD'},
    ],
    statistical_analyses:[],
  });
  assert.equal(result.status,'VERIFIED');
  assert.equal(result.verified,true);
});

test('wrong model claim returns RECONCILE and is not overwritten',()=>{
  const result=executePrecisionSpec({
    schema:'aau.precision_spec.v0_1',
    job_id:'t2',
    intent:'catch arithmetic disagreement',
    assumptions:[{statement:'fixture'}],
    missing_information:[],
    arithmetic_checks:[
      {id:'sum',expression:'20 + 22',claimed_result:41,unit:'count'},
    ],
    statistical_analyses:[],
  });
  assert.equal(result.status,'RECONCILE');
  assert.equal(result.mismatches[0].claimed_result,41);
  assert.equal(result.mismatches[0].deterministic_result,42);
});

test('missing information blocks execution instead of inventing assumptions',()=>{
  const result=executePrecisionSpec({
    schema:'aau.precision_spec.v0_1',
    job_id:'t3',
    intent:'discount cash flow',
    assumptions:[],
    missing_information:['discount_rate'],
    arithmetic_checks:[],
    statistical_analyses:[],
  });
  assert.equal(result.status,'NEED_CONTEXT');
});

test('material arithmetic requires explicit units',()=>{
  const validation=validatePrecisionSpec({
    schema:'aau.precision_spec.v0_1',
    job_id:'t4',
    intent:'unit enforcement',
    assumptions:[],
    missing_information:[],
    arithmetic_checks:[{id:'x',expression:'2+2',claimed_result:4}],
    statistical_analyses:[],
  });
  assert.equal(validation.ok,false);
  assert.ok(validation.failures.includes('precision_arithmetic_1_unit_required'));
});


test('raw natural-language requests are not planned inside the precision layer',()=>{
  const result=executePrecisionSpec({
    request:'Calculate 2 + 2 for me.'
  });
  assert.equal(result.status,'ESCALATE');
  assert.equal(result.reason,'invalid_precision_spec');
  assert.ok(result.details.validation_failures.includes('precision_schema_invalid'));
});

test('precision core requires no secondary model',()=>{
  const capabilities=getPrecisionCapabilities();
  assert.equal(capabilities.secondary_model_required,false);
  assert.equal(capabilities.spec_author,'originating_agent');
  assert.equal(capabilities.architecture,'deterministic_precision_substrate');
});

test('statistical disagreement is surfaced for reconciliation',()=>{
  const result=executePrecisionSpec({
    schema:'aau.precision_spec.v0.1',
    job_id:'t_stats',
    intent:'verify descriptive mean',
    assumptions:[{statement:'Dataset values are observed inputs.'}],
    missing_information:[],
    arithmetic_checks:[],
    statistical_analyses:[
      {
        id:'describe_fixture',
        analysis:'describe',
        spec:{values:[1,2,3,4]},
        claims:{mean:3}
      }
    ],
  });
  assert.equal(result.status,'RECONCILE');
  assert.equal(result.statistical.all_claims_match,false);
  assert.equal(result.mismatches[0].type,'statistical');
});

test('full smoke suite passes',()=>{
  assert.equal(runPrecisionEngineerSmoke().ok,true);
});
