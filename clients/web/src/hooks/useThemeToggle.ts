import { useCallback } from "react";
import { useComputedColorScheme, useMantineColorScheme } from "@mantine/core";

/**
 * Light/dark toggle for the view header.
 *
 * Reads `useComputedColorScheme` rather than the stored preference, so "auto"
 * resolves to the scheme the user is actually looking at — which is what makes
 * a single toggle button flip the right way under the system default.
 */
export function useThemeToggle(): { onToggleTheme: () => void } {
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("light");
  const isDark = computedColorScheme === "dark";
  const onToggleTheme = useCallback(() => {
    setColorScheme(isDark ? "light" : "dark");
  }, [isDark, setColorScheme]);
  return { onToggleTheme };
}
