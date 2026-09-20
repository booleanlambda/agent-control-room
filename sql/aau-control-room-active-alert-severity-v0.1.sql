-- Operator status: resolved historical alerts must not contribute to current severity.
-- Historical failed wakes remain available in latest_historical_wake_error.
CREATE OR REPLACE VIEW agent_lab.operator_agent_status AS
 SELECT a.agent_id,
    a.internal_label,
    a.status AS lifecycle_status,
    a.public_name,
    a.is_public,
    COALESCE((s.state_payload ->> 'awake'::text)::boolean, false) AS awake,
    COALESCE((s.state_payload ->> 'sleeping'::text)::boolean, false) AS sleeping,
    COALESCE((s.state_payload ->> 'wake_pending'::text)::boolean, false) AS wake_pending,
    COALESCE((s.state_payload ->> 'wake_number'::text)::integer, 0) AS wake_number,
    s.current_focus,
    s.energy,
    s.curiosity,
    s.boredom,
    s.stress,
    s.social_appetite,
    la.created_at AS last_activity_at,
    la.event_type AS last_event_type,
    la.selected_action AS last_action,
    la.stated_reason AS last_stated_reason,
    la.resource_cost AS last_resource_cost,
    nw.next_time_wake_at,
    COALESCE(nw.active_event_triggers, '[]'::jsonb) AS active_event_triggers,
    COALESCE(qs.pending_wakes, 0::bigint) AS pending_wakes,
    qs.next_queued_due_at,
        CASE
            WHEN qs.latest_wake_status = 'failed'::text THEN qs.latest_wake_error
            ELSE NULL::text
        END AS last_wake_error,
    COALESCE(res.resources, '{}'::jsonb) AS resources,
    COALESCE(stim.pending_stimuli, 0::bigint) AS pending_stimuli,
    stim.top_stimulus_score,
    COALESCE(msg.unread_messages, 0::bigint) AS unread_messages,
    COALESCE(msg.sent_messages, 0::bigint) AS sent_messages,
    COALESCE(msg.received_messages, 0::bigint) AS received_messages,
    COALESCE(g.active_goals, 0::bigint) AS active_goals,
    COALESCE(p.active_projects, 0::bigint) AS active_projects,
    COALESCE(al.open_alerts, 0::bigint) AS open_alerts,
    al.highest_alert_severity,
    qs.latest_wake_status AS current_wake_status,
    qs.latest_wake_error AS current_wake_raw_error,
        CASE
            WHEN qs.latest_wake_status = 'cancelled'::text THEN qs.latest_wake_error
            ELSE NULL::text
        END AS latest_disposition_reason,
    qs.latest_failed_error AS latest_historical_wake_error,
    qs.latest_failed_at AS latest_historical_wake_error_at,
        CASE
            WHEN qs.latest_wake_status = 'failed'::text THEN qs.latest_wake_error
            ELSE NULL::text
        END AS current_wake_error,
        CASE
            WHEN (qs.latest_wake_status = ANY (ARRAY['queued'::text, 'claimed'::text, 'running'::text])) AND qs.latest_wake_error IS NOT NULL AND COALESCE(qs.latest_wake_attempts, 0) > 0 THEN qs.latest_wake_error
            ELSE NULL::text
        END AS current_retry_error,
    qs.latest_wake_attempts AS current_wake_attempts,
        CASE
            WHEN qs.latest_wake_status = 'failed'::text THEN 'failed'::text
            WHEN qs.latest_wake_status = 'cancelled'::text THEN 'cancelled'::text
            WHEN (qs.latest_wake_status = ANY (ARRAY['queued'::text, 'claimed'::text, 'running'::text])) AND qs.latest_wake_error IS NOT NULL AND COALESCE(qs.latest_wake_attempts, 0) > 0 THEN 'retrying'::text
            WHEN qs.latest_wake_status = 'queued'::text THEN 'queued'::text
            WHEN qs.latest_wake_status = ANY (ARRAY['claimed'::text, 'running'::text]) THEN 'running'::text
            WHEN qs.latest_wake_status = 'completed'::text THEN 'healthy'::text
            WHEN qs.latest_wake_status IS NULL THEN 'idle'::text
            ELSE qs.latest_wake_status
        END AS current_execution_health,
    qs.latest_cancel_reason AS latest_historical_disposition_reason,
    qs.latest_cancel_at AS latest_historical_disposition_at
   FROM agent_lab.agents a
     LEFT JOIN agent_lab.state s ON s.agent_id = a.agent_id
     LEFT JOIN LATERAL ( SELECT l.created_at,
            l.event_type,
            l.selected_action,
            l.stated_reason,
            l.resource_cost
           FROM agent_lab.activity_log l
          WHERE l.agent_id = a.agent_id
          ORDER BY l.created_at DESC
         LIMIT 1) la ON true
     LEFT JOIN LATERAL ( SELECT min(wi.wake_at) FILTER (WHERE wi.wake_kind = 'time'::text) AS next_time_wake_at,
            jsonb_agg(jsonb_build_object('wake_kind', wi.wake_kind, 'trigger_type', wi.trigger_type, 'reason', wi.reason, 'priority', wi.priority) ORDER BY wi.priority DESC, wi.created_at) FILTER (WHERE wi.wake_kind = ANY (ARRAY['event'::text, 'condition'::text])) AS active_event_triggers
           FROM agent_lab.wake_intents wi
          WHERE wi.agent_id = a.agent_id AND wi.status = 'active'::text) nw ON true
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE q.status = ANY (ARRAY['queued'::text, 'claimed'::text, 'running'::text])) AS pending_wakes,
            min(q.due_at) FILTER (WHERE q.status = ANY (ARRAY['queued'::text, 'claimed'::text, 'running'::text])) AS next_queued_due_at,
            latest.status AS latest_wake_status,
            latest.last_error AS latest_wake_error,
            latest.attempts AS latest_wake_attempts,
            failed.last_error AS latest_failed_error,
            failed.failure_at AS latest_failed_at,
            cancelled.last_error AS latest_cancel_reason,
            cancelled.cancelled_at AS latest_cancel_at
           FROM agent_lab.wake_queue q
             LEFT JOIN LATERAL ( SELECT ql.status,
                    ql.last_error,
                    ql.attempts
                   FROM agent_lab.wake_queue ql
                  WHERE ql.agent_id = a.agent_id
                  ORDER BY ql.created_at DESC, ql.wake_request_id DESC
                 LIMIT 1) latest ON true
             LEFT JOIN LATERAL ( SELECT qf.last_error,
                    COALESCE(qf.completed_at, qf.started_at, qf.created_at) AS failure_at
                   FROM agent_lab.wake_queue qf
                  WHERE qf.agent_id = a.agent_id AND qf.status = 'failed'::text AND qf.last_error IS NOT NULL
                  ORDER BY qf.created_at DESC, qf.wake_request_id DESC
                 LIMIT 1) failed ON true
             LEFT JOIN LATERAL ( SELECT qc.last_error,
                    COALESCE(qc.completed_at, qc.started_at, qc.created_at) AS cancelled_at
                   FROM agent_lab.wake_queue qc
                  WHERE qc.agent_id = a.agent_id AND qc.status = 'cancelled'::text AND qc.last_error IS NOT NULL
                  ORDER BY qc.created_at DESC, qc.wake_request_id DESC
                 LIMIT 1) cancelled ON true
          WHERE q.agent_id = a.agent_id
          GROUP BY latest.status, latest.last_error, latest.attempts, failed.last_error, failed.failure_at, cancelled.last_error, cancelled.cancelled_at) qs ON true
     LEFT JOIN LATERAL ( SELECT jsonb_object_agg(ra.resource_type, jsonb_build_object('balance', ra.balance, 'reserved', ra.reserved_balance, 'target_reserve', ra.target_reserve, 'reference_balance', ra.reference_balance, 'replenishable', ra.replenishable, 'earning_enabled', ra.earning_enabled)) AS resources
           FROM agent_lab.resource_accounts ra
          WHERE ra.agent_id = a.agent_id) res ON true
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE d.status = 'pending'::text) AS pending_stimuli,
            max(d.relevance_score) FILTER (WHERE d.status = 'pending'::text) AS top_stimulus_score
           FROM agent_lab.agent_stimulus_deliveries d
          WHERE d.agent_id = a.agent_id) stim ON true
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE m.recipient_agent_id = a.agent_id AND m.read_at IS NULL) AS unread_messages,
            count(*) FILTER (WHERE m.sender_agent_id = a.agent_id) AS sent_messages,
            count(*) FILTER (WHERE m.recipient_agent_id = a.agent_id) AS received_messages
           FROM agent_lab.agent_messages m
          WHERE m.sender_agent_id = a.agent_id OR m.recipient_agent_id = a.agent_id) msg ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS active_goals
           FROM agent_lab.goals gg
          WHERE gg.agent_id = a.agent_id AND gg.status = 'active'::text) g ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS active_projects
           FROM agent_lab.projects pp
          WHERE pp.owner_agent_id = a.agent_id AND (pp.status = ANY (ARRAY['planned'::text, 'active'::text, 'paused'::text]))) p ON true
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE oa.status = 'open'::text) AS open_alerts,
                CASE max(
                    CASE oa.severity
                        WHEN 'critical'::text THEN 4
                        WHEN 'high'::text THEN 3
                        WHEN 'warning'::text THEN 2
                        WHEN 'info'::text THEN 1
                        ELSE 0
                    END) FILTER (WHERE oa.status = 'open'::text)
                    WHEN 4 THEN 'critical'::text
                    WHEN 3 THEN 'high'::text
                    WHEN 2 THEN 'warning'::text
                    WHEN 1 THEN 'info'::text
                    ELSE NULL::text
                END AS highest_alert_severity
           FROM agent_lab.operator_alerts oa
          WHERE oa.agent_id = a.agent_id) al ON true;
