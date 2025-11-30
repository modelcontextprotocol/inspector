#!/bin/bash
set -e

echo "=== Running Smoke Tests ==="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Check if Playwright browsers are installed
if ! npx playwright --version > /dev/null 2>&1; then
    echo "Installing Playwright browsers..."
    npx playwright install chromium
fi

# Check if there's a dev server to test
HAS_CLIENT=false
if [ -d "client" ] && [ -f "client/package.json" ]; then
    HAS_CLIENT=true
fi

if [ "$HAS_CLIENT" = false ]; then
    echo "No client package found - skipping browser smoke tests"
    echo "(This is expected until UI implementation begins)"
    echo ""
    echo "To run smoke tests later: npm run test:smoke"
    exit 0
fi

# Run smoke tests
echo "Running Playwright smoke tests..."
npm run test:smoke

echo "=== Smoke Tests Passed ==="
