-- Independent entrepreneurship final review integrity v0.2.
-- Forward-only: preserves existing course/final history; new completions fail closed.
-- An independent final must be complete, source-backed, dimension-checked and not
-- reproduce the prior capstone assessor's review or the other final report.

create or replace function agent_lab.entrepreneurship_final_integrity_gate_v0_2(
  p_final_assessment_id uuid, p_score numeric, p_assessor_id text, p_report jsonb
) returns jsonb
language plpgsql stable
set search_path to 'pg_catalog','agent_lab'
as $fn$
declare
  v_f agent_lab.entrepreneurship_final_assessments%rowtype;
  v_cap jsonb;
  v_other record;
  v_required text[] := array[
    'conceptual_accuracy','analytical_rigor','quantitative_or_structured_reasoning',
    'application_quality','evidence_and_assumption_discipline',
    'self_critique_and_limits','clarity_and_epistemic_discipline'
  ];
  v_name text;
  v_dims jsonb:=coalesce(p_report->'dimensions','{}'::jsonb);
  v_value numeric;
  v_min numeric:=1;
  v_good_dimensions int:=0;
  v_issues jsonb:='[]'::jsonb;
  v_rationale text:=lower(regexp_replace(btrim(coalesce(p_report->>'rationale','')),'[[:space:]]+',' ','g'));
  v_pass boolean;
begin
  select * into v_f from agent_lab.entrepreneurship_final_assessments
    where final_assessment_id=p_final_assessment_id;
  if not found then raise exception 'final_assessment_not_found'; end if;

  if p_score is null or p_score<0 or p_score>1 then
    v_issues:=v_issues||'"score_out_of_range"'::jsonb;
  end if;
  if jsonb_typeof(p_report->'score') is distinct from 'number' then
    v_issues:=v_issues||'"report_score_missing"'::jsonb;
  elsif (p_report->>'score')::numeric is distinct from p_score then
    v_issues:=v_issues||'"report_score_mismatch"'::jsonb;
  end if;
  if jsonb_typeof(p_report->'critical_failure') is distinct from 'boolean' then
    v_issues:=v_issues||'"critical_failure_not_boolean"'::jsonb;
  end if;
  if jsonb_typeof(v_dims) is distinct from 'object' then v_dims:='{}'::jsonb; end if;
  foreach v_name in array v_required loop
    if jsonb_typeof(v_dims->v_name) is distinct from 'number' then
      v_issues:=v_issues||jsonb_build_array('dimension_missing_or_invalid:'||v_name);
    else
      v_value:=(v_dims->>v_name)::numeric;
      if v_value<0 or v_value>1 then
        v_issues:=v_issues||jsonb_build_array('dimension_out_of_range:'||v_name);
      else
        v_min:=least(v_min,v_value);
        v_good_dimensions:=v_good_dimensions+1;
      end if;
    end if;
  end loop;

  if length(v_rationale)<80 then v_issues:=v_issues||'"rationale_too_short"'::jsonb; end if;
  if jsonb_typeof(p_report->'strengths') is distinct from 'array' then
    v_issues:=v_issues||'"strengths_missing"'::jsonb;
  elsif jsonb_array_length(p_report->'strengths')<1 then
    v_issues:=v_issues||'"strengths_empty"'::jsonb;
  end if;
  if jsonb_typeof(p_report->'weaknesses') is distinct from 'array' then
    v_issues:=v_issues||'"weaknesses_missing"'::jsonb;
  elsif jsonb_array_length(p_report->'weaknesses')<1 then
    v_issues:=v_issues||'"weaknesses_empty"'::jsonb;
  end if;
  if jsonb_typeof(p_report->'remediation') is distinct from 'array' then
    v_issues:=v_issues||'"remediation_missing"'::jsonb;
  elsif jsonb_array_length(p_report->'remediation')<1 then
    v_issues:=v_issues||'"remediation_empty"'::jsonb;
  end if;

  if p_report->>'review_input_contract' is distinct from 'entrepreneurship_review_input_v0_2'
     or jsonb_typeof(p_report->'review_input_complete') is distinct from 'boolean'
     or p_report->>'review_input_complete' is distinct from 'true'
     or coalesce(p_report->>'review_input_sha256','') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_report->'review_input_chars') is distinct from 'number'
     or coalesce(p_report->>'source_course_count','')<>'15'
     or coalesce(p_report->>'source_capstone_unit_count','')<>'4'
     or p_report->>'capstone_prior_assessment_excluded' is distinct from 'true'
  then
    v_issues:=v_issues||'"full_source_input_provenance_missing"'::jsonb;
  elsif (p_report->>'review_input_chars')::numeric<1000
     or (p_report->>'review_input_chars')::numeric>90000 then
    v_issues:=v_issues||'"review_input_length_invalid"'::jsonb;
  end if;

  if p_report->>'independent_from_bound_agent_model' is distinct from 'true'
     or p_report->>'review_provider' is distinct from 'nvidia_direct'
     or length(btrim(coalesce(p_report->>'review_model','')))<3
     or lower(coalesce(p_assessor_id,''))<>lower('nvidia_direct/'||coalesce(p_report->>'review_model',''))
  then
    v_issues:=v_issues||'"assessor_identity_or_independence_invalid"'::jsonb;
  end if;

  if (select count(distinct course_code) from agent_lab.entrepreneurship_course_assessments
      where enrollment_id=v_f.enrollment_id and status='verified_pass')<>15 then
    v_issues:=v_issues||'"source_course_records_not_15"'::jsonb;
  end if;
  if not exists (
    select 1 from agent_lab.entrepreneurship_capstones c
    where c.enrollment_id=v_f.enrollment_id and c.status='verified_pass'
      and jsonb_typeof(c.submission_artifact->'unit_submissions')='array'
      and jsonb_array_length(c.submission_artifact->'unit_submissions')=4
  ) then
    v_issues:=v_issues||'"source_capstone_incomplete"'::jsonb;
  end if;

  select c.rubric_report into v_cap
    from agent_lab.entrepreneurship_course_assessments c
    where c.enrollment_id=v_f.enrollment_id and c.course_code='CAP515'
      and c.status='verified_pass' order by c.completed_at desc limit 1;
  if v_rationale<>'' and (
      v_rationale=lower(regexp_replace(btrim(coalesce(v_cap->>'rationale','')),'[[:space:]]+',' ','g'))
      or (p_report->'strengths'=v_cap->'strengths'
          and p_report->'weaknesses'=v_cap->'weaknesses'
          and p_report->'dimensions'=v_cap->'dimensions')
  ) then
    v_issues:=v_issues||'"capstone_assessor_report_reused"'::jsonb;
  end if;

  for v_other in
    select assessor_id,report from agent_lab.entrepreneurship_final_assessments
      where enrollment_id=v_f.enrollment_id and final_assessment_id<>p_final_assessment_id
        and status in ('verified_pass','verified_fail')
  loop
    if lower(btrim(coalesce(v_other.assessor_id,'')))=lower(btrim(coalesce(p_assessor_id,''))) then
      v_issues:=v_issues||'"final_assessor_identity_reused"'::jsonb;
    end if;
    if v_rationale<>'' and (
       v_rationale=lower(regexp_replace(btrim(coalesce(v_other.report->>'rationale','')),'[[:space:]]+',' ','g'))
       or (p_report->'strengths'=v_other.report->'strengths'
           and p_report->'weaknesses'=v_other.report->'weaknesses'
           and p_report->'dimensions'=v_other.report->'dimensions')
    ) then
      v_issues:=v_issues||'"other_final_report_reused"'::jsonb;
    end if;
  end loop;

  v_pass:=jsonb_array_length(v_issues)=0
          and p_score>=0.85 and v_good_dimensions=7 and v_min>=0.75
          and p_report->>'critical_failure'='false';

  return jsonb_build_object(
    'valid',jsonb_array_length(v_issues)=0,'passed',v_pass,
    'issues',v_issues,'source','entrepreneurship_final_integrity_gate_v0_2',
    'score_floor',0.85,'dimension_floor',0.75,
    'required_dimension_count',7,'valid_dimension_count',v_good_dimensions,
    'minimum_dimension_score',case when v_good_dimensions=7 then v_min else null end,
    'critical_failure_explicitly_false',p_report->>'critical_failure'='false',
    'full_input_contract_verified',p_report->>'review_input_contract'='entrepreneurship_review_input_v0_2'
  );
