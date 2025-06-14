# Version Management Scripts

This directory contains scripts for managing version consistency across the monorepo.

## Scripts

### update-version.js

Updates the version across all package.json files in the monorepo and updates package-lock.json.

**Usage:**

```bash
npm run update-version <new-version>
# Example:
npm run update-version 0.14.3
```

This script will:

1. Update the version in all package.json files (root, client, server, cli)
2. Update workspace dependencies in the root package.json
3. Run `npm install` to update package-lock.json
4. Provide next steps for committing and tagging

### check-version-consistency.js

Checks that all packages have consistent versions and that package-lock.json is up to date.

**Usage:**

```bash
npm run check-version
```

This script checks:

1. All package.json files have the same version
2. Workspace dependencies in root package.json match the current version
3. package-lock.json version matches package.json
4. Workspace packages in package-lock.json have the correct versions

This check runs automatically in CI on every PR and push to main.

## CI Integration

The version consistency check is integrated into the GitHub Actions workflow (`.github/workflows/main.yml`) and will fail the build if:

- Package versions are inconsistent
- package-lock.json is out of sync

## Common Workflows

### Bumping version for a release:

```bash
# Update to new version
npm run update-version 0.15.0

# Verify everything is correct
npm run check-version

# Commit the changes
git add -A
git commit -m "chore: bump version to 0.15.0"

# Create a tag
git tag 0.15.0

# Push changes and tag
git push && git push --tags
```
