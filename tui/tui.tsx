#!/usr/bin/env node

import { Command } from "commander";
import { render } from "ink";
import App from "./src/App.js";

export async function runTui(args?: string[]): Promise<void> {
  const program = new Command();

  program
    .name("mcp-inspector-tui")
    .description("Terminal UI for MCP Inspector")
    .argument("<config-file.json>", "path to MCP servers config file")
    .option(
      "--client-id <id>",
      "OAuth client ID (static client) for HTTP servers",
    )
    .option(
      "--client-secret <secret>",
      "OAuth client secret (for confidential clients)",
    )
    .option(
      "--client-metadata-url <url>",
      "OAuth Client ID Metadata Document URL (CIMD) for HTTP servers",
    )
    .option(
      "--callback-url <url>",
      "OAuth redirect/callback listener URL (default: http://127.0.0.1:0/oauth/callback)",
    )
    .parse(args ?? process.argv);

  const configFile = program.args[0];
  const options = program.opts() as {
    clientId?: string;
    clientSecret?: string;
    clientMetadataUrl?: string;
    callbackUrl?: string;
  };

  if (!configFile) {
    program.error("Config file is required");
  }

  interface CallbackUrlConfig {
    hostname: string;
    port: number;
    pathname: string;
  }

  function parseCallbackUrl(raw?: string): CallbackUrlConfig {
    if (!raw) {
      return { hostname: "127.0.0.1", port: 0, pathname: "/oauth/callback" };
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch (err) {
      program.error(
        `Invalid callback URL: ${(err as Error)?.message ?? String(err)}`,
      );
      return { hostname: "127.0.0.1", port: 0, pathname: "/oauth/callback" };
    }
    if (url.protocol !== "http:") {
      program.error("Callback URL must use http scheme");
      return { hostname: "127.0.0.1", port: 0, pathname: "/oauth/callback" };
    }
    const hostname = url.hostname;
    if (!hostname) {
      program.error("Callback URL must include a hostname");
      return { hostname: "127.0.0.1", port: 0, pathname: "/oauth/callback" };
    }
    const pathname = url.pathname || "/";
    let port: number;
    if (url.port === "") {
      port = 80;
    } else {
      port = Number(url.port);
      if (
        !Number.isFinite(port) ||
        !Number.isInteger(port) ||
        port < 0 ||
        port > 65535
      ) {
        program.error("Callback URL port must be between 0 and 65535");
      }
    }
    return { hostname, port, pathname };
  }

  const callbackUrlConfig = parseCallbackUrl(options.callbackUrl);

  // Intercept stdout.write to filter out \x1b[3J (Erase Saved Lines)
  // This prevents Ink's clearTerminal from clearing scrollback on macOS Terminal
  // We can't access Ink's internal instance to prevent clearTerminal from being called,
  // so we filter the escape code instead
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = function (
    chunk: any,
    encoding?: any,
    cb?: any,
  ): boolean {
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
  const instance = render(
    <App
      configFile={configFile}
      clientId={options.clientId}
      clientSecret={options.clientSecret}
      clientMetadataUrl={options.clientMetadataUrl}
      callbackUrlConfig={callbackUrlConfig}
    />,
  );

  // Wait for exit, then switch back from alternate screen
  try {
    await instance.waitUntilExit();
    // Unmount has completed - clearTerminal was patched to not include \x1b[3J
    // Switch back from alternate screen
    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[?1049l");
    }
    process.exit(0);
  } catch (error: unknown) {
    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[?1049l");
    }
    console.error("Error:", error);
    process.exit(1);
  }
}

runTui();
