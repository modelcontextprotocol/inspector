#!/usr/bin/env node
import { jsx as _jsx } from "react/jsx-runtime";
import { render } from "ink";
import App from "./src/App.js";
export async function runTui() {
  const args = process.argv.slice(2);
  // TUI mode
  const configFile = args[0];
  if (!configFile) {
    console.error("Usage: mcp-inspector-tui <config-file.json>");
    process.exit(1);
  }
  // Intercept stdout.write to filter out \x1b[3J (Erase Saved Lines)
  // This prevents Ink's clearTerminal from clearing scrollback on macOS Terminal
  // We can't access Ink's internal instance to prevent clearTerminal from being called,
  // so we filter the escape code instead
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = function (chunk, encoding, cb) {
    if (typeof chunk === "string") {
      // Only process if the escape code is present (minimize overhead)
      if (chunk.includes("\x1b[3J")) {
        chunk = chunk.replace(/\x1b\[3J/g, "");
      }
    } else if (Buffer.isBuffer(chunk)) {
      // Only process if the escape code is present (minimize overhead)
      if (chunk.includes("\x1b[3J")) {
        let str = chunk.toString("utf8");
        str = str.replace(/\x1b\[3J/g, "");
        chunk = Buffer.from(str, "utf8");
      }
    }
    return originalWrite(chunk, encoding, cb);
  };
  // Enter alternate screen buffer before rendering
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[?1049h");
  }
  // Render the app
  const instance = render(_jsx(App, { configFile: configFile }));
  // Wait for exit, then switch back from alternate screen
  try {
    await instance.waitUntilExit();
    // Unmount has completed - clearTerminal was patched to not include \x1b[3J
    // Switch back from alternate screen
    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[?1049l");
    }
    process.exit(0);
  } catch (error) {
    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[?1049l");
    }
    console.error("Error:", error);
    process.exit(1);
  }
}
runTui();
