import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

type PackageInfo = {
  name: string;
  version: string;
  description: string;
};

function getPackageInfo(): PackageInfo {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const packageJsonPath = resolve(__dirname, "..", "..", "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

  return {
    name: packageJson.name,
    version: packageJson.version,
    description: packageJson.description,
  };
}

export const packageInfo: PackageInfo = getPackageInfo();
