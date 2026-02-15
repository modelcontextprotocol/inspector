#!/usr/bin/env sh
# Run the inspector web app. Usage: npm run web [-- SERVER] or npm run web [-- --dev [SERVER]]
# SERVER defaults to "everything" if omitted. Pass --dev for Vite dev mode.
DEV=""
if [ "$1" = "--dev" ]; then
  shift
  DEV="--dev"
fi
SERVER="${1:-everything}"
exec node cli/build/cli.js --web --config mcp.json --server "$SERVER" $DEV
