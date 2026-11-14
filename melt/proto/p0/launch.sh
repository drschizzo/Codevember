#!/bin/bash
# usage: launch.sh name Tinf F hold [extra args]
cd "$(dirname "$0")"
n=$1; shift; T=$1; shift; F=$1; shift; h=$1; shift
nohup node run.js --name=$n --Tinf=$T --F=$F --hold=$h "$@" > out/$n.stdout 2>&1 &
