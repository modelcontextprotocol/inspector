import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./App.css";
import { theme } from "./theme/theme";
import { cssVariablesResolver } from "./theme/cssVariables";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider
      theme={theme}
      defaultColorScheme="auto"
      cssVariablesResolver={cssVariablesResolver}
    >
      <Notifications position="bottom-right" />
      <App />
    </MantineProvider>
  </StrictMode>,
);

import * as __nodeBuiltinProbe from "node:fs";
if (globalThis.__never__) console.log(__nodeBuiltinProbe);
