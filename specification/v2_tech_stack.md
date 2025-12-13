# Inspector V2 Tech Stack

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | V2 Tech Stack | [V2 UX](v2_ux.md)

## Table of Contents
  * [Web Client](#web-client)
      * [Language and Framework](#language-and-framework)
      * [Components and theme](#components-and-theme)
  * [Proxy Server](#proxy-server)
      * [Language and Runtime](#language-and-runtime)
      * [Transport Operation](#server)
      * [Logging](#logging)


## Web Client
### Language and Framework
* Typescript
* React

### Components and Theme
Let's choose a feature-rich component set with easy theming control
* -[ ] [Mantine](https://ui.mantine.dev/)
* -[ ] [Shadcdn](https://ui.shadcn.com/)

## Proxy Server
### Language and Runtime
* Typescript
* Node

### Transport Operation
Let's consider how to operate the server transports.
* -[x] [Hono](https://hono.dev/)
* -[ ] [Express](https://expressjs.com/)
* -[ ] Node:[http](https://nodejs.org/docs/v22.18.0/api/http.html)

#### Hono Rationale

Hono is selected based on community consensus (PR #945 discussion) for alignment with modern web standards and the TypeScript SDK v2 direction.

**Why Hono over Express:**

| Requirement | Hono | Express |
|-------------|------|---------|
| Bundle size | 12kb | ~1mb |
| Web Standards (Request/Response) | Yes - Native | No - Shimmed |
| TypeScript native | Yes | No - @types package |
| Tree-shakable | Yes - Fully | No |
| HTTP/2 support | Yes | No (SPDY dropped) |
| Built-in middleware | Yes - Body parsing, auth, etc. | No - Requires plugins |
| Edge/serverless deployment | Yes - Native | Partial - Requires adapters |

**Benefits:**

1. **Web Standards Alignment** - Uses native `Request`/`Response` objects, enabling deployment across Node, Deno, Bun, serverless, and edge environments
2. **TypeScript Native** - Full type safety without external type packages, no monkey-patching of request objects
3. **Future-proofing** - HTTP/2 support enables potential gRPC transport; aligns with TypeScript SDK v2 plans
4. **Developer Experience** - Simpler API, type-safe context, smaller learning curve
5. **Bundle Efficiency** - Dramatically smaller footprint benefits both development and deployment

### Logging
Let's step up our logging capability with an advanced logger:
* -[ ] [Winston](https://github.com/winstonjs/winston?tab=readme-ov-file#winston)
* -[x] [Pino](https://github.com/pinojs/pino?tab=readme-ov-file#pino)
* -[ ] [Morgan](https://github.com/expressjs/morgan?tab=readme-ov-file#morgan)
* -[ ] [Log4js](https://github.com/stritti/log4js?tab=readme-ov-file#log4js)
* -[ ] [Bunyan](https://github.com/trentm/node-bunyan)

#### Pino Rationale

Pino is selected for synergy with the **History Screen** feature. The log file serves dual purposes:
1. **Server diagnostics** - Standard application logging
2. **History persistence** - Request/response replay source

**Why Pino over Winston:**

| Requirement | Pino | Winston |
|-------------|------|---------|
| Default JSON format | Yes - NDJSON | No - Text (needs config) |
| Line-by-line parsing | Yes - Native | No - Extra work |
| High-throughput logging | Yes - Very fast | Partial - Slower |
| Log rotation | Yes - pino-roll | Yes - winston-daily-rotate |
| Dev-friendly output | Yes - pino-pretty | Yes - Built-in |

**Architecture:**

```
┌─────────────────────────────────────────────────────────────────┐
│                         Proxy Server                            │
│                                                                 │
│  MCP Request ──▶ Pino Logger ──┬──▶ history.ndjson (file)       │
│                                │                                │
│                                └──▶ Console (pino-pretty)       │
│                                                                 │
│  History API: GET /api/history?method=tools/call&limit=50       │
│  (parses history.ndjson, returns filtered JSON)                 │
└─────────────────────────────────────────────────────────────────┘
```

**Log Entry Schema:**

Each MCP operation logs a request/response pair:

```json
{"ts":1732987200000,"level":"info","type":"mcp_request","method":"tools/call","target":"echo","params":{"message":"hello"},"requestId":"abc123","serverId":"my-server"}
{"ts":1732987200045,"level":"info","type":"mcp_response","requestId":"abc123","result":{"content":[{"type":"text","text":"hello"}]},"duration":45,"success":true}
```

**Schema fields:**

| Field | Description |
|-------|-------------|
| `ts` | Unix timestamp (ms) |
| `level` | Log level (info, error) |
| `type` | `mcp_request` or `mcp_response` |
| `method` | MCP method (tools/call, resources/read, prompts/get, etc.) |
| `target` | Tool name, resource URI, or prompt name |
| `params` | Request parameters |
| `requestId` | Correlation ID linking request to response |
| `serverId` | Server identifier |
| `result` | Response data (for mcp_response) |
| `error` | Error message (for failed requests) |
| `duration` | Response time in ms |
| `success` | Boolean success indicator |

**Dependencies:**
- `pino` - Core logger
- `pino-pretty` - Dev console formatting
- `pino-roll` - Log rotation (optional)
- `pino-http` - Express integration
