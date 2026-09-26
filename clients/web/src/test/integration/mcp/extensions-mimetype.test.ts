import { describe, it, expect } from "vitest";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/app-bridge";
// EXTENSION_ID lives on ext-apps' `/server` subpath, which the browser build
// avoids importing — but this node integration test can, so it's the one place
// the hardcoded key can be checked against the real constant.
import { EXTENSION_ID } from "@modelcontextprotocol/ext-apps/server";
import {
  MCP_APP_MIME_TYPE,
  UI_EXTENSION_KEY,
  buildClientExtensions,
} from "@inspector/core/mcp/extensions.js";

/**
 * Drift guard for the MCP Apps UI advertisement (#1740). `UI_EXTENSION_KEY` is
 * hardcoded in core (ext-apps' `EXTENSION_ID` still lives only on the `/server`
 * subpath as of 2.0.0, which the browser build must not import). A conforming
 * server keys its Apps lookup on the extension id and checks the client's
 * advertised `mimeTypes` before serving an App, so a drifted string silently
 * stops Apps working against strict servers.
 *
 * `MCP_APP_MIME_TYPE` is no longer a copy — since ext-apps 2.0.0 core re-exports
 * `RESOURCE_MIME_TYPE` (#1745) — so its case here is a re-export check rather
 * than a drift check; it stays so the advertisement is asserted end to end.
 *
 * This runs in the node integration project, where importing the `/server`
 * value resolves — the one place the extension id can actually be compared.
 */
describe("MCP Apps UI extension constants (#1740)", () => {
  it("MCP_APP_MIME_TYPE matches ext-apps' RESOURCE_MIME_TYPE exactly", () => {
    expect(MCP_APP_MIME_TYPE).toBe(RESOURCE_MIME_TYPE);
  });

  it("UI_EXTENSION_KEY matches ext-apps' EXTENSION_ID exactly", () => {
    // A server keys its Apps lookup on the extension id, so a drifted key
    // silently disables Apps just like a drifted MIME type.
    expect(UI_EXTENSION_KEY).toBe(EXTENSION_ID);
  });

  it("is the value the client actually advertises for the ui extension", () => {
    const map = buildClientExtensions({
      enterpriseManaged: false,
      rendersApps: true,
    });
    expect(map[UI_EXTENSION_KEY]).toEqual({ mimeTypes: [RESOURCE_MIME_TYPE] });
  });
});
