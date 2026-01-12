import { useCallback, useState } from "react";
import { InspectorConfig } from "@/lib/configurationTypes";
import { getMCPProxyAddress, getMCPProxyAuthToken } from "@/utils/configUtils";

export function useWorkingDirValidation(
  workingDir: string,
  config: InspectorConfig,
) {
  const [workingDirError, setWorkingDirError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const validateNow = useCallback(async (): Promise<boolean> => {
    if (!workingDir) {
      setWorkingDirError(null);
      return true;
    }
    setIsValidating(true);
    try {
      const base = getMCPProxyAddress(config);
      const url = new URL(`${base}/validate/working-dir`);
      url.searchParams.set("path", workingDir);

      const { token, header } = getMCPProxyAuthToken(config);
      const resp = await fetch(url.toString(), {
        headers: token ? { [header]: `Bearer ${token}` } : undefined,
      });
      const data: { valid: boolean; error?: string } = await resp.json();
      setWorkingDirError(
        data.valid ? null : data.error || "Invalid working directory",
      );
      return !!data.valid;
    } catch {
      setWorkingDirError("Unable to validate working directory");
      return false;
    } finally {
      setIsValidating(false);
    }
  }, [config, workingDir]);

  const validateOnBlur = useCallback(async () => {
    await validateNow();
  }, [validateNow]);

  return {
    workingDirError,
    setWorkingDirError,
    validateOnBlur,
    validateNow,
    isValidating,
  } as const;
}
