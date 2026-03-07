# Form Generation Extraction Plan

## Goal

Provide a **reusable form layer** (schema → defaults, form UI, validation, cleaned payload) that **any UX for interacting with MCP servers** can use—with or without InspectorClient.

**Examples:**

- **Inspector web app:** Tool input forms, elicitation forms, (later) server-config forms. Uses InspectorClient; form layer handles schema-driven UI and param cleaning.
- **Another React app using InspectorClient:** Same tool input and elicitation flows without reimplementing form-building and processing.
- **Agent or app with no InspectorClient:** An agent that uses MCP and receives a **form-based elicitation request** (e.g. `elicitation/create` with `requestedSchema`) must present a form to the user and turn their input into a valid elicitation response. It needs: generate a form from the schema, collect input, validate, and produce the response payload. No InspectorClient involved—just schema in, valid response out.
- **Server-config UX:** Forms to collect MCP server config from a server.json or ServerCard spec (registry, web-based cards). Same schema→form→clean pipeline.

The extraction should deliver a **general-purpose form capability** for MCP UX: schema-driven form generation and processing that works for tool parameters, elicitation, server config, or any other JSON-Schema–based MCP flow.

---

## What “Form Generation” Must Include for the Consumer

1. **Schema → default values**  
   Given a JSON Schema (e.g. tool `inputSchema`, elicitation `requestedSchema`, or server spec), produce the initial value object. Requires handling `$ref`, `required`, nested objects, and common union/nullable patterns.

2. **Schema → editable form UI**  
   A React component that, given `schema`, `value`, `onChange`, renders the form: string, number, integer, boolean, enum, nullable tri-state, object (nested), array (with add/remove), and JSON fallback when structure is too complex. Same behavior whether the schema came from a tool, an elicitation request, or a server spec.

3. **Schema-aware cleaning**  
   Before sending to MCP (e.g. `tools/call` or elicitation response), clean the form value: strip optional empty/null/undefined per schema so the payload is valid and minimal.

4. **Validation**  
   Optional but valuable: required fields, formats (e.g. email), and optionally full JSON Schema validation so the app can reject invalid input before submit.

5. **Types**  
   Shared TypeScript types for schema and values (`JsonSchemaType`, `JsonValue`, etc.).

6. **$ref resolution and union normalization**  
   The layer resolves $refs and normalizes union types so that schemas that reference definitions or use anyOf/union types “just work” in the form and in defaults/cleaning. Ref support includes resolving refs into `$defs`(draft 2019-09+) and`definitions` (draft-07).

**Deliverable:** Defaults + form UI component(s) + cleaning + types + optional validation, usable for tool input, elicitation response, server config, or any other MCP schema-driven flow—with or without InspectorClient.

---

## Current Inspector web app: where form-from-schema is used

### 1.1 Tool input (Tools tab)

- **Files:** `web/src/components/ToolsTab.tsx`, `web/src/App.tsx`
- **Flow:**
  - ToolsTab reads `selectedTool.inputSchema` (MCP tool `inputSchema`).
  - Builds initial params with `resolveRef` + `generateDefaultValue` per property (ToolsTab ~120–137).
  - Renders one block per property: resolve ref → `normalizeUnionType` → `isPropertyRequired` → then either inline controls (checkbox for boolean, Select for enum, etc.) or `<DynamicJsonForm>` for complex/object props (ToolsTab ~377, ~442).
  - `App.callTool` uses `cleanParams(params, tool.inputSchema)` before sending.
- **Schema helpers used:** `resolveRef`, `generateDefaultValue`, `isPropertyRequired`, `normalizeUnionType` from `schemaUtils`; `JsonSchemaType` from `jsonUtils`; `cleanParams` from `paramUtils`.

### 1.2 Tool input (Apps tab)

- **Files:** `web/src/components/AppsTab.tsx`
- **Flow:** Same pattern as ToolsTab: `inputSchema.properties` → `resolveRef` + `generateDefaultValue` for initial params; per-property resolve + `normalizeUnionType` + `isPropertyRequired`; mix of inline controls and `<DynamicJsonForm>`. cleanParams used when the app runs the tool.
- **Same helpers:** schemaUtils + jsonUtils + paramUtils.

