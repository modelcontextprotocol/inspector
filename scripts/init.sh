#!/bin/bash
set -e

echo "=== Inspector V2 Dev Environment Setup ==="

# Navigate to inspector root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Install dependencies (when packages exist)
if [ -d "client" ] && [ -f "client/package.json" ]; then
    echo "Installing client dependencies..."
    cd client && npm install && cd ..
fi

if [ -d "proxy-server" ] && [ -f "proxy-server/package.json" ]; then
    echo "Installing proxy-server dependencies..."
    cd proxy-server && npm install && cd ..
fi

# Run smoke test if available
if [ -f "scripts/smoke-test.sh" ]; then
    echo "Running smoke tests..."
    ./scripts/smoke-test.sh
fi

echo ""
echo "=== Session Checklist ==="
echo "1. Review claude-progress.md for context"
echo "2. Check v2-features.json for current status"
echo "3. Pick ONE feature to work on"
echo "4. Update feature status to in_progress"
echo ""
echo "=== Ready for development ==="
