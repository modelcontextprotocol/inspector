#!/bin/sh
# Only run if package-lock.json is being committed
if ! git diff --cached --name-only | grep -q "^package-lock.json$"; then
  exit 0
fi

# Check npm version
NPM_VERSION=$(npm --version)
NPM_MAJOR=$(echo "$NPM_VERSION" | cut -d. -f1)
NPM_MINOR=$(echo "$NPM_VERSION" | cut -d. -f2)

if [ "$NPM_MAJOR" -lt 11 ] || ([ "$NPM_MAJOR" -eq 11 ] && [ "$NPM_MINOR" -lt 3 ]); then
  echo ""
  echo "⚠️  You are using npm $NPM_VERSION"
  echo "npm >= 11.3.0 is recommended to avoid lockfile issues."
  echo "See: https://github.com/npm/cli/issues/4828"
  echo ""
fi

# Validate lockfile
node scripts/validate-platform-dependencies.js || {
  echo ""
  echo "❌ package-lock.json validation failed"
  echo "Run with --add-missing to fix, or upgrade to npm >= 11.3.0 and regenerate."
  exit 1
}
