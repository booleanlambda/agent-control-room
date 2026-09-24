-- Reject unfinished CAP515 analysis before unit progress is recorded.
-- Patch is intentionally guarded against an unexpected upstream function revision.
begin;
do $patch$
declare
  v_def text:=pg_get_functiondef('agent_lab.capture_entrepreneurship_unit_submission_v0_1()'::regprocedure);
  v_old text:=$old$  elsif jsonb_typeof(v_evidence)<>'array' then
    v_rejection_detail:=format('evidence must be a JSON array; received JSON type %s',coalesce(jsonb_typeof(v_evidence),'null'));
  end if;$old$;
  v_new text:=$new$  elsif jsonb_typeof(v_evidence)<>'array' then
    v_rejection_detail:=format('evidence must be a JSON array; received JSON type %s',coalesce(jsonb_typeof(v_evidence),'null'));
  elsif v_unit.course_code='CAP515'
    and v_analysis ~* E'(^|\\n)[[:space:]]*([-*][[:space:]]*)?[[:alnum:]$/(). ,_-]{2,65}:[[:space:]]*$' then
    v_rejection_detail:='CAP515 analysis ends in an unfilled heading or calculation label. Complete the response before resubmitting.';
  end if;$new$;
begin
  if strpos(v_def,v_new)>0 then
    raise notice 'CAP515 unit completion check already applied';
    return;
  end if;
  if strpos(v_def,v_old)=0 then
    raise exception 'CAP515 unit capture changed upstream: refusing unverified patch';
  end if;
  execute replace(v_def,v_old,v_new);
end;
$patch$;
commit;
