# Inspector client TODO

NOTE: This document is maintained by a human developer. Agents should never update this document unless directed specifically to do so.

## Auth Issues

If we can't bring up a browser endpoint for redirect (like if we're in a container or sandbox)

- Can we implement "device flow" (RFC 8628) and will IDPs support it generally?
- Device flow feature advertisement has issues (for example, GitHub doesn't show it in metadata, but supports it based on app setting)
- Device flow returns "devide_flow_disabed" error, as well as "access_denied", so maybe we just always try, and on those specific error we try the token mode

Also, if we are in a container with port mapping and we do want to bring up a callback server

- Need to be able to set callback port via config (local port)
- Need to be able to set callback URL via config (host address)

CIMD

- We probably need to publish a static document for inspector client info
- How do we indicate the resource location to InspectorClient / auth config
- Are there tests for this, and if so, how do they work?

If we get auths server metadata, then we know definitively whether DCR or CIMD are supported

- We should not attempted unsupported mechanisms and report an appropriate error
- This could be "no client_id provided and no other client identification mechanisms supported by server"

Here is the MCPJam CIMD: https://www.mcpjam.com/.well-known/oauth/client-metadata.json

mcp-inspect: https://teamsparkai.github.io/mcp-inspect/.well-known/auth/client-metadata.json

We need a way in the TUI to config static client, CIMD, maybe whether to try DCR at all?

Inspector v1 Supports

- Auth
  - Custom headers (list of headers with name/value, can be individually turned on/off)
  - Client ID
  - Client Secret
  - Redirect URL (default to self server + /oauth/callback)
  - Scopes (space separated list)
- Configuration
  - Request timeout (ms)
  - Reset timeout on progress (bool)
  - Maximum total timeout (ms)
  - Inspector proxy address
  - Proxy session token
  - Task TTL (ms)

Auth:

- Custom headers, Client ID, Client Secret, and Scopes are per-server config elements
- Client Metadata URL (CIMD), callback port and url are global config
  Configuration:
- All global config

## Auth Issues (for v2?)

Found issues with servers not supporting the registeration of multiple callback URLs

- Consolidated quick/guided into one endpoint (embedded "mode" in oauth state token, use a single endpoint)

Found many CORS auth issues from browser

- Must proxy fetch to node (see PR #1047 against v1)

Found issue with CORS stripping mcp-session-id header

- Certain http servers with auth only work via proxy

CIMD - Need static document for Inspector

## TODO

clientMetadataUrl

- Harcoded to mcp-inspect CIMD
- Make one for this repo
- Possibly add config/override to TUI config UX

Create CIMD file and test in TUI

- Figure out how to verify it's using CIMD

Implement and test device flow / device code to see if it's supported

- Hosted everything - https://example-server.modelcontextprotocol.io/mcp - not supported
- GitHub - https://api.githubcopilot.com/mcp
  - Device flow enabled in Github OAuth app, doesn't show in metadata (which isn't client specific)
  - Try it and see if it works (if it works, try it without client_secret to see if that works)
- Others if neither of those work?

Testing

- Static client: Github
  - https://api.githubcopilot.com/mcp (works, requires client_id AND client_secret)
- DCR: hosted everything (works)
- CIMD: ???
