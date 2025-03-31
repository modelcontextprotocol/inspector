/**
 * Cross-platform script to copy the built file to cli.js
 */
import { promises as fs } from "fs";
import path from "path";

const SOURCE_FILE = path.resolve("build/index.js");
const TARGET_FILE = path.resolve("cli.js");

async function copyFile() {
  try {
    await fs.copyFile(SOURCE_FILE, TARGET_FILE);
    console.log(`Successfully copied ${SOURCE_FILE} to ${TARGET_FILE}`);
  } catch (error) {
    console.error("Error copying file:", error);
    process.exit(1);
  }
}

copyFile();
