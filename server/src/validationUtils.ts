import fs from "node:fs";
import path from "node:path";

export type WorkingDirValidationResult = {
  valid: boolean;
  error?: string;
};

export async function validateWorkingDirectoryAbsolute(
  directoryPath: string,
): Promise<WorkingDirValidationResult> {
  if (!directoryPath) {
    return { valid: false, error: "Missing path" };
  }
  if (!path.isAbsolute(directoryPath)) {
    return { valid: false, error: "Path must be absolute" };
  }
  try {
    const stat = await fs.promises.stat(directoryPath);
    if (!stat.isDirectory()) {
      return { valid: false, error: "Not a directory" };
    }
    await fs.promises.access(directoryPath, fs.constants.R_OK);
    return { valid: true };
  } catch {
    return {
      valid: false,
      error: "Directory does not exist or is not accessible",
    };
  }
}
