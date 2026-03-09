/**
 * Cross-platform script to make the launcher entrypoint executable
 */
import { promises as fs } from "fs";
import { platform } from "os";
import { execSync } from "child_process";
import path from "path";

const TARGET_FILE = path.resolve("build/index.js");

async function makeExecutable() {
  try {
    if (platform() !== "win32") {
      execSync(`chmod +x "${TARGET_FILE}"`);
      console.log("Made file executable with chmod");
    } else {
      await fs.access(TARGET_FILE);
      console.log("File exists and is accessible on Windows");
    }
  } catch (error) {
    console.error("Error making file executable:", error);
    process.exit(1);
  }
}

makeExecutable();
