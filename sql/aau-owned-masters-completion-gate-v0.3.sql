-- Independent AAU graduate-standard completion, in addition to existing score policy.
create or replace function agent_lab.evaluate_owned_master_completion_v0_3(
 p_verification_run_id uuid,p_challenge_packet jsonb,p_final_report jsonb
) returns jsonb language plpgsql stable set search_path to 'pg_catalog','agent_lab'
as $$
declare v_run agent_lab.expertise_verification_runs%rowtype;
        v_std agent_lab.expertise_standard_versions%rowtype;
        v_check jsonb;v_practice jsonb;v_missing jsonb:='[]'::jsonb;
        v_expected int:=0;v_seen int:=0;v_item jsonb;v_grade jsonb;
begin
 select * into v_run from agent_lab.expertise_verification_runs
   where verification_run_id=p_verification_run_id;
 if not found or v_run.metadata->>'academic_standard_version'<>'aau_owned_master_us_v0_3' then
   return jsonb_build_object('passed',false,'missing',jsonb_build_array('not_a_v0_3_exam'));
 end if;
 select * into v_std from agent_lab.expertise_standard_versions
   where artifact_id=v_run.expertise_artifact_id and agent_id=v_run.agent_id and status='approved'
     and specification_sha256=v_run.metadata->>'academic_standard_sha256' limit 1;
 if not found then
   return jsonb_build_object('passed',false,'missing',jsonb_build_array('reviewed_standard_binding_missing'));
 end if;
 v_check:=agent_lab.validate_owned_expertise_standard_v0_3(
    v_std.public_spec,v_std.private_assessment,v_std.source_receipts);
 if not coalesce((v_check->>'ok')::boolean,false) then
   v_missing:=v_missing||jsonb_build_array('standard_validation_failed');
 end if;
 v_practice:=agent_lab.evaluate_owned_master_practice_v0_3(v_run.agent_id,v_run.expertise_artifact_id);
 if not coalesce((v_practice->>'ready')::boolean,false) then
   v_missing:=v_missing||jsonb_build_array('independent_standard_bound_practice_incomplete');
 end if;
 if p_challenge_packet #>> '{authority,specification_sha256}' is distinct from v_std.specification_sha256 then
   v_missing:=v_missing||jsonb_build_array('challenge_authority_hash_mismatch');
 end if;
 v_expected:=jsonb_array_length(v_std.private_assessment->'tasks');
 v_seen:=jsonb_array_length(case when jsonb_typeof(p_challenge_packet->'tasks')='array'
         then p_challenge_packet->'tasks' else '[]'::jsonb end);
 if v_expected<4 or v_seen<>v_expected then
   v_missing:=v_missing||jsonb_build_array('hidden_task_count_mismatch');
 end if;
 for v_item in select value from jsonb_array_elements(v_std.private_assessment->'tasks') loop
   if not exists(
     select 1 from jsonb_array_elements(case when jsonb_typeof(p_challenge_packet->'tasks')='array'
       then p_challenge_packet->'tasks' else '[]'::jsonb end) x
     where x->>'id'=v_item->>'id' and x->>'competency'=v_item->>'competency'
       and x->>'scenario'=v_item->>'scenario' and x->>'prompt'=v_item->>'prompt'
   ) then v_missing:=v_missing||jsonb_build_array('task_mismatch:'||(v_item->>'id')); end if;
   select x into v_grade from jsonb_array_elements(
     case when jsonb_typeof(p_final_report->'final_grades')='array' then p_final_report->'final_grades'
       else '[]'::jsonb end) x where x->>'id'=v_item->>'id' limit 1;
   if v_grade is null or v_grade->>'score' is null or (v_grade->>'score')::numeric<0.80
     or coalesce((v_grade->>'unsupported')::boolean,false)
     or (v_grade->>'critical_error' is not null and v_grade->>'critical_error'<>'null') then
     v_missing:=v_missing||jsonb_build_array('task_not_independently_passed:'||(v_item->>'id'));
   end if;
   v_grade:=null;
 end loop;
 return jsonb_build_object('version','aau_owned_master_completion_v0_3',
   'passed',v_missing='[]'::jsonb,'missing',v_missing,
   'standard_id',v_std.standard_id,'standard_sha256',v_std.specification_sha256,
   'mandatory_tasks',v_expected,'independent_practice',v_practice,
   'academic_target','leading_us_university_masters_level_demonstrated_competence',
   'university_degree_or_affiliation_awarded',false);
end;
$$;
revoke all on function agent_lab.evaluate_owned_master_completion_v0_3(uuid,jsonb,jsonb) from public,anon,authenticated;
