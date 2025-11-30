#!/bin/bash
# Sync v2-features.json from GitHub issues
# Run this at session start to get current issue state

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "Fetching V2 issues from upstream..."

# Query all v2-labeled issues and format as JSON
gh issue list -R modelcontextprotocol/inspector -l v2 --state all --json number,title,state,labels,url --limit 100 > /tmp/v2-issues.json

# Generate the cache file
cat > v2-features.json << 'HEADER'
{
  "generated": "TIMESTAMP",
  "source": "gh issue list -R modelcontextprotocol/inspector -l v2",
  "projectBoard": "https://github.com/orgs/modelcontextprotocol/projects/28/views/1",
  "issues":
HEADER

# Replace timestamp and append issues
sed -i "s/TIMESTAMP/$(date -Iseconds)/" v2-features.json
cat /tmp/v2-issues.json >> v2-features.json
echo "}" >> v2-features.json

# Format nicely
if command -v jq &> /dev/null; then
    jq '.' v2-features.json > /tmp/formatted.json && mv /tmp/formatted.json v2-features.json
fi

echo "Updated v2-features.json with $(jq '.issues | length' v2-features.json) issues"
echo ""
echo "Open issues:"
gh issue list -R modelcontextprotocol/inspector -l v2 --state open
