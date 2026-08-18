---
name: pmt-model-operations
description: Operate and review PMT probabilistic model artifacts, runtime rebuilds, evaluation evidence, provenance, and promotion gates. Use for model health, calibration, weekly updates, or a proposed model refresh.
version: 1.0.0
metadata:
  hermes:
    tags: [pmt, fantasy-football, models, probabilistic, calibration, provenance, safety]
    requires_toolsets: [mcp-pmt-read]
---

# PMT Model Operations

## When to Use

Use this skill for runtime model status, a weekly model update, evaluation or
calibration review, artifact provenance, or an explicit request to prepare a
model for promotion.

## Operating Contract

- Treat model artifacts and evaluation results as versioned data.
- Preserve training or observation cutoff, source versions, feature set,
  position, scoring period, model version, and degradation notes.
- Use PMT's model and rule tools for calculations, validation, calibration, and
  promotion decisions. Do not invent thresholds, weights, features, or
  acceptance criteria in the prompt.
- Never train on information after the prediction cutoff.
- Commentary explains model output after the model result; it is not a model
  feature or an override.

## Procedure

1. Call `mcp_pmt_read_pmt_get_model_status` for the league, season, position scope, and
   scoring period. Record active version, artifact status, last rebuild, and
   degraded dependencies.
2. Call `mcp_pmt_read_pmt_get_model_artifact` before changing or comparing an artifact. Check
   its approval state, data cutoff, provenance, feature list, source versions,
   and model version.
3. For a runtime update, obtain the approved projection and historical inputs
   through PMT, freeze the cutoff, then call `mcp_pmt_read_pmt_rebuild_models`. Preserve the
   returned model IDs, distributions, uncertainty, and errors.
4. When actual outcomes are available, call `mcp_pmt_read_pmt_evaluate_model` using PMT's
   rolling time-split and calibration procedure. Report accuracy, bias,
   interval coverage, uncertainty, sample coverage, and degraded cases exactly
   as returned.
5. Compare a candidate with the currently approved model on the same scope and
   holdout periods. Classify discrepancies as data, timing, matching, fallback,
   or model disagreement only when PMT supplies that classification or the
   evidence supports it.
6. Stop at a reviewable promotion recommendation. Call a promotion tool only
   after the user explicitly requests promotion and PMT confirms all required
   gates; otherwise leave the current approved model unchanged.

## Failure Handling

- Missing historical rows lower the evidence quality and must be recorded.
- Missing primary sources require the PMT-configured fallback and widened or
  otherwise degraded uncertainty as returned by PMT; do not manufacture a
  replacement value.
- A player-match collision excludes that row until resolved.
- A lower point error with unacceptable calibration is not enough to claim a
  safe promotion; defer to PMT's evaluation contract.

## Safety

- Do not mutate or overwrite an approved artifact from a conversational request
  without a separate PMT operation and explicit confirmation.
- Do not promote a model because its mean projection is higher or its narrative
  is more confident.
- Do not let news or source commentary rewrite means, variance, or model gates.
- Model refreshes are not platform actions, but their outputs may influence
  actions; keep provenance and approval state visible downstream.

## Verification

The result must identify the active and candidate versions, cutoff, source and
feature provenance, evaluation scope, calibration evidence, degraded cases, and
whether anything was rebuilt or promoted. If a promotion did not occur, say so.
