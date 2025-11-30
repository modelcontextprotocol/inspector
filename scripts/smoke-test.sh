#!/bin/bash
set -e

echo "=== Running Smoke Tests ==="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Check if there's anything to build yet
HAS_CLIENT=false
HAS_SERVER=false

if [ -d "client" ] && [ -f "client/package.json" ]; then
    HAS_CLIENT=true
fi

if [ -d "proxy-server" ] && [ -f "proxy-server/package.json" ]; then
    HAS_SERVER=true
fi

if [ "$HAS_CLIENT" = false ] && [ "$HAS_SERVER" = false ]; then
    echo "No packages found yet - skipping smoke tests"
    echo "(This is expected for a new project)"
    exit 0
fi

# Build check
if [ "$HAS_CLIENT" = true ]; then
    echo "Building client..."
    cd client && npm run build --if-present && cd ..
fi

if [ "$HAS_SERVER" = true ]; then
    echo "Building proxy-server..."
    cd proxy-server && npm run build --if-present && cd ..
fi

# Start servers and run health checks (when implemented)
# TODO: Uncomment when dev servers are set up
# npm run dev &
# DEV_PID=$!
# sleep 5
# curl -f http://localhost:3000 || exit 1
# curl -f http://localhost:5173 || exit 1
# kill $DEV_PID

# Run Playwright smoke tests (when implemented)
# TODO: Uncomment when e2e tests exist
# if [ -d "tests/smoke" ]; then
#     npx playwright test tests/smoke/
# fi

echo "=== Smoke Tests Passed ==="