### 1.3 Form elicitation

- **Files:** `web/src/components/ElicitationRequest.tsx`
- **Flow:** Receives `request.request.requestedSchema` (JSON Schema). Uses `generateDefaultValue(request.request.requestedSchema)` for initial form data; renders a single `<DynamicJsonForm schema={request.request.requestedSchema} value={formData} onChange={...} />`; validates with Ajv against that schema on Submit.
- **Helpers:** `generateDefaultValue` from schemaUtils; validation is local (Ajv) in the component.

### 1.4 Sampling request

- **Files:** `web/src/components/SamplingRequest.tsx`
- **Flow:** Builds a fixed `JsonSchemaType` (model, stopReason, role, content) in code and uses `<DynamicJsonForm schema={schema} value={messageResult} onChange={...} />`. Not driven by an external schema from the server; same form component.

### 1.5 Parameter cleaning (pre-send)

- **Files:** `web/src/utils/paramUtils.ts`, `web/src/App.tsx`
- **Flow:** `cleanParams(params, tool.inputSchema)` strips optional empty values before `tools/call`. Depends on `JsonSchemaType` and `required`/`properties`.

---

## Conversion: how the web app will use the extracted functionality

After extraction, the web app will stop using local schema/form implementations and instead use the core form layer. Concrete changes:

| Current usage              | Conversion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.1 Tools tab**          | Import `generateDefaultValue`, `resolveRef`, `isPropertyRequired`, `normalizeUnionType`, `cleanParams`, and types from core (e.g. `@modelcontextprotocol/inspector-core/schema` or `/react`). Replace `DynamicJsonForm` with core’s `SchemaForm` (or keep existing layout but have inline controls and the complex-property form component use core’s component and helpers). `App.callTool` continues to call `cleanParams(params, tool.inputSchema)` from core before sending. Remove or thin out `web/src/utils/schemaUtils` and `jsonUtils` usage for these paths. |
| **1.2 Apps tab**           | Same as Tools tab: import all schema helpers and types from core; use core’s `SchemaForm` where `DynamicJsonForm` is used today; use core’s `cleanParams` when running the tool. Remove duplicate schema/form logic from AppsTab.                                                                                                                                                                                                                                                                                                                                      |
| **1.3 Form elicitation**   | Import `generateDefaultValue` and types from core; use core’s `SchemaForm` (or keep a single `<SchemaForm>` usage as today). Validation can stay in web with Ajv, or use a core-provided validator if we add one. Remove dependency on web’s schemaUtils for defaults.                                                                                                                                                                                                                                                                                                 |
| **1.4 Sampling request**   | Import types and use core’s `SchemaForm`; the fixed schema is still built in the component (or in a shared constant), but the form UI and default-value logic come from core.                                                                                                                                                                                                                                                                                                                                                                                          |
| **1.5 Parameter cleaning** | Remove `web/src/utils/paramUtils.ts` (or reduce to a re-export of core’s `cleanParams`). `App.tsx` imports `cleanParams` from core.                                                                                                                                                                                                                                                                                                                                                                                                                                    |

**Web-specific code that can be removed or reduced after conversion:**

- **`web/src/utils/schemaUtils.ts`:** Move to core: `generateDefaultValue`, `resolveRef`, `isPropertyRequired`, `normalizeUnionType`, `formatFieldLabel`, `cleanParams` (and optionally `resolveRefsInMessage`). Keep in web only what remains (e.g. tool-output validation with Ajv, if not moved).
- **`web/src/utils/jsonUtils.ts`:** Schema-related types (`JsonSchemaType`, `JsonValue`, `JsonObject`) move to core; web imports from core. Keep in web only truly web-specific helpers (e.g. `updateValueAtPath` if used only for React state).
- **`web/src/utils/paramUtils.ts`:** Remove; `cleanParams` comes from core.
- **`web/src/components/DynamicJsonForm.tsx`:** Either remove and use core’s `SchemaForm` everywhere (ToolsTab, AppsTab, ElicitationRequest, SamplingRequest), or keep as a thin wrapper around core’s component that adds web’s design system (shadcn) until we standardize on core’s minimal UI or an adapter.

