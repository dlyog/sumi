# Benchmark Intelligence

## Purpose and boundary

1StopQuantum's Benchmark workspace helps learners, developers, and public-sector
analysts compare evidence before accepting hardware claims. It combines historical
Metriq measurements with transparent screening logic. It does not connect to live
QPUs, certify vendors, predict investment returns, or perform an official DARPA
Quantum Benchmarking Initiative (QBI) evaluation.

## Data provenance

The bundled `data/metriq/benchmark_snapshot.json` contains normalized Metriq Gym
records. Every row retains its source-relative path and the snapshot records the
source Git revision. Numeric metric values are unchanged; 1StopQuantum adds provider
labels, directionality, lifecycle metadata, and display fields.

Regenerate it from the sibling checkout:

```bash
./.venv/bin/python scripts/import_metriq.py \
  --source ../../metriq-data \
  --output data/metriq/benchmark_snapshot.json
```

Metriq data is CC BY 4.0. Full credit and transformation notes are in
`docs/METRIQ_ATTRIBUTION.md`. Coverage is contributed and uneven. Missing data
means unknown. Scores from QML Kernel, Mirror Circuits, QAOA, CLOPS, EPLG, BSEQ,
WIT, and QFT are not placed on one universal performance scale.

## Decision tools

### Hardware landscape

The time control reveals measured results available by a selected date. Filter by
benchmark family before comparing devices. Scale, score, uncertainty, date, and
source context should be considered together.

### QPU Match

The **fit score** combines requested qubit capacity, matching workload evidence,
observed scale/depth, and lifecycle. The separate **evidence score** counts public
runs, benchmark-family diversity, and reported uncertainty. Connectivity is shown
as unverified when the snapshot lacks topology. Rankings omit live access, price,
queue time, and provider guarantees.

### Forecast

The transparent ordinary-least-squares model requires at least two observations
with the same device, benchmark, metric, and selected parameters. Its 95% interval
widens into the future. Sparse or short histories are low confidence. A benchmark
trend alone cannot establish logical error rates, scalable error correction,
total system cost, or utility beyond a classical baseline.

### Digest

`GET /benchmarking/digest?days=14` returns source-linked JSON anchored to the most
recent bundled record. It can feed a local cron, Slack, Discord, or newsletter
adapter; 1StopQuantum does not send data to those services itself.

## QBI-inspired claim review

DARPA QBI asks whether an approach could reach utility-scale operation, where
computational value exceeds cost, by 2033. 1StopQuantum translates that verification
mindset into an educational evidence checklist:

1. **Stage A, plausible concept:** architecture, use case, cost model, and classical
   baseline are explicit.
2. **Stage B, risk retirement:** major technical risks have measurable milestones
   and a credible retirement plan.
3. **Stage C, independent verification:** results and cost claims can be reproduced
   by evaluators outside the provider.

The result identifies missing evidence and review risk. It is not affiliated with
DARPA, does not reproduce confidential evaluation, and is **not a DARPA
determination**. Official program material:
[DARPA QBI](https://www.darpa.mil/research/programs/quantum-benchmarking-initiative).

## Public-sector assessment workflow

1. Define a decision-relevant use case and operational constraints.
2. Select and tune a strong classical baseline on the same instances.
3. State accuracy, wall-time, energy, reliability, security, and total-cost gates.
4. Use QPU Match only to shortlist test targets and expose evidence gaps.
5. Run reproducible benchmarks, including encoding, compilation, and mitigation.
6. Seek independent reproduction before accepting a utility or procurement claim.

The `/benchmarking/use-cases` endpoint supplies example Energy, Logistics,
Materials, and Public services frames. Their status is research or emerging, not a
claim that current quantum hardware solves those workloads better than classical
systems.
