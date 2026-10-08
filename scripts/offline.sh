#!/usr/bin/env bash
# Offline page load (service worker) on a production build: the worker is registered only there.
# Builds, starts the app and the realtime server on spare ports, and runs e2e/offline.spec.ts.
# Usage: scripts/offline.sh            (PW_CHROMIUM=/path/to/chrome to pick the browser;
#                                       OFFLINE_PORT / OFFLINE_RT_PORT to pick the ports)
set -euo pipefail
cd "$(dirname "$0")/.."
WEB=${OFFLINE_PORT:-3428}
RT=${OFFLINE_RT_PORT:-1428}
# Throwaway values for this local run only; the test sign-in must be on at build time too.
export DEV_SIGN_IN=1 REALTIME_SECRET=${REALTIME_SECRET:-local-offline-test-only-not-a-secret}
if curl -sf "http://localhost:$WEB/login" >/dev/null; then echo "port $WEB is busy; set OFFLINE_PORT" >&2; exit 1; fi
NEXT_PUBLIC_REALTIME_URL=ws://localhost:$RT npx next build
# Own process group, so the whole server tree stops when the script ends.
set -m
REALTIME_PORT=$RT npx concurrently -k -n web,rt "next start -p $WEB" "tsx server/realtime.ts" &
SERVER=$!
set +m
trap 'kill -- -$SERVER 2>/dev/null || true' EXIT
for _ in $(seq 60); do curl -sf "http://localhost:$WEB/login" >/dev/null && break; sleep 1; done
E2E_PROD=1 E2E_PORT=$WEB E2E_RT_PORT=$RT npx playwright test e2e/offline.spec.ts --workers=1
