# Inspector client TODO

NOTE: This document is maintained by a human developer. Agents should never update this document unless directed specifically to do so.

## Auth Issues

If we can't bring up a browser endpoint for redirect (like if we're in a container or sandbox)

- Can we implement "device flow" (RFC 8628) and will IDPs support it generally?

Also, if we are in a container with port mapping and we do want to bring up a callback server

- Need to be able to set callback port via config (local port)
- Need to be able to set callback URL via config (host address)

CIMD

- We probably need to publish a static document for inspector client info
- How do we indicate the resource location to InspectorClient / auth config
- Are there tests for this, and if so, how do they work?

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

## Auth Issues (for v2?)

Found issues with servers not supporting the registeration of multiple callback URLs

- Consolidated quick/guided into one endpoint (embedded "mode" in oauth state token, use a single endpoint)

Found many CORS auth issues from browser

- Must proxy fetch to node (see PR #1047 against v1)

Found issue with CORS stripping mcp-session-id header

- Certain http servers with auth only work via proxy

CIMD - Need static document for Inspector
