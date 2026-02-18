# Inspector client TODO

NOTE: This document is maintained by a human developer. Agents should never update this document unless directed specifically to do so.

## Auth Issues

### Device Flow

If we can't bring up a browser endpoint for redirect (like if we're in a container or sandbox)

- Can we implement "device flow" (RFC 8628) and will IDPs support it generally?
- Device flow feature advertisement has issues (for example, GitHub doesn't show it in metadata, but supports it based on app setting)
- Device flow returns "devide_flow_disabed" error, as well as "access_denied", so maybe we just always try, and on those specific error we try the token mode

Implement and test device flow / device code to see if it's supported

- Hosted everything - https://example-server.modelcontextprotocol.io/mcp - not supported
- GitHub - https://api.githubcopilot.com/mcp
  - Device flow enabled in Github OAuth app, doesn't show in metadata (which isn't client specific)
  - Try it and see if it works (if it works, try it without client_secret to see if that works)
- Others if neither of those work?

## Auth Issues (note for v1.5/v2)

Found issues with auth servers (esp minimal/test servers) not supporting the registration of multiple callback URLs

- Consolidated quick/guided into one endpoint (embedded "mode" in oauth state token, use a single endpoint)

CORS issues (fixed by remoting auth fetch and transport via API)

- Found many CORS auth issues from browser
  - Must proxy auth fetch to node (see PR #1047 against v1)
- Found issue with CORS stripping mcp-session-id header
  - Certain http servers with auth only work via proxy

## TODO

### CIMD

- Publish a static document for inspector client info
  - client_id and client_uri must be at same domain
- We have a TUI command line param to set it (--client-metadata-url)
- Add --client-metadata-url param (and CIMD support) to web
- After we deploy our Inspector CIMD file, make it the default for --client-metadata-url (both apps)

Here are some sample CIMD files (for testing and as examples):

- MCPJam - https://www.mcpjam.com/.well-known/oauth/client-metadata.json
- VS Code - https://vscode.dev/oauth/client-metadata.json
- mcp-inspect: https://teamsparkai.github.io/mcp-inspect/.well-known/auth/client-metadata.json

### Auth flow logic

If we get auth server metadata, then we know definitively whether DCR or CIMD are supported

- We should not attempt unsupported mechanisms and report an appropriate error if no mechanisms are supported
  - For example, GitHub only supports preregisgtered static client - if we don't have client info and CIMD and DCR not supported, stop and error
  - This could be "no client_id provided and no other client identification mechanisms supported by server"
- If we don't get auth server metadata, we will fall back to trying default endpoints
  - It's highly unlikely that CIMD would be supported by an auth server without metadata
  - It's possible that DCR could be supported

### Container auth callback

If we are in a container:

- We can set the callback url via config (--callback-url) for creating the local server (binding / serving)
- We don't have a way to specify a different callback url for the protocol (for example, using a host address and/or mapped port)

## Auth testing

- Static client: https://api.githubcopilot.com/mcp (works, requires client_id AND client_secret)
- DCR: https://example-server.modelcontextprotocol.io/mcp (works)
- CIMD: https://stytch-as-demo.val.run/mcp (works - as long as client_id and client_uri use the same domain)

## v1.5 branch

Goal: Parity with v1 client

- MCP apps work (remaining)
  - Fix handler multiplexing in AppRendererClient
- Update README (client->web, proxy->sandbox)
- Review changes to Client from time of fork to present to make sure we didn't miss anything else

Goal: Bring Inspector Web support to current spec

- Add OAuth CIMD support (easy)
  - clientMetadataUrl config item
- URL elicitation (already in InspectorClient, just need UX)
- Add "sampling with tools" support
  - https://github.com/modelcontextprotocol/inspector/issues/932
- Review v1 project boards for any feature deficiencies

Goal: Inspector Web quality

- Run playwright tests on web app
- Review open v1 bugs (esp auth bugs) to see which ones still apply

Misc

- Research oauth device flow (esp for CLI/TUI)
- Extract form generator into core, extend as needed (I think there are some open issues)

### TUI

Close feature gap
Implement test strategy (vitest + Playwright?)
Better forms (test tool, etc)

- UX (cleaner, maybe ditch ink-forms, see if it can be styled better?)
- Functionality (data types, arrays, arrays of objects, etc)
