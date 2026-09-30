import { executePrecisionSpec, getPrecisionCapabilities } from './precision-engineer.js';

export function runPrecisionEngineerSmoke(){
  const verified=executePrecisionSpec({
    schema:'aau.precision_spec.v0_1',
    job_id:'smoke_retention',
    intent:'Verify compounded retention and churn example.',
    assumptions:[{statement:'Monthly logo retention is 96.5%.'}],
    missing_information:[],
    arithmetic_checks:[
      {id:'retention_12m',expression:'0.965 ** 12',claimed_result:0.6521203607482342,unit:'ratio'},
      {id:'compounded_churn',expression:'1 - (0.965 ** 12)',claimed_result:0.3478796392517658,unit:'ratio'},
      {id:'linear_churn',expression:'(1 - 0.965) * 12',claimed_result:0.42,unit:'ratio'},
      {id:'difference',expression:'((1 - 0.965) * 12) - (1 - (0.965 ** 12))',claimed_result:0.0721203607482342,unit:'ratio'},
    ],
    statistical_analyses:[],
  });

  const mismatch=executePrecisionSpec({
    schema:'aau.precision_spec.v0_1',
    job_id:'smoke_mismatch',
    intent:'Ensure wrong claims are reconciled, never silently corrected.',
    assumptions:[{statement:'Test fixture.'}],
    missing_information:[],
    arithmetic_checks:[
      {id:'wrong',expression:'2 + 2',claimed_result:5,unit:'count'},
    ],
    statistical_analyses:[],
  });

  const needContext=executePrecisionSpec({
    schema:'aau.precision_spec.v0_1',
    job_id:'smoke_missing',
    intent:'Ensure missing assumptions block execution.',
    assumptions:[],
    missing_information:['discount_rate'],
    arithmetic_checks:[],
    statistical_analyses:[],
  });

  const capabilities=getPrecisionCapabilities();
  const ok=verified.status==='VERIFIED'
    && verified.arithmetic.check_count===4
    && mismatch.status==='RECONCILE'
    && mismatch.mismatches.length===1
    && needContext.status==='NEED_CONTEXT'
    && capabilities.secondary_model_required===false
    && capabilities.spec_author==='originating_agent';

  return {
    ok,
    engine:'aau_precision_engineer_v0_1',
    architecture:capabilities.architecture,
    secondary_model_required:capabilities.secondary_model_required,
    verified_status:verified.status,
    verified_check_count:verified.arithmetic.check_count,
    mismatch_status:mismatch.status,
    need_context_status:needContext.status,
  };
}
