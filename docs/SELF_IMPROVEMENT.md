# Bounded circuit improvement

1StopQuantum's recursive self-improvement feature optimizes a **submitted circuit
artifact**. It does not rewrite application code, prompts, evals, database schema,
or provider settings.

## Use case

A student may build a correct circuit that contains redundant operations, such as
`H, H` or `CNOT, CNOT`. They can schedule a review from the Improvement workspace,
select an objective, and set a bounded iteration count. PostgreSQL persists the
job and the local scheduler runs it when due.

## Plan, propose, review

Each iteration follows the same deterministic contract:

1. **Plan:** record the objective and before metrics.
2. **Propose:** apply the verified peephole simplifier to the current Circuit IR.
3. **Review:** compare pre-measurement statevectors up to global phase with a
   tolerance of `1e-9`.
4. **Score:** compare two-qubit gate count, then total unitary gates, then depth.
5. **Accept:** replace the current artifact only when equivalence passes and the
   score strictly decreases.
6. **Stop:** finish after no accepted change or the hard iteration limit.

The global maximum is eight iterations. Explorer, Scholar, and Lab plans further
cap runs at 2, 4, and 8 iterations.

## Evidence and storage

The job result stores original and improved IR, metrics, decision, iteration log,
and review method. `improvement_runs` records the database audit row. A standalone
HTML report is written under `artifacts/improvements/` and served from:

```text
GET /improvements/reports/{job_id}
```

The report remains reviewable even outside the app. It clearly marks `ACCEPTED`
or `UNCHANGED`, shows before/after IR, and records statevector equivalence.

## Current boundary

The current proposer is deterministic. A future LLM proposer may suggest broader
rewrites, but it must remain behind the same validation, equivalence, score, and
iteration gates. Real hardware equivalence and noisy-device optimization require
a separate review policy and are intentionally out of scope.
