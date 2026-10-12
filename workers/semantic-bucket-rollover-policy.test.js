import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEMANTIC_BUCKET_DISPOSITION as ACTION,
  classifySemanticBucketRollover,
} from './semantic-bucket-rollover-policy.js';

test('only confirmed rollover or supersession may continue cognition', () => {
  for (const status of ['renewed', 'superseded'])
    assert.equal(classifySemanticBucketRollover({status}), ACTION.CONTINUE);
});

test('exhausted rollover cap is an explicit budget hold, not a renewed epoch', () => {
  for (const reason of [
    'automatic_rollover_limit_exhausted',
    'no_material_progress_in_epoch',
    'finalization_completed_checkpoint_required',
    'runtime_not_active',
  ]) assert.equal(
    classifySemanticBucketRollover({status:'denied',reason}),
    ACTION.BUDGET_HOLD
  );
});

test('stale or missing wake must not mutate an active lifecycle', () => {
  for (const status of ['not_running','not_found'])
    assert.equal(classifySemanticBucketRollover({status}), ACTION.STALE_WAKE);
});

test('unknown, malformed and transport-error responses fail closed', () => {
  for (const result of [undefined, null, {}, [], 'renewed',
    {status:'unknown'}, {status:'PENDING'}, {status:0}]) {
    assert.equal(classifySemanticBucketRollover(result), ACTION.FAULT_HOLD);
  }
});

test('classifier never changes its input or fabricates a new epoch', () => {
  const response=Object.freeze({status:'denied', reason:'automatic_rollover_limit_exhausted',epoch_no:13});
  assert.equal(classifySemanticBucketRollover(response),ACTION.BUDGET_HOLD);
  assert.equal(response.epoch_no,13);
});
