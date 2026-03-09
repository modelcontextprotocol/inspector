#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Updates version across all package.json files in the monorepo
 * Usage: node scripts/update-version.js <new-version>
 * Example: node scripts/update-version.js 0.14.2
 */

const newVersion = process.argv[2];

if (!newVersion) {
  console.error("❌ Please provide a version number");
  console.error("Usage: node scripts/update-version.js <new-version>");
  console.error("Example: node scripts/update-version.js 0.14.2");
  process.exit(1);
}

// Validate version format
const versionRegex = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
if (!versionRegex.test(newVersion)) {
  console.error(
    "❌ Invalid version format. Please use semantic versioning (e.g., 1.2.3 or 1.2.3-beta.1)",
  );
  process.exit(1);
}

console.log(`🔄 Updating all packages to version ${newVersion}...`);

// List of package.json files to update
const packagePaths = [
  "package.json",
  "clients/web/package.json",
  "core/package.json",
  "clients/cli/package.json",
  "clients/tui/package.json",
  "clients/launcher/package.json",
  "test-servers/package.json",
];

const updatedFiles = [];

// Update version in each package.json
packagePaths.forEach((packagePath) => {
  const fullPath = path.join(__dirname, "..", packagePath);

  if (!fs.existsSync(fullPath)) {
    console.warn(`⚠️  Skipping ${packagePath} - file not found`);
    return;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    const oldVersion = packageJson.version;
    packageJson.version = newVersion;

    // Update workspace dependencies in root package.json
    if (packagePath === "package.json" && packageJson.dependencies) {
      Object.keys(packageJson.dependencies).forEach((dep) => {
        if (dep.startsWith("@modelcontextprotocol/inspector-")) {
          packageJson.dependencies[dep] = `^${newVersion}`;
        }
      });
    }

    fs.writeFileSync(fullPath, JSON.stringify(packageJson, null, 2) + "\n");
    updatedFiles.push(packagePath);
    console.log(
      `✅ Updated ${packagePath} from ${oldVersion} to ${newVersion}`,
    );
  } catch (error) {
    console.error(`❌ Failed to update ${packagePath}:`, error.message);
    process.exit(1);
  }
});

console.log("\n📝 Summary:");
console.log(`Updated ${updatedFiles.length} files to version ${newVersion}`);

// Update package-lock.json
console.log("\n🔒 Updating package-lock.json...");
try {
  execSync("npm install", { stdio: "inherit" });
  console.log("✅ package-lock.json updated successfully");
} catch (error) {
  console.error("❌ Failed to update package-lock.json:", error.message);
  console.error('Please run "npm install" manually');
  process.exit(1);
}

console.log("\n✨ Version update complete!");
console.log("\nNext steps:");
console.log("1. Review the changes: git diff");
console.log(
  '2. Commit the changes: git add -A && git commit -m "chore: bump version to ' +
    newVersion +
    '"',
);
console.log("3. Create a git tag: git tag v" + newVersion);
console.log("4. Push changes and tag: git push && git push --tags");
