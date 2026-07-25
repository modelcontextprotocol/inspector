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
 * Drift guard for the MCP Apps UI advertisement (#1740). `MCP_APP_MIME_TYPE` is
 * hardcoded in core (ext-apps' constant lives on a `/server` subpath / an
 * extensionless re-export that doesn't resolve cleanly under NodeNext in the
 * browser build). A conforming server checks the client's advertised `mimeTypes`
 * before serving an App, so if the hardcoded string ever drifts from ext-apps'
 * real `RESOURCE_MIME_TYPE`, Apps silently stop working against strict servers.
 *
 * This runs in the node integration project, where importing the real ext-apps
 * value resolves — the one place the two can actually be compared.
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
    const map = buildClientExtensions({ enterpriseManaged: false });
    expect(map[UI_EXTENSION_KEY]).toEqual({ mimeTypes: [RESOURCE_MIME_TYPE] });
  });
});