**Result:** Web no longer implements form-from-schema or param cleaning; it consumes the same API that any other React app would use.

---

## Proposed Shape of the Reusable Form Layer

### Schema layer (no React)

- **Location:** Core, e.g. `core/schema/` or `core/json/`.
- **Contents:** Types (`JsonValue`, `JsonSchemaType`, `JsonObject`); `generateDefaultValue`, `resolveRef`, `isPropertyRequired`, `normalizeUnionType`, `formatFieldLabel`, `cleanParams`. Optionally `resolveRefsInMessage` for elicitation message shapes.
- **Consumer:** Any environment (React, TUI, CLI, agent runtime). E.g. an agent that only needs to produce a valid elicitation response can use `generateDefaultValue(requestedSchema)` and a validator (or the React form) plus `cleanParams`; no InspectorClient.

### React form layer

- **Location:** Core’s React surface, e.g. `core/react/forms` (core already has React peer and `./react/*` exports).
- **Contents:** A `SchemaForm` component (schema, value, onChange, optional maxDepth) that renders the full form using the schema helpers; optional hook e.g. `useSchemaFormState(schema)` → `{ value, setValue, defaultValue, cleanForSubmit }`.
- **UI:** Ship with minimal default UI (plain HTML or unstyled components) so any React app can use it without a specific design system; apps can wrap or theme.
- **Consumer:** Any React app that needs to show a form for tool input, elicitation, or server config—whether it uses InspectorClient or not.

### Recommendation

- **Schema types + pure helpers** → core (no React). Used by the React form, by non-React UIs (TUI, CLI), and by agents or services that only need defaults/cleaning/validation (e.g. elicitation response generation with no UI).
- **Form UI (React)** → core’s React export. One dependency on inspector-core gives both InspectorClient (if used) and the form layer; an app that only needs forms for elicitation can use the same package and ignore InspectorClient.

---

## What Gets Extracted (Concrete)

### 1. Core schema module (no React)

- **Module:** e.g. `core/schema/` or `core/json/`.
- **Types:** `JsonValue`, `JsonSchemaType`, `JsonObject` (and any needed for oneOf/anyOf/const).
- **Functions:** `generateDefaultValue`, `resolveRef`, `isPropertyRequired`, `normalizeUnionType`, `formatFieldLabel`, `cleanParams`; optionally `resolveRefsInMessage`.
- **Tests:** Unit tests for all of the above.

### 2. Core React form layer

- **Component:** `SchemaForm` (or `DynamicJsonForm`) with props `schema`, `value`, `onChange`, optional `maxDepth`; uses core schema helpers; minimal default UI.
- **Optional hook:** `useSchemaFormState(schema)` → `{ value, setValue, defaultValue, cleanForSubmit }`.
- **Exports:** SchemaForm, hook, and re-exports of schema helpers and types from the React entry so a consumer can get everything from one import path.

### 3. Web app after extraction

- Use core for all schema types and helpers; use core’s SchemaForm (or keep web’s component backed by core helpers initially, then migrate). Web no longer owns the form implementation. See **“Conversion: how the web app will use the extracted functionality”** above for the detailed mapping per tab/flow.

### 4. Consumers (with or without InspectorClient)

- **React app with InspectorClient:** Tool input and elicitation use `SchemaForm` + `generateDefaultValue` + `cleanParams`; no reimplementation.
- **React app without InspectorClient (e.g. agent UX):** On form-based elicitation request, use `generateDefaultValue(request.requestedSchema)` for initial state, `<SchemaForm schema={requestedSchema} value={formData} onChange={setFormData} />`, validate, then send elicitation response with `cleanParams(formData, requestedSchema)` (or the raw formData if already valid). No InspectorClient integration required.
- **TUI / CLI / non-React:** Use core’s schema helpers and, if we add it, a form descriptor (schema → list of field descriptors) for rendering in a terminal or other non-React UI.

---

## Use Cases

- **Tool input (tools/call):** Schema = tool `inputSchema`; form collects arguments; clean before `callTool`.
- **Form-based elicitation:** Schema = `requestedSchema` from `elicitation/create`; form collects user input; validate and clean; return as elicitation response. Works with or without InspectorClient.
- **Server-config (future):** Schema = server.json or ServerCard spec; form collects connection config; clean and add to config.
- **Sampling / other MCP flows:** Any JSON-Schema–driven payload can use the same layer.

