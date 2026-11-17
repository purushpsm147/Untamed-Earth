#!/bin/bash
# Relaunch any evaluation configuration that is not running (resumable: finished seeds are skipped).
SP=/tmp/claude-0/-home-user-Untamed-Earth/86a1f3fb-40f1-5725-b28f-db92894a3eb6/scratchpad
run() { cfg=$1; dir=$2; seeds=$3; shift 3; pgrep -f "config $cfg " >/dev/null && return; (cd $dir && nohup node --import tsx benchmarks/open-boundary-eval.ts --config $cfg --seeds $seeds --outdir $SP/ob "$@" >> $SP/ob/run-$cfg.log 2>&1 &); echo "started $cfg"; }
run A $SP/wt-A 1-60
run B $SP/wt-B 1-60
run C $SP/wt-C 1-60
run D $SP/wt-D 1-60 --variant '{"open":true}'
run E $SP/wt-D 1-60 --variant '{"open":true,"inflow":false}'
run F $SP/wt-D 1-60 --variant '{"open":true,"fleeExit":false}'