end
$fn$;

revoke all on function agent_lab.entrepreneurship_final_integrity_gate_v0_2(uuid,numeric,text,jsonb)
  from public,anon,authenticated;

create or replace function agent_lab.record_entrepreneurship_final_assessment_v0_1(
 p_final_assessment_id uuid,p_score numeric,p_assessor_kind text,p_assessor_id text,p_report jsonb
) returns jsonb
language plpgsql
set search_path to 'pg_catalog','agent_lab'
as $fn$
declare
  v_f agent_lab.entrepreneurship_final_assessments%rowtype;
  v_status text;
  v_passed int:=0;
  v_gate jsonb;
begin
  if p_score is null or p_score<0 or p_score>1 then
    raise exception 'final_assessment_score_out_of_range';
  end if;
  if p_assessor_kind not in ('independent_model','human','hybrid') then
    raise exception 'invalid_assessor_kind';
  end if;
  if length(btrim(coalesce(p_assessor_id,'')))<2 then
    raise exception 'independent_assessor_required';
  end if;

  select * into v_f from agent_lab.entrepreneurship_final_assessments
    where final_assessment_id=p_final_assessment_id for update;
  if not found then raise exception 'final_assessment_not_found'; end if;
  if v_f.status<>'running' then
    raise exception 'final_assessment_not_running: %',v_f.status;
  end if;

  v_gate:=agent_lab.entrepreneurship_final_integrity_gate_v0_2(
    p_final_assessment_id,p_score,p_assessor_id,p_report
  );
  if not coalesce((v_gate->>'valid')::boolean,false) then
    raise exception 'final_assessment_integrity_gate_rejected: %',v_gate->'issues';
  end if;
  v_status:=case when (v_gate->>'passed')::boolean then 'verified_pass' else 'verified_fail' end;

  update agent_lab.entrepreneurship_final_assessments
    set status=v_status,score=p_score,assessor_kind=p_assessor_kind,
        assessor_id=left(p_assessor_id,300),
        report=p_report||jsonb_build_object('integrity_gate',v_gate),
        completed_at=now(),updated_at=now()
    where final_assessment_id=p_final_assessment_id;

  select count(*)::int into v_passed
    from agent_lab.entrepreneurship_final_assessments
    where enrollment_id=v_f.enrollment_id and status='verified_pass';

  return jsonb_build_object(
    'final_assessment_id',p_final_assessment_id,'status',v_status,'score',p_score,
    'independent_final_passes',v_passed,'required',2,'integrity_gate',v_gate,
    'durable_evidence_evaluation',agent_lab.evaluate_entrepreneurship_masters_v0_1(v_f.agent_id)
  );
end
$fn$;