---

## TUI and other non-React form UIs

The TUI (and any other app that builds its own form UX instead of using the React component) cannot use the React `SchemaForm` component—it has its own rendering (e.g. Ink, readline, inquirer). It can still benefit from the extracted layer in the following ways.

### What the TUI (or non-React app) can use

1. **Schema layer (no React)**  
   All of the pure helpers and types in core:
   - **Defaults:** For tool input or elicitation, call `generateDefaultValue(schema)` instead of reimplementing or hardcoding. Same initial values as the web app.
   - **Field shape:** For each property, use `resolveRef`, `normalizeUnionType`, `isPropertyRequired`, and `formatFieldLabel` so the TUI knows type, required, label, and options (e.g. enum). The TUI does not implement `$ref` or union handling; it reuses core.
   - **Cleaning:** Before sending a tool call or elicitation response, call `cleanParams(collectedValue, schema)`. Same rules as the web app; no duplicate logic.
   - **Validation:** If core exposes a validator (e.g. `validate(schema, value)`), the TUI can validate before submit without bundling its own schema-validation logic.

2. **Optional: form descriptor**  
   The plan already mentions a form descriptor for TUI/CLI. Core could expose e.g. `getFormDescriptor(schema)` that returns a list of field descriptors (key, type, required, default, enum, label, nested descriptor, etc.). The TUI would:
   - Call `getFormDescriptor(schema)` once.
   - Render its own UI from that list (e.g. one Ink or readline prompt per field).
     No schema walking or resolution lives in the TUI; one canonical, well-tested interpretation of the schema. The React form could use the same descriptor internally so web and TUI stay in sync.

3. **Consistency**  
   Same defaults, same cleaning, and same validation rules as the web app. Behavior for a given schema is consistent across UIs; only the rendering (React vs terminal) differs.

### Other apps with their own form UX

The same applies to any non-React app that needs to generate its own form UX: Vue, mobile, another CLI, etc. They do not use the React component; they use the schema layer (and optionally the descriptor) to drive their own rendering, and they use `cleanParams` and validation from core so they do not reimplement that logic. Schema interpretation (what fields exist, types, defaults, required, options) lives in one place; rendering is up to each app.

---

## Testing

Extracting the form layer into core makes it **testable in isolation**. Today, form logic is embedded in the web app, so testing complex schemas and edge cases means running through full UI flows or mocking large parts of the app. After extraction, we can test the schema helpers and the form component directly, and optionally add a **test harness** plus e2e (e.g. Playwright) for the full pipeline when that adds value.

### Unit tests

- **Core schema helpers (no React):** Once `generateDefaultValue`, `resolveRef`, `isPropertyRequired`, `normalizeUnionType`, `formatFieldLabel`, and `cleanParams` live in core, add unit tests in core for:
  - Simple types (string, number, integer, boolean, array, object, null) and required vs optional.
  - Nested objects and arrays; `required` and `default`; `$ref` resolution (including failure cases).
  - Union/nullable patterns (`anyOf`, `type: ["string","null"]`, etc.) that `normalizeUnionType` handles.
  - `cleanParams`: optional empty values stripped, required and defaults preserved.
  - Edge cases: empty schema, missing properties, invalid refs, deep nesting.
    These are straightforward to cover thoroughly because the code is pure and has no DOM or React.

- **React form component:** If core ships a `SchemaForm` (or equivalent), add unit tests in core with React Testing Library:
  - Renders correct controls for each schema type (string, number, boolean, enum, object, array, etc.).
  - Initial value matches `generateDefaultValue(schema)`.
  - User changes propagate via `onChange`; optional hook `useSchemaFormState` behaves correctly.
  - JSON fallback when schema is too complex; maxDepth behavior.
  - Validation (if built in) and accessibility basics.
    This gives good coverage of the component in isolation but may not exercise every browser quirk or full “fill form → submit → assert output” flows.

Unit tests alone may **not** be sufficient for:

