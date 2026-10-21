-- READ-ONLY SQL TEMPLATE for an authorized operator/export adapter.
-- No write, wake, credit, or model actions. Contains private Silas curriculum data:
-- keep the resulting JSON in a controlled location; never commit the payload.
-- Evaluate only in the authoritative Supabase source database.
--
-- Expected output matches replayPersistedSilasParent input:
--   records: 2 completed nodes with original result_artifact envelopes,
--   sourceManifest: exact result_hash and SHA256 of exported envelope bytes,
--   contract: explicit 12-month financial contract.
--
-- Note: independent receipt binding still requires checking the persisted
-- decision_payload against actual runtime verifier state. The experimental
-- adapter will refuse source data that cannot establish this.

WITH source_rows AS (
  SELECT node_path, status, result_hash, result_artifact::text AS result_artifact,
         decision_payload::jsonb AS decision_payload
  FROM agent_lab.cognition_requirement_nodes
  WHERE agent_id='f7e7a357-3c6b-4c18-8b12-0e5008b3ef82'::uuid
    AND assignment_key='req:ba9cb9d92627de141f8abbfdbe5594938654841b2d856274'
    AND node_path IN ('R.002.003.002.001','R.002.003.002.002')
),
pins AS (
  SELECT node_path, status, result_hash, result_artifact, decision_payload,
         encode(extensions.digest(convert_to(result_artifact,'UTF8'),'sha256'),'hex') AS envelope_sha256
  FROM source_rows
)
SELECT jsonb_build_object(
  'records',coalesce(jsonb_agg(jsonb_build_object(
    'node_path', node_path,
    'status', status,
    'result_hash', result_hash,
    'result_artifact', result_artifact,
    'decision_payload', decision_payload
  ) ORDER BY node_path),'[]'::jsonb),
  'sourceManifest',coalesce(jsonb_object_agg(
    node_path,jsonb_build_object(
      'result_hash',result_hash,
      'envelope_sha256',envelope_sha256
    )
  ),'{}'::jsonb),
  'contract',jsonb_build_object(
    'parentPath','R.002.003.002',
    'exercise_pack_ref','curriculum/qda601-exercise-packs-v0.1.json#QDA601-M10-U2',
    'openingCash',5200000
  )
) AS private_replay_snapshot
FROM pins;
