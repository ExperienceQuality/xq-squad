#!/usr/bin/env bash
# T8 two-process concurrent-delivery protocol fixture.
# Drives the session protocol across independent worker processes in a local
# consumer fixture — protocol behavior only, not real Devin compatibility.
set -euo pipefail
cd "$(dirname "$0")/.."
node tests/fixtures/concurrent-delivery-scenario.mjs
