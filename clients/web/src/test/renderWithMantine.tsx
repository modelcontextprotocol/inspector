import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { theme } from "../theme/theme";

function MantineWrapper({ children }: { children: ReactNode }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="light">
      {children}
    </MantineProvider>
  );
}

export function renderWithMantine(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return render(ui, { wrapper: MantineWrapper, ...options });
}

export * from "@testing-library/react";
