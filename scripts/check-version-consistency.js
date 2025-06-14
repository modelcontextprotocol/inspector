#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Checks version consistency across all package.json files in the monorepo
 * Exits with code 1 if versions are inconsistent
 * Usage: node scripts/check-version-consistency.js
 */

console.log("🔍 Checking version consistency across packages...\n");

// List of package.json files to check
const packagePaths = [
  "package.json",
  "client/package.json",
  "server/package.json",
  "cli/package.json",
];

const versions = new Map();
const errors = [];

// Read version from each package.json
packagePaths.forEach((packagePath) => {
  const fullPath = path.join(__dirname, "..", packagePath);

  if (!fs.existsSync(fullPath)) {
    console.warn(`⚠️  Skipping ${packagePath} - file not found`);
    return;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    const version = packageJson.version;
    const packageName = packageJson.name || packagePath;

    versions.set(packagePath, {
      name: packageName,
      version: version,
      dependencies: packageJson.dependencies || {},
    });

    console.log(`📦 ${packagePath}:`);
    console.log(`   Name: ${packageName}`);
    console.log(`   Version: ${version}`);
  } catch (error) {
    errors.push(`Failed to read ${packagePath}: ${error.message}`);
  }
});

if (errors.length > 0) {
  console.error("\n❌ Errors occurred while reading package files:");
  errors.forEach((error) => console.error(`   - ${error}`));
  process.exit(1);
}

// Check if all versions match
const allVersions = Array.from(versions.values()).map((v) => v.version);
const uniqueVersions = [...new Set(allVersions)];

console.log("\n📊 Version Summary:");
console.log(`   Total packages: ${versions.size}`);
console.log(`   Unique versions: ${uniqueVersions.length}`);

if (uniqueVersions.length > 1) {
  console.error("\n❌ Version mismatch detected!");
  console.error("   Found versions: " + uniqueVersions.join(", "));

  console.error("\n   Package versions:");
  versions.forEach((info, path) => {
    console.error(`   - ${path}: ${info.version}`);
  });
} else {
  console.log(`   ✅ All packages are at version: ${uniqueVersions[0]}`);
}

// Check workspace dependencies in root package.json
const rootPackage = versions.get("package.json");
if (rootPackage) {
  console.log("\n🔗 Checking workspace dependencies...");
  const expectedVersion = rootPackage.version;
  let dependencyErrors = false;

  Object.entries(rootPackage.dependencies).forEach(([dep, version]) => {
    if (dep.startsWith("@modelcontextprotocol/inspector-")) {
      const expectedDepVersion = `^${expectedVersion}`;
      if (version !== expectedDepVersion) {
        console.error(
          `   ❌ ${dep}: ${version} (expected ${expectedDepVersion})`,
        );
        dependencyErrors = true;
      } else {
        console.log(`   ✅ ${dep}: ${version}`);
      }
    }
  });

  if (dependencyErrors) {
    errors.push("Workspace dependency versions do not match package versions");
  }
}

// Check if package-lock.json is up to date
console.log("\n🔒 Checking package-lock.json...");
const lockPath = path.join(__dirname, "..", "package-lock.json");
let lockFileError = false;

if (!fs.existsSync(lockPath)) {
  console.error("   ❌ package-lock.json not found");
  lockFileError = true;
} else {
  try {
    const lockFile = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    const lockVersion = lockFile.version;
    const expectedVersion = rootPackage?.version || uniqueVersions[0];

    if (lockVersion !== expectedVersion) {
      console.error(
        `   ❌ package-lock.json version (${lockVersion}) does not match package.json version (${expectedVersion})`,
      );
      lockFileError = true;
    } else {
      console.log(`   ✅ package-lock.json version matches: ${lockVersion}`);
    }

    // Check workspace package versions in lock file
    if (lockFile.packages) {
      const workspacePackages = [
        { path: "client", name: "@modelcontextprotocol/inspector-client" },
        { path: "server", name: "@modelcontextprotocol/inspector-server" },
        { path: "cli", name: "@modelcontextprotocol/inspector-cli" },
      ];

      workspacePackages.forEach(({ path, name }) => {
        const lockPkgPath = lockFile.packages[path];
        if (lockPkgPath && lockPkgPath.version !== expectedVersion) {
          console.error(
            `   ❌ ${name} in lock file: ${lockPkgPath.version} (expected ${expectedVersion})`,
          );
          lockFileError = true;
        }
      });
    }
  } catch (error) {
    console.error(`   ❌ Failed to parse package-lock.json: ${error.message}`);
    lockFileError = true;
  }
}

// Final result
console.log("\n🎯 Result:");
if (uniqueVersions.length === 1 && errors.length === 0 && !lockFileError) {
  console.log("   ✅ Version consistency check passed!");
  process.exit(0);
} else {
  console.error("   ❌ Version consistency check failed!");
  if (uniqueVersions.length > 1) {
    console.error("   - Package versions are not consistent");
  }
  if (errors.length > 0) {
    console.error("   - " + errors.join("\n   - "));
  }
  if (lockFileError) {
    console.error("   - package-lock.json is out of sync");
  }
  console.error(
    '\n💡 Run "npm run update-version <new-version>" to fix version inconsistencies',
  );
  console.error('   or run "npm install" to update package-lock.json');
  process.exit(1);
}
