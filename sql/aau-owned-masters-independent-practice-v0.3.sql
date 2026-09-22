-- The AAU graduate standard cannot be satisfied by legacy model scores or
-- self-labelled test statements. Fresh, standard-bound independent practice
-- evidence must be recorded for EACH prescribed competency.
create or replace function agent_lab.evaluate_owned_master_practice_v0_3(
 p_agent_id uuid,p_artifact_id uuid
) returns jsonb language plpgsql stable set search_path to 'pg_catalog','agent_lab'
as $$
declare v agent_lab.expertise_standard_versions%rowtype;
 v_comp jsonb; v_label text; v_id text; v_count int; v_required int:=0;
 v_covered int:=0; v_items jsonb:='[]'::jsonb;
begin
 select * into v from agent_lab.expertise_standard_versions
  where agent_id=p_agent_id and artifact_id=p_artifact_id and status='approved' limit 1;
 if not found then return jsonb_build_object('ready',false,'reason','standard_not_approved'); end if;
 for v_comp in select value from jsonb_array_elements(v.public_spec->'competencies') loop
    v_id:=v_comp->>'id';v_label:=v_comp->>'label';v_required:=v_required+1;
    select count(*) into v_count from agent_lab.domain_practice_attempts p
      where p.agent_id=p_agent_id and p.attempted_at>=v.approved_at
        and p.independently_evaluated=true and nullif(btrim(p.evaluator_ref),'') is not null
        and jsonb_typeof(p.evidence)='object'
        and p.evidence->>'academic_standard_sha256'=v.specification_sha256
        and (lower(p.skill_component)=lower(v_label) or lower(p.skill_component)=lower(v_id))
        and p.evidence ? 'source_file_id'
        and p.evidence ? 'execution_or_assessment_receipt';
    if v_count>0 then v_covered:=v_covered+1; end if;
    v_items:=v_items||jsonb_build_array(jsonb_build_object(
       'competency_id',v_id,'competency_label',v_label,
       'independent_standard_bound_practice',v_count,'covered',v_count>0));
 end loop;
 return jsonb_build_object('version','aau_owned_master_practice_v0_3',
   'ready',v_required>=4 and v_covered=v_required,
   'required_competencies',v_required,'covered_competencies',v_covered,
   'coverage',v_items,
   'rule','All competencies require fresh standard-bound practice with an independent evaluator, file ID and actual execution or assessment receipt. A printed success claim does not count.');
end;
$$;
revoke all on function agent_lab.evaluate_owned_master_practice_v0_3(uuid,uuid) from public,anon,authenticated;
