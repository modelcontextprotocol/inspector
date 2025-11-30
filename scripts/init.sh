#!/bin/bash
set -e

echo "=== Inspector V2 Dev Environment Setup ==="

# Navigate to inspector root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Sync issues from GitHub (generates v2-features.json)
echo "Syncing V2 issues from GitHub..."
./scripts/sync-issues.sh

# Install dependencies (when packages exist)
if [ -d "client" ] && [ -f "client/package.json" ]; then
    echo "Installing client dependencies..."
    cd client && npm install && cd ..
fi

if [ -d "proxy-server" ] && [ -f "proxy-server/package.json" ]; then
    echo "Installing proxy-server dependencies..."
    cd proxy-server && npm install && cd ..
fi

# Install root dependencies (includes Playwright)
if [ ! -d "node_modules" ]; then
    echo "Installing root dependencies..."
    npm install
fi

# Run smoke test if available
if [ -f "scripts/smoke-test.sh" ]; then
    echo "Running smoke tests..."
    ./scripts/smoke-test.sh
fi

echo ""
echo "=== Session Checklist ==="
echo "1. Review claude-progress.md for context"
echo "2. Check open issues: gh issue list -R modelcontextprotocol/inspector -l v2"
echo "3. Pick ONE issue to work on"
echo "4. Project board: https://github.com/orgs/modelcontextprotocol/projects/28/views/1"
echo ""
echo "=== Ready for development ==="
