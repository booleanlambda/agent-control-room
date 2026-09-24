-- Fail closed on unaudited entrepreneurship final reviews. Preserves historical grading records.
-- A qualifying program certificate requires TWO final reviews independently valid under v0.2.
CREATE OR REPLACE FUNCTION agent_lab.evaluate_entrepreneurship_masters_v0_1(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
 v_e agent_lab.entrepreneurship_enrollments%rowtype;
 v_courses int:=0;
 v_core_courses int:=0;
 v_core_avg numeric:=0;
 v_cap_score numeric:=0;
 v_finals int:=0;
 v_final_avg numeric:=0;
 v_cap boolean:=false;
 v_overall numeric:=0;
 v_ready boolean:=false;
 v_integrity_valid_finals int:=0;
 v_integrity_hold boolean:=false;
begin
 select * into v_e from agent_lab.entrepreneurship_enrollments
 where agent_id=p_agent_id and program_version='entrepreneurship_masters_v0_1';
 if not found then return jsonb_build_object('ready',false,'reason','not_enrolled'); end if;

 select count(*)::int into v_courses
 from agent_lab.entrepreneurship_course_assessments
 where enrollment_id=v_e.enrollment_id and status='verified_pass';

 select count(*)::int,coalesce(avg(a.score),0)
 into v_core_courses,v_core_avg
 from agent_lab.entrepreneurship_course_assessments a
 where a.enrollment_id=v_e.enrollment_id and a.status='verified_pass' and a.course_code<>'CAP515';

 select coalesce(score,0),status='verified_pass' and coalesce(score,0)>=0.85
 into v_cap_score,v_cap
 from agent_lab.entrepreneurship_capstones
 where enrollment_id=v_e.enrollment_id;

 select count(*)::int,coalesce(avg(score),0)
 into v_finals,v_final_avg
 from agent_lab.entrepreneurship_final_assessments
 where enrollment_id=v_e.enrollment_id and status='verified_pass';

 -- An historical verified_pass is not sufficient if its assessor input was truncated,
 -- provenance is absent, or another assessment's prose was reused.
 select count(*)::int into v_integrity_valid_finals
 from agent_lab.entrepreneurship_final_assessments f
 cross join lateral (
   select agent_lab.entrepreneurship_final_integrity_gate_v0_2(
     f.final_assessment_id,f.score,f.assessor_id,f.report
   ) as outcome
 ) verified
 where f.enrollment_id=v_e.enrollment_id and f.status='verified_pass'
   and coalesce((verified.outcome->>'passed')::boolean,false);

 v_integrity_hold:=
   coalesce(v_e.metadata #>> '{independent_final_integrity_audit,status}','')='reverification_required';

 v_overall:=round((v_core_avg*0.60)+(v_cap_score*0.20)+(v_final_avg*0.20),4);
 v_ready:=v_courses>=15 and v_core_courses>=14 and v_finals>=2 and v_cap
          and v_core_avg>=0.80 and v_final_avg>=0.85 and v_overall>=0.85
          and v_integrity_valid_finals>=2 and not v_integrity_hold;

 return jsonb_build_object(
   'ready',v_ready,
   'courses_passed',v_courses,'courses_required',15,
   'core_courses_passed',v_core_courses,'core_courses_required',14,
   'core_course_average',round(v_core_avg,4),'core_course_floor',0.80,
   'capstone_passed',v_cap,'capstone_score',round(v_cap_score,4),'capstone_floor',0.85,
   'independent_final_assessments_passed',v_finals,'independent_final_assessments_required',2,
   'independent_final_average',round(v_final_avg,4),'independent_final_floor',0.85,
   'independent_final_assessments_integrity_passed',v_integrity_valid_finals,
   'independent_final_integrity_hold',v_integrity_hold,
   'program_integrity_status',case when v_integrity_hold or v_integrity_valid_finals<2 then 'reverification_required' else 'verified' end,
   'overall_score',v_overall,'overall_required',0.85,
   'weighting',jsonb_build_object('core_courses',0.60,'capstone',0.20,'independent_finals',0.20),
   'program_version','entrepreneurship_masters_v0_1'
 );
end
$function$

