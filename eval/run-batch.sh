#!/bin/bash
# Run one batch of seeds of one configuration in the checked-out frozen code (./code), one seed per core.
# Usage: run-batch.sh <config> "<seeds>" <variant-json> <spacing> <outdir>
set -euo pipefail
cfg=$1; seeds=$2; variant=$3; spacing=$4; out=$5
mkdir -p "$out"
cd code
args=(--days 365 --dt 2 --outdir "$out" --config "$cfg")
[ -n "$variant" ] && args+=(--variant "$variant")
[ "$spacing" != "0" ] && args+=(--spacing "$spacing")
printf '%s\n' $seeds | xargs -P "$(nproc)" -I{} sh -c 'node --import tsx benchmarks/open-boundary-eval.ts --seeds {}-{} "$@" > "'"$out"'/log-{}.txt" 2>&1 || echo "seed {} failed"' _ "${args[@]}"
ls "$out"
