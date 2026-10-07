#!/usr/bin/env bash
# Performance budget benchmark on a production build (development-mode React is several times slower).
# Builds with the seeding hook switched on, starts the app and the realtime server on spare ports,
# runs e2e/perf.spec.ts (10,000 items; PERF_ITEMS to change) and prints test-results/perf.json.
# Usage: scripts/perf.sh            (PW_CHROMIUM=/path/to/chrome to pick the browser)
set -euo pipefail
cd "$(dirname "$0")/.."
WEB=${PERF_PORT:-3418}
RT=${PERF_RT_PORT:-1418}
# Throwaway values for this local run only; the test sign-in must be on at build time too.
export DEV_SIGN_IN=1 REALTIME_SECRET=${REALTIME_SECRET:-local-benchmark-only-not-a-secret}
if curl -sf "http://localhost:$WEB/login" >/dev/null; then echo "port $WEB is busy; set PERF_PORT" >&2; exit 1; fi
NEXT_PUBLIC_PERF_HOOK=1 NEXT_PUBLIC_REALTIME_URL=ws://localhost:$RT npx next build
# Own process group, so the whole server tree stops when the script ends.
set -m
REALTIME_PORT=$RT npx concurrently -k -n web,rt "next start -p $WEB" "tsx server/realtime.ts" &
SERVER=$!
set +m
trap 'kill -- -$SERVER 2>/dev/null || true' EXIT
for _ in $(seq 60); do curl -sf "http://localhost:$WEB/login" >/dev/null && break; sleep 1; done
E2E_PORT=$WEB E2E_RT_PORT=$RT npx playwright test e2e/perf.spec.ts
cat test-results/perf.json
