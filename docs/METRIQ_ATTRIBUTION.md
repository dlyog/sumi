# Metriq Data Attribution

1StopQuantum includes a normalized snapshot of benchmark
results from [Metriq](https://metriq.info/), a collaborative project of the
Unitary Foundation and Metriq contributors. The source dataset is available at
[unitaryfoundation/metriq-data](https://github.com/unitaryfoundation/metriq-data)
under the [Creative Commons Attribution 4.0 International
license](https://creativecommons.org/licenses/by/4.0/).

## Changes Made

1StopQuantum reformats individual Metriq Gym JSON files into
`data/metriq/benchmark_snapshot.json`. The import extracts numeric metric
values, reported uncertainty, directionality, benchmark parameters, device
metadata, lifecycle notes, and source paths. It does not alter raw metric
values. Recommendations and forecasts are 1StopQuantum analyses, not Metriq,
vendor, or DARPA conclusions.

Regenerate the snapshot from a local checkout:

```bash
./.venv/bin/python scripts/import_metriq.py \
  --source ../../metriq-data \
  --output data/metriq/benchmark_snapshot.json
```

The snapshot records the source Git revision and each source-relative JSON path
so a displayed measurement can be audited against the original dataset.
