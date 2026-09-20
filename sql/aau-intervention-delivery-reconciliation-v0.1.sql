-- Reconcile delivery state for runtime intervention events.
-- This resolves only the *delivery workflow*, never the underlying failed wake
-- or an independent expertise/product verification hold.
CREATE OR REPLACE FUNCTION agent_lab.sync_intervention_delivery_v0_1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog','agent_lab'
AS $function$
BEGIN
  IF NEW.delivery_status = 'responded' THEN
    UPDATE agent_lab.intervention_events i
       SET status='resolved',
           updated_at=now(),
           evidence=coalesce(i.evidence,'{}'::jsonb) ||
             jsonb_build_object('message_reconciliation','responded',
               'reconciled_at',now(),'original_failure_preserved',true)
     WHERE i.message_id=NEW.message_id AND i.status IN ('queued','delivered');
  ELSIF NEW.delivery_status = 'delivered' THEN
    UPDATE agent_lab.intervention_events i
       SET status='delivered', updated_at=now()
     WHERE i.message_id=NEW.message_id AND i.status='queued';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION agent_lab.sync_intervention_delivery_v0_1()
FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_sync_intervention_delivery_v0_1
ON agent_lab.admin_chat_messages;
CREATE TRIGGER trg_sync_intervention_delivery_v0_1
AFTER UPDATE OF delivery_status ON agent_lab.admin_chat_messages
FOR EACH ROW
WHEN (OLD.delivery_status IS DISTINCT FROM NEW.delivery_status)
EXECUTE FUNCTION agent_lab.sync_intervention_delivery_v0_1();