- Full pipeline: schema → rendered form → user input → validation → cleaned output, in a real browser.
- Complex or brittle schemas (e.g. from real tools or elicitation) that only fail when rendered and filled.
- Interaction edge cases (nested objects, dynamic arrays, conditional UI) that are easier to catch by driving the real form.

### Test harness app and e2e (Playwright)

If we need to validate the **full pipeline** and hard-to-reach edge cases, add a **test harness app** that:

1. **Renders** a form from a given JSON Schema (using core’s SchemaForm and helpers).
2. **Collects** user input (or programmatic input from tests).
3. **Validates** the collected value against the schema (using core or a shared validator).
4. **Produces** the final output (e.g. cleaned via `cleanParams`) and exposes it for assertions.

The harness is a **minimal app** (no InspectorClient, no full Inspector UI)—just schema in, form UI, submit, output out. It can be a small React app in the repo (e.g. `test/form-harness/` or under `core/` or `web/`) that we run in dev or in CI.

**E2E with Playwright** (or similar) would then:

- Load the harness (or a dedicated test page that uses the same form layer).
- For each test scenario: set or select a schema (simple, complex, edge-case), optionally fill the form (or use seeded values), submit, and assert on the output (structure, required fields present, optional empties stripped, validation errors when invalid).
- Cover scenarios that are awkward to test with unit tests alone: e.g. “object with 10 optional fields, user fills 2, output has only those 2,” “array of objects with nested refs,” “invalid enum value triggers validation error.”

**When a harness + e2e adds value:**

- We want confidence that the **entire path** (schema → defaults → form → input → validate → clean) works in a real browser for a curated set of schemas (including complex and edge-case).
- We introduce schemas that have historically caused bugs (e.g. from real MCP tools or elicitation) and lock them in as e2e scenarios.
- We’re willing to maintain a small harness and a Playwright (or similar) suite in exchange for catching integration and browser-specific issues.

**Recommendation:** Treat **unit tests as the baseline**: comprehensive tests for core schema helpers and for the React form component in core. Add a **test harness app + Playwright e2e** if we find that (a) unit tests are not sufficient to catch regressions or edge cases, or (b) we want a single place to run “full pipeline” tests against complex and real-world schemas. The extraction itself makes both options feasible; we can start with unit tests and introduce the harness and e2e in a later phase if they add value.

---

## Phased Rollout

1. **Phase 1 – Core schema + helpers**  
   Add types and pure functions to core. Web and other consumers import from core. No React form yet. **Testing:** Unit tests in core for all schema helpers (simple and complex schemas, edge cases).

2. **Phase 2 – Core React form component**  
   Add SchemaForm and optional hook in core/react with minimal default UI. Export from core. Any React-based MCP UX (Inspector web, another app, an agent’s React UI) can use it for tool input, elicitation, or server config. **Testing:** Unit tests for the form component (RTL) in core. Optionally add test harness app + Playwright e2e if full-pipeline and browser-level coverage is needed (see **Testing** above).

3. **Phase 3 – Web fully on core form layer**  
   Web uses core’s SchemaForm and helpers everywhere; remove duplicate form logic from web.

4. **Later – Server-config, descriptor API, non-React; harness/e2e if adopted**  
   Server-config schema support; optional form descriptor for TUI/CLI. If test harness and Playwright e2e were added, maintain and extend them for new schema categories or regression scenarios.

---

## Summary

- **Goal:** A **reusable form capability** for **any UX that interacts with MCP servers**—with or without InspectorClient. Examples: Inspector web, another React app using InspectorClient, an agent that receives form-based elicitation and must render a form and produce a valid response (no InspectorClient).
- **Deliverable:** Schema types + pure helpers in core; React form component + optional hook in core’s React surface; cleaning and validation. Usable for tool parameters, elicitation response, server config, or any other JSON-Schema–driven MCP flow.
- **Testing:** Unit tests for schema helpers and form component as baseline (including complex schemas and edge cases that are hard to test in the current embedded implementation). Optionally a test harness app (render form → collect input → validate → produce output) plus Playwright e2e for the full pipeline when unit tests are insufficient.
- **Outcome:** Any app or agent that needs to generate a form from an MCP schema and process the result into a valid payload can depend on this layer instead of reimplementing it.
