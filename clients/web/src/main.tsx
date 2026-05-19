import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider, type CSSVariablesResolver } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./App.css";
import { theme } from "./theme/theme";
import App from "./App";

const resolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {},
  dark: {
    // Matches `.storybook/preview.tsx` so the dev app and the story preview
    // share the same dark-mode page background.
    "--mantine-color-body": "var(--mantine-color-dark-9)",
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider
      theme={theme}
      defaultColorScheme="auto"
      cssVariablesResolver={resolver}
    >
      <Notifications position="top-right" />
      <App />
    </MantineProvider>
  </StrictMode>,
);
