# Inspector V2 Tech Stack

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | V2 Tech Stack
### UX: [Overview](v2_ux.md) | [Features](v2_ux_features.md) | [Handlers](v2_ux_handlers.md) | [Screenshots](v2_screenshots.md)

## Table of Contents
  * [Web Client](#web-client)
      * [Language and Framework](#language-and-framework)
      * [Components and theme](#components-and-theme)
  * [Server](#proxy-server)
      * [Language and Runtime](#language-and-runtime)
      * [Transport Operation](#server)
      * [Logging](#logging)


## Web Client
### Language and Framework
* Typescript
* React

### Components and Theme
* -[x] [Mantine](https://ui.mantine.dev/)
* -[ ] [Shadcn](https://ui.shadcn.com/)

#### Mantine Rationale

Mantine is recommended based on evaluation of both prototype implementations (`v2/prototype/shadcn` and `v2/prototype/mantine`) and group discussion.

**Notes from Prototype Comparison:**

Shadcn lacks layout components, requiring extensive Tailwind class management for containers, spacing, and alignment. This adds friction and cognitive load, based on our experiences with the current Inspector. Mantine's layout components (`Flex`, `Stack`, etc.) make the code more concise and easier to understand.

Although the code may be less directly customizable, we don't expect  extensive theming or branding to be a priority for Inspector as a debugging tool.

See [PR #980 discussion](https://github.com/modelcontextprotocol/inspector/pull/980#issuecomment-3667102518) for example code comparison.

| Requirement | Mantine | Shadcn |
|-------------|---------|--------|
| Layout components | Yes - Flex, Stack, Group, Grid | No - Use Tailwind divs |
| Out-of-box experience | Yes - Comprehensive | Partial - Assemble yourself |
| Code verbosity | Concise JSX props | Verbose Tailwind classes |
| Styling approach | Props + theme config | Tailwind utility classes |
| Documentation | Extensive API docs | Component examples |

**Benefits:**

1. **Built-in Layout Components** - Mantine provides layout primitives as JSX components:
   - `Flex`, `Stack`, `Group`, `Grid`, `Center`, `Container`
   - No need to manage `div` elements with Tailwind classes
   - More declarative, readable code

2. **Reduced Class Management** - Compare the same UI element:
   ```tsx
   // Mantine - concise
   <Alert icon={<IconAlertTriangle />} color="yellow" title="Warning">
     {message}
   </Alert>

   // Shadcn + Tailwind - verbose class strings
   <div className="flex items-start gap-3 rounded-lg border border-yellow-200
     bg-yellow-50 p-4 text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950
     dark:text-yellow-200">
     <IconAlertTriangle className="h-5 w-5 flex-shrink-0" />
     <div className="flex-1"><p className="font-medium">Warning</p>{message}</div>
   </div>
   ```

3. **Better Out-of-Box Experience**:
   - Single install provides all components
   - Consistent API across all components

## Server
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
