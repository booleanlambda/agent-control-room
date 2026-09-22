import fs from 'node:fs';

const sourcePath=process.argv[2]||'curriculum/entrepreneurship-masters-v0.1.json';
const data=JSON.parse(fs.readFileSync(sourcePath,'utf8'));

const courseRows=data.courses.map(c=>({
  course_code:c.code,
  program_version:data.program_version,
  course_order:c.order,
  title:c.title,
  category:c.category,
  description:c.description,
  learning_objectives:c.objectives,
  required_units:c.units.length,
  course_pass_threshold:c.category==='capstone'?data.requirements.capstone_floor:data.requirements.course_floor,
  assessment_blueprint:{
    case_analysis:0.30,
    quantitative_or_structured_reasoning:0.30,
    applied_decision:0.30,
    clarity_and_epistemic_discipline:0.10,
    pass_rule:c.category==='capstone'
      ?`score>=${data.requirements.capstone_floor} and no critical rubric dimension below 0.75`
      :`score>=${data.requirements.course_floor} and no critical rubric dimension below 0.70`
  }
}));

const unitRows=[];
for(const c of data.courses){
  c.units.forEach((u,i)=>{
    const [title,type,objective,prompt]=u;
    unitRows.push({
      course_code:c.code,
      unit_order:i+1,
      title,
      unit_type:type,
      learning_objectives:[objective],
      study_brief:`Master ${objective} Use first-principles reasoning, explicit assumptions, quantitative work where relevant, and distinguish sourced facts from model assumptions.`,
      assignment_prompt:prompt,
      evidence_requirements:{
        minimum_components:['reasoning_artifact','assumptions','conclusion','self_critique'],
        quantitative_work_required:type==='quantitative',
        source_provenance_required_when_research_used:true,
        narrative_claims_alone_do_not_count_as_mastery:true,
        external_research_when_material_claims_depend_on_current_facts:true
      },
      rubric:{...data.default_unit_contract.rubric,submission_threshold:0.80},
      minimum_submission_chars:type==='capstone'
        ?data.default_unit_contract.capstone_minimum_submission_chars
        :data.default_unit_contract.minimum_submission_chars
    });
  });
}

function dollarJson(value){return '$curriculum$'+JSON.stringify(value)+'$curriculum$::jsonb';}

const sql=`begin;

insert into agent_lab.entrepreneurship_courses(
 course_code,program_version,course_order,title,category,description,learning_objectives,
 required_units,course_pass_threshold,assessment_blueprint
)
select x.course_code,x.program_version,x.course_order,x.title,x.category,x.description,
 x.learning_objectives,x.required_units,x.course_pass_threshold,x.assessment_blueprint
from jsonb_to_recordset(${dollarJson(courseRows)}) as x(
 course_code text,program_version text,course_order int,title text,category text,description text,
 learning_objectives jsonb,required_units int,course_pass_threshold numeric,assessment_blueprint jsonb
)
on conflict(course_code) do update set
 program_version=excluded.program_version,course_order=excluded.course_order,title=excluded.title,
 category=excluded.category,description=excluded.description,learning_objectives=excluded.learning_objectives,
 required_units=excluded.required_units,course_pass_threshold=excluded.course_pass_threshold,
 assessment_blueprint=excluded.assessment_blueprint,updated_at=now();

insert into agent_lab.entrepreneurship_units(
 course_code,unit_order,title,unit_type,learning_objectives,study_brief,assignment_prompt,
 evidence_requirements,rubric,minimum_submission_chars
)
select x.course_code,x.unit_order,x.title,x.unit_type,x.learning_objectives,x.study_brief,
 x.assignment_prompt,x.evidence_requirements,x.rubric,x.minimum_submission_chars
from jsonb_to_recordset(${dollarJson(unitRows)}) as x(
 course_code text,unit_order int,title text,unit_type text,learning_objectives jsonb,study_brief text,
 assignment_prompt text,evidence_requirements jsonb,rubric jsonb,minimum_submission_chars int
)
on conflict(course_code,unit_order) do update set
 title=excluded.title,unit_type=excluded.unit_type,learning_objectives=excluded.learning_objectives,
 study_brief=excluded.study_brief,assignment_prompt=excluded.assignment_prompt,
 evidence_requirements=excluded.evidence_requirements,rubric=excluded.rubric,
 minimum_submission_chars=excluded.minimum_submission_chars,updated_at=now();

commit;
`;

process.stdout.write(sql);
