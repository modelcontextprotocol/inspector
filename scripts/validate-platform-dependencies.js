/*
 * Validates `package-lock.json` contains resolution metadata
 * (resolved/integrity) for ALL optional platform-specific dependencies, not
 * just the current platform.
 *
 * WHY:
 *
 * npm < 11.3.0 has a bug (https://github.com/npm/cli/issues/4828) where
 * running `npm install` under specific conditions generates a lockfile that
 * includes optional dependencies but omits resolution metadata for
 * non-current platforms.
 *
 *   NOTE: npm 11.3.0+ (Apr 8, 2025) fixes this bug.
 *
 * BUG CONDITIONS:
 *
 *   - no `package-lock.json`
 *   - `node_modules` exists with packages for current platform
 *
 * When `npm install` runs in this state, it includes all platform-specific
 * optional dependencies, but only resolves them for the current platform.
 * Other platforms remain unresolved.
 *
 * This breaks cross-platform compatibility - when developers on different
 * OSes or CI systems run `npm install`, npm skips installing the unresolved
 * platform-specific dependencies for their platform.
 *
 * SCENARIOS:
 *
 *   - Changing package managers (e.g., yarn → npm use different lock files)
 *
 *   - Resolving complex `package-lock.json` merge conflicts by deleting and
 *     regenerating (generally better to fix conflicts on respective branches)
 *
 * USAGE:
 *
 *   `node scripts/validate-platform-dependencies.js`
 *
 * Exits with error if cross-platform resolution metadata cannot be found.
 *
 * Suggests fixes:
 *
 * 1. Upgrade to npm >= 11.3.0 and regenerate lockfile (preferred)
 * 2. Run with --add-missing to fetch from registry
 *
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execSync } from "node:child_process";

const LOCKFILE_NAME = "package-lock.json";

// ANSI color codes
const COLORS = {
  RED: "\x1b[31m",
  RESET: "\x1b[0m",
};

async function main() {
  const cwd = process.cwd();

  // Parse command line arguments
  const args = process.argv.slice(2);
  const addMissing = args.includes("--add-missing");

  // Parse --lockfile argument
  const lockfileArg = args.find((arg) => arg.startsWith("--lockfile="));
  const lockPath = lockfileArg
    ? path.resolve(cwd, lockfileArg.split("=")[1])
    : path.resolve(cwd, LOCKFILE_NAME);

  if (!fs.existsSync(lockPath)) {
    console.error(`❌ No lockfile found at ${lockPath}`);
    process.exit(1);
  }

  const lockfile = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const packages = lockfile.packages || {};

  // 1. Build the Dependency Graph & Index Resolved Names
  const resolvedNames = new Set();
  const parentMap = new Map();

  Object.entries(packages).forEach(([pkgPath, entry]) => {
    // 1a. Index names
    if (pkgPath !== "") {
      const name = getPackageNameFromPath(pkgPath);
      if (name) resolvedNames.add(name);
    }

    // 1b. Build Parent Map (Who depends on me?)
    // Must include all dependency types to ensure we can trace the graph
    const allDeps = {
      ...entry.dependencies,
      ...entry.devDependencies,
      ...entry.peerDependencies,
      ...entry.optionalDependencies,
    };

    Object.keys(allDeps).forEach((depName) => {
      // Basic hoisting resolution logic
      let childPath = `node_modules/${depName}`;

      // Check for nested resolution (shadowing)
      const nestedPath = `${pkgPath}/node_modules/${depName}`;
      if (packages[nestedPath]) {
        childPath = nestedPath;
      }

      if (!parentMap.has(childPath)) {
        parentMap.set(childPath, new Set());
      }
      parentMap.get(childPath).add(pkgPath);
    });
  });

  // 2. Identify Broken Packages
  const brokenPackages = new Set();

  Object.entries(packages).forEach(([pkgPath, entry]) => {
    if (!entry.optionalDependencies) return;

    Object.keys(entry.optionalDependencies).forEach((depName) => {
      if (!resolvedNames.has(depName)) {
        brokenPackages.add(pkgPath);
      }
    });
  });

  // 3. Trace back to Workspace Roots (The Fix)
  const fixes = new Map();

  brokenPackages.forEach((brokenPath) => {
    const rootOwner = traceToWorkspace(brokenPath, parentMap);

    if (rootOwner) {
      const { workspace, directDependency } = rootOwner;

      if (!fixes.has(workspace)) {
        fixes.set(workspace, new Map());
      }

      // We reinstall the DIRECT DEPENDENCY (e.g. vite), not the broken child (esbuild)
      const depEntry = packages[directDependency];
      const name = getPackageNameFromPath(directDependency);

      if (name && depEntry && depEntry.version) {
        fixes.get(workspace).set(name, depEntry.version);
      }
    }
  });

  // 4. Report or fix missing platform dependencies
  if (fixes.size === 0) {
    console.log("✅ All platform-specific dependencies are properly resolved.");
    return;
  }

  console.log(`${COLORS.RED}%s${COLORS.RESET}\n`, "⚠️  MISSING PACKAGES");
  console.log(
    "Resolution metadata is missing for cross-platform optional dependencies.\n",
  );

  // Find all missing optional dependencies
  const missingPackages = new Map(); // packageName@version -> [parent paths]

  brokenPackages.forEach((brokenPath) => {
    const entry = packages[brokenPath];
    if (!entry.optionalDependencies) return;

    Object.keys(entry.optionalDependencies).forEach((depName) => {
      if (!resolvedNames.has(depName)) {
        const version = entry.optionalDependencies[depName];
        const key = `${depName}@${version}`;

        if (!missingPackages.has(key)) {
          missingPackages.set(key, []);
        }
        missingPackages.get(key).push(brokenPath);
      }
    });
  });

  console.log(`${missingPackages.size} missing package(s):\n`);

  // Show which top-level packages depend on the broken ones
  console.log("📦 Top-level dependencies requiring these packages:\n");

  // Check if there are workspaces (more than just root, or any non-root workspace)
  const hasWorkspaces = fixes.size > 1 || (fixes.size === 1 && !fixes.has(""));

  for (const [wsPath, pkgMap] of fixes.entries()) {
    const pkgs = Array.from(pkgMap.entries())
      .map(([name, ver]) => `${name}@${ver}`)
      .join(", ");

    if (hasWorkspaces) {
      const wsName = wsPath === "" ? "root" : wsPath;
      console.log(`  [${wsName}]: ${pkgs}`);
    } else {
      // No workspaces - just list packages without [root] prefix
      console.log(`  ${pkgs}`);
    }
  }

  // Group by package family for cleaner output
  console.log("\n🔍 Missing packages by family:\n");
  const packageFamilies = new Map();
  for (const pkgSpec of missingPackages.keys()) {
    const [name] =
      pkgSpec.split("@").filter(Boolean).length === 2
        ? pkgSpec.match(/^(@?[^@]+)@(.+)$/).slice(1)
        : [pkgSpec, ""];
    const family = name.split("/")[0];
    if (!packageFamilies.has(family)) {
      packageFamilies.set(family, []);
    }
    packageFamilies.get(family).push(pkgSpec);
  }

  for (const [family, packages] of packageFamilies.entries()) {
    console.log(`  ${family}:`);
    packages.forEach((pkg) => console.log(`    - ${pkg}`));
    console.log("");
  }

  if (!addMissing) {
    // Report mode - just show what's missing and how to fix
    console.log("\n📋 Actions you can take:\n");
    console.log(
      "  1. Run this script with `--add-missing` to automatically fetch and add entries:\n",
    );
    console.log(
      "     `node validate-platform-dependencies.js --add-missing`\n\n",
    );
    console.log(
      "  2. Upgrade to npm >= 11.3.0 which has a fix for this issue, and regenerate the lockfile\n",
    );
    process.exit(1);
  }

  // Add missing mode - fetch from registry and add to lockfile
  console.log("\n🔧 Fetching missing packages from npm registry...\n");

  let addedCount = 0;

  for (const [pkgSpec, parents] of missingPackages.entries()) {
    const [name, version] =
      pkgSpec.split("@").filter(Boolean).length === 2
        ? pkgSpec.match(/^(@?[^@]+)@(.+)$/).slice(1)
        : [pkgSpec, ""];

    console.log(`  Fetching ${name}@${version}...`);

    try {
      // Fetch package metadata from npm registry
      const url = `https://registry.npmjs.org/${name}/${version}`;
      const response = await fetch(url);

      if (!response.ok) {
        console.error(
          `    ❌ Failed to fetch: ${response.status} ${response.statusText}`,
        );
        continue;
      }

      const data = await response.json();

      // Construct lockfile entry
      const pkgPath = `node_modules/${name}`;

      packages[pkgPath] = {
        version: data.version,
        resolved: data.dist.tarball,
        integrity: data.dist.integrity,
        cpu: data.cpu || undefined,
        license: data.license || undefined,
        optional: true,
        os: data.os || undefined,
        engines: data.engines || undefined,
      };

      // Clean up undefined fields
      Object.keys(packages[pkgPath]).forEach((key) => {
        if (packages[pkgPath][key] === undefined) {
          delete packages[pkgPath][key];
        }
      });

      console.log(`    ✓ Added ${pkgPath}`);
      addedCount++;
    } catch (error) {
      console.error(`    ❌ Error fetching ${name}@${version}:`, error.message);
    }
  }

  if (addedCount > 0) {
    // Write updated lockfile
    console.log(
      `\n💾 Writing updated lockfile with ${addedCount} new entries...`,
    );
    fs.writeFileSync(
      lockPath,
      JSON.stringify(lockfile, null, 2) + "\n",
      "utf8",
    );
    console.log("\n✅ Done! Verify with: git diff package-lock.json");
    console.log(
      "Expected: new platform entries added without any version changes\n",
    );
  } else {
    console.error("\n❌ No packages were added. Check errors above.\n");
    process.exit(1);
  }
}

// --- Helpers ---

function getPackageNameFromPath(pkgPath) {
  // Fix: Use lastIndexOf to catch "node_modules/" at start of string or middle
  const index = pkgPath.lastIndexOf("node_modules/");
  if (index !== -1) {
    return pkgPath.substring(index + 13); // 13 is length of "node_modules/"
  }
  return pkgPath;
}

function traceToWorkspace(startPath, parentMap) {
  const queue = [{ path: startPath, child: startPath }];
  const visited = new Set();

  while (queue.length > 0) {
    const { path: current, child } = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    // If current path doesn't contain "node_modules", it's a workspace path (e.g. "client")
    // OR if it is the explicit root string ""
    const isWorkspace = !current.includes("node_modules") || current === "";

    if (isWorkspace) {
      return {
        workspace: current,
        directDependency: child,
      };
    }

    const parents = parentMap.get(current);
    if (parents) {
      for (const parent of parents) {
        // We track 'child' so we know which dependency connects to the workspace
        queue.push({ path: parent, child: current });
      }
    }
  }
  return null;
}

main();
