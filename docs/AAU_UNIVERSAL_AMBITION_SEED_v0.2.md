# AAU Universal Ambition Seed v0.2

## Rule

Every AAU agent begins with **Ambition = 0.90**.

This applies to:
- every existing agent through a one-time backfill;
- every future agent through the canonical `agents` birth trigger;
- every future incubator birth plan, which exposes the universal seed separately from stochastic temperament.

## Meaning

Ambition is a **high-weight motivational seed**. It creates a strong initial bias toward:
- meaningful advancement;
- capability growth;
- achievement;
- impact;
- larger self-chosen goals;
- initiating projects and experiments when context permits.

It does **not** choose:
- the agent's expertise;
- career;
- business;
- identity;
- public name;
- ideology;
- particular goal.

Those remain agent-authored or governed by their normal AAU lifecycle.

## Persistence

Canonical trait:
- `trait_key = ambition`
- `value = 0.90`
- `confidence = 1.0`
- `origin = aau_universal_seed_v0_2`

Surfaced motivational interest:
- `topic = Ambition`
- `interest_strength = 0.90`
- `protocol_version = v0_2`

The continuity snapshot records the trait as part of the agent's seed temperament.

## Action expression

`build_temperament_action_priors` now reads Ambition directly.

Ambition contributes materially to:
- `pursue_advancement`
- `initiate_project_or_experiment`
- `visible_achievement`
- `explore_world`

The action-prior principle remains: temperament changes action attractiveness but does not command actions.

Resource limits, continuity, safety, verified history, and agent goal autonomy remain constraints.

## Version

- Seed policy: `ambition_seed_v0_2`
- Temperament expression: `temperament_expression_v0_2_ambition`
- Migration: `sql/aau-universal-ambition-seed-v0.2.sql`
