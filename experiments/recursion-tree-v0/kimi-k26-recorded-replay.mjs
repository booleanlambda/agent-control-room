// Lossless semantic replay of real Kimi K2.6 decisions and parent summaries,
// reduced from the successful 2026-10-16 GitHub Actions artifact 12048914961.
// Original 21 decisions exactly match the deterministic spine choices and known
// case classifications; the 10 original model-written summaries are below.
// No generated text is presented as a new live inference.
import {scriptedSynthesis} from './cognitive-integrity.mjs';
import {lightModelDouble} from './depth10-traversability.mjs';

export const SOURCE={
  model:'kimi-k2.6',thinking:'disabled',run:38908384102,artifact:12048914961,
  providerReportedTokens:9134,liveCalls:31,
  rootDigest:'ec166d8915f7f54e6825e38891ae43a54b4b2d8a280d21ca1aa09096741ba483',
};
const SUMMARIES=[
  'Combined coverage of 11 items across two slots: slot 0 has 1 budget item, slot 1 contributes 10 items spanning budget(2), provider(2), cognition(3), evidence(2), and scheduler(1).',
  'Slot 0 contributes 1 provider classification. Slot 1 contributes 9 classifications across budget (2), provider (1), cognition (3), evidence (2), and scheduler (1). Combined total of 10 classifications with no unknowns.',
  'Synthesized 9 items across cognition, budget, provider, evidence, and scheduler categories from two child slots.',
  'Synthesized 8 total classifications from two slots: slot 0 contributed 1 evidence item, slot 1 contributed 7 items spanning budget, provider, cognition, evidence, and scheduler categories. No unknown classifications.',
  'Slot 0 contributes 1 budget-only item; slot 1 contributes 6 items spanning budget, provider, cognition, evidence, and scheduler. Combined coverage of 7 items with cognition as the largest category.',
  'Synthesized 6 total classifications from two slots: slot 0 contributed 1 provider classification, slot 1 contributed 1 budget, 2 cognition, 1 evidence, and 1 scheduler classification. No unknown or duplicate categories across slots.',
  'Synthesis of 5 range items: 1 cognition from slot 0; 1 budget, 1 cognition, 1 evidence, 1 scheduler from slot 1. No unknown or provider classifications.',
  'Slot 0 contributes 1 scheduler classification; slot 1 contributes 3 classifications spanning budget, cognition, and evidence. Combined total of 4 classifications with no unknown entries.',
  'Combined 3 items: 1 evidence from slot 0, plus 1 budget and 1 cognition from slot 1.',
  'Synthesis of cognition and budget classifications at depth 9',
];
export const recordedKimiDecision=(node,limits)=>lightModelDouble(node,limits);
export function recordedKimiSynthesis(node,children){
  const base=scriptedSynthesis(node,children);
  if(!Number.isSafeInteger(node.depth)||node.depth<0||node.depth>9)
    throw Error('unrecorded_parent_depth');
  return {summary:SUMMARIES[node.depth],slots:[0,1],
    covered:base.covered,counts:base.counts};
}
