import { compareQdaOutputObligationsV1 as compare, qdaSiblingOverlapGateV1 as gate } from './qda-output-obligation-v1.js';

const Q='for Problem 2 of QDA601-M10-U2';
const common='Provide inputs, assumptions, formula_or_model, calculation, units, interpretation, sanity_check, evidence, self_audit (Pass A/Pass B), and python_checks.';
const burn={
  requirement:'Calculate the 12-month trajectory of Net Burn '+Q+'. This calculation must utilize the Gross Profit trajectory from R.002.002 and Total Operating Expenses from R.002.003.001. '+common,
  scope_removed:'Net Burn, the flow variable',
};
const cash={
  requirement:'Calculate the 12-month trajectory of Ending Cash Balance '+Q+'. This calculation must utilize opening_cash (5,200,000) and Net Burn from R.002.003.002.001. '+common,
  scope_removed:'Ending Cash Balance, the stock variable',
};
const item=(name,period='12-month trajectory',tail='')=>({
  requirement:'Calculate the '+period+' of '+name+' '+Q+'. '+tail+' '+common,
});
const scenario=(label)=>({
  requirement:'Calculate Net Burn for '+label+' scenario '+Q+'. '+common,
});
const month=(value,prior)=>({
  requirement:'Calculate the paying accounts for Month '+value+' of Problem 2 of QDA601-M10-U2, utilizing inputs'+(prior?' from Month '+prior:'')+' and state from earlier nodes. '+common,
});
function runOne(a,b,expected,name,more={}){
  const result=compare(a,b);
  const adjudication=gate({output_scope:result,similarity:more.similarity??0.9,
    explicit_partition_disjoint:more.explicit_partition_disjoint||false});
  const actual=result.verdict==='disjoint'?'PASS':result.verdict==='overlap'?'REJECT':adjudication.reject?'LEGACY_REJECT':'LEGACY_PASS';
  if(actual!==expected)throw Error('qda_output_scope_regression:'+name+':expected='+expected+':actual='+actual+':'+JSON.stringify(result));
  return {name,expected,actual,reason:result.reason};
}
export function probeQdaOutputObligationV1(){
  const results=[];
  const check=(name,a,b,expected,more)=>results.push(runOne(a,b,expected,name,more));
  // Historical Silas child: same boilerplate, distinct output + dependency.
  check('01_net_burn_vs_ending_cash',cash,burn,'PASS');
  check('02_literal_duplicate',burn,burn,'REJECT');
  check('03_canonical_synonym',item('monthly net cash burn rate'),burn,'REJECT');
  check('04_composite_overlap',item('Ending Cash Balance and Net Burn'),burn,'REJECT');
  check('05_month2_depends_month1',month(2,1),month(1),'PASS');
  check('06_same_month_cross_metric',item('Net Burn','Month 2'),item('Ending Cash Balance','Month 2'),'PASS');
  check('07_overlapping_month_ranges',item('Net Burn','months 6-18 trajectory'),burn,'REJECT');
  check('08_declared_output_mismatch_fallback', {...cash,declared_output_scope:{metrics:['net_burn']}},burn,'LEGACY_REJECT',{similarity:0.802});
  check('09_unknown_metric_above_threshold',{requirement:'Perform unrecognized qualitative domain analysis '+Q},{requirement:'Perform unrecognized qualitative domain analysis '+Q},'LEGACY_REJECT',{similarity:0.80});
  check('10_unknown_metric_below_threshold',{requirement:'Perform qualitative analysis '+Q},{requirement:'Other unrelated action '+Q},'LEGACY_PASS',{similarity:0.75});
  check('11_base_vs_stress_scenario',scenario('base'),scenario('stress'),'PASS');
  check('12_base_case_synonym',scenario('base case'),scenario('base'),'REJECT');
  check('13_junk_metric_cannot_bypass',{requirement:'Calculate the trajectory of zzz_metric_9 '+Q},burn,'LEGACY_REJECT',{similarity:0.81});
  check('14_duplicate_token_stuffed', {...burn,requirement:burn.requirement+' Irrelevant appended boilerplate for unrelated forms and checks.'},burn,'REJECT',{similarity:0.31});
  check('15_case_punctuation_synonym',item('NET-BURN'),burn,'REJECT');
  // A first child is never rejected just because there are no prior siblings.
  const firstChild=[];
  if(firstChild.some(s=>gate({output_scope:compare(cash,s),similarity:0.99}).reject))
    throw Error('first_child_rejected_without_sibling');
  results.push({name:'16_no_siblings',expected:'PASS',actual:'PASS'});
  check('17_dependency_citation_not_owned_month',month(2,1),month(1,2),'PASS');
  check('18_real_cash_requirements',cash,burn,'PASS',{similarity:0.7922077922077922});
  check('19_same_output_months_6_18_vs_1_12',item('Net Burn','months 6 through 18 trajectory'),burn,'REJECT');
  check('20_non_qda_unknown_fallback',{requirement:'Calculate annual Net Burn'},burn,'LEGACY_REJECT',{similarity:0.83});
  check('21_alias_cash_balance',item('closing cash balance'),cash,'REJECT');
  check('22_cross_metric_even_high_similarity',cash,burn,'PASS',{similarity:0.99});
  // Guard regressions unrelated to QDA financial identity.
  const legacy=gate({output_scope:{verdict:'unknown'},similarity:0.80,explicit_partition_disjoint:true});
  if(legacy.reject)throw Error('legacy_explicit_numeric_partition_regression');
  results.push({name:'23_legacy_partition_override',expected:'PASS',actual:'PASS'});
  return {ok:true,checks:results.length,results,provider_calls:0,agent_wakes:0,contract:'qda_financial_output_scope_v0_1'};
}
