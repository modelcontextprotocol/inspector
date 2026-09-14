# Inspector Roadmap — August 2026 → February 2027

> A six-month plan for the Inspector client family (Web, CLI, TUI), covering both
> **spec-following work** driven by the MCP roadmap and **experience work** we choose
> for ourselves.

**Horizon:** 2026-08-11 → 2027-02-11 (~26 weekly milestones, `v2.2.0` → ~`v2.27.0`)
**Owner:** [Inspector V2 WG](https://modelcontextprotocol.io/community/working-groups/inspector-v2)
**Status:** Draft for WG review

---

## Table of Contents

- [1. Why this document exists](#1-why-this-document-exists)
- [2. The two tracks](#2-the-two-tracks)
- [3. Track A — following the spec](#3-track-a--following-the-spec)
  - [3.1 Transport evolution and scalability](#31-transport-evolution-and-scalability)
  - [3.2 Server Cards](#32-server-cards)
  - [3.3 Agent communication and Tasks](#33-agent-communication-and-tasks)
  - [3.4 Enterprise readiness](#34-enterprise-readiness)
  - [3.5 Triggers and events](#35-triggers-and-events)
  - [3.6 Result type improvements](#36-result-type-improvements)
  - [3.7 Interceptors](#37-interceptors)
  - [3.8 File uploads](#38-file-uploads)
  - [3.9 Skills over MCP](#39-skills-over-mcp)
  - [3.10 Primitive grouping and tool annotations](#310-primitive-grouping-and-tool-annotations)
  - [3.11 Conformance and validation](#311-conformance-and-validation)
- [4. Track B — experience work we choose](#4-track-b--experience-work-we-choose)
  - [4.1 The zoomable timeline (headline)](#41-the-zoomable-timeline-headline)
  - [4.2 Session record, replay, and share](#42-session-record-replay-and-share)
  - [4.3 Diff and compare](#43-diff-and-compare)
  - [4.4 Command palette and global search](#44-command-palette-and-global-search)
  - [4.5 Saved calls and collections](#45-saved-calls-and-collections)
  - [4.6 Assertions and CI flows](#46-assertions-and-ci-flows)
  - [4.7 The argument editor workstream](#47-the-argument-editor-workstream)
  - [4.8 Connection Doctor](#48-connection-doctor)
  - [4.9 Server management and portability](#49-server-management-and-portability)
  - [4.10 Workspace and layout](#410-workspace-and-layout)
  - [4.11 Performance at scale](#411-performance-at-scale)
  - [4.12 Accessibility and keyboard-first operation](#412-accessibility-and-keyboard-first-operation)
  - [4.13 Onboarding](#413-onboarding)
  - [4.14 Plugin architecture](#414-plugin-architecture)
- [5. Sequencing](#5-sequencing)
- [6. What we are deliberately not doing](#6-what-we-are-deliberately-not-doing)
- [7. Open questions](#7-open-questions)
- [8. Sources](#8-sources)

---

## 1. Why this document exists

Through v1, the Inspector was a **follow-along project**. The spec moved, we chased it, and
whatever planning capacity remained went to keeping up rather than to the tool's own design.
Every release was reactive by necessity.

That constraint has lifted. v2 meets the 2026-07-28 spec across all three clients, on SDK v2,
with a shared `core/`, a ≥90% per-file coverage gate, and a smoke/e2e apparatus that catches
packaging failures. For the first time we can spend planned effort on **what the Inspector
should be**, not only on what the spec just became.

This document splits the next six months into those two kinds of work, so that neither
starves the other. The explicit intent is a **roughly even split of capacity** — spec-following
work is non-negotiable but bounded, and the remaining capacity is ours to direct.

> **Sourcing note.** The MCP roadmap circulated as a Google Doc ("MCP Roadmap Process and
> Timeline") requires authentication and could not be read directly. This plan is built from
> the **published** roadmap at `modelcontextprotocol.io/development/roadmap` (last updated
> 2026-03-05) plus the current WG and IG charters, which together cover the same themes at
> more implementation-relevant detail. If the private doc contains timelines or themes absent
> from the public page, §3 should be revised against it before the plan is adopted.

---

## 2. The two tracks

|                             | **Track A — Spec-following**                          | **Track B — Experience**                    |
| --------------------------- | ----------------------------------------------------- | ------------------------------------------- |
| **Driver**                  | MCP roadmap, WG deliverables, SEP acceptance          | Our own judgment about the tool             |
| **Trigger to start**        | A SEP reaches Draft with a Tier-1 SDK reference impl  | Whenever we have capacity                   |
| **Risk**                    | Slips when upstream slips; we cannot control the date | We control the date entirely                |
| **Failure mode if starved** | Inspector stops being the reference test client       | Inspector stays a protocol dump, not a tool |
| **Target capacity**         | ~50%                                                  | ~50%                                        |

The two tracks are not independent. Several Track B items — the timeline, session
record/replay, diff — are **force multipliers for Track A**: each new protocol feature
arrives with a rendering problem, and a general timeline plus a general diff is cheaper than
one bespoke panel per SEP. That is the core scheduling argument of this plan: **build the
general surfaces early so the spec work that lands later is cheap to display.**

### How the Inspector's role is changing

Worth stating plainly, because it shapes the priorities below. The roadmap's Validation
section names **conformance test suites**, **SDK tiers**, and **reference implementations** as
standing investments, and SEP-2484 now requires conformance tests for final SEPs. The
Inspector is the most visible MCP client in the ecosystem and is already the thing people
reach for when a server misbehaves.

That points at an expanded role: not just _"show me the traffic"_ but _"tell me whether this
server is correct."_ Several items below (Server Card diffing, the conformance runner,
assertions, the readiness summary) are steps toward that, and they should be evaluated as a
group rather than individually.

---

## 3. Track A — following the spec

Each subsection states the upstream theme, our read on what it means for the Inspector, and a
concrete feature list. **Confidence** flags how much of the list we can commit to now:

- 🟢 **Build now** — the shape is known; blocked only on our own capacity.
- 🟡 **Design now, build on signal** — enough detail to design against; wait for a Draft SEP or a Tier-1 SDK impl before building.
- 🔴 **Watch** — too early to predict a UI; keep a tracking issue and a WG liaison.

### 3.1 Transport evolution and scalability

**Upstream:** Transports WG. Next-generation Streamable HTTP that runs statelessly across
multiple instances and behaves correctly behind load balancers and proxies; a session model
covering creation, resumption, and migration; conformance guidance for SDK authors. The
roadmap is explicit that **no additional official transports** ship this cycle.

**Read:** This is the theme most likely to produce breaking wire changes, and the one where
the Inspector is most useful — session resumption and proxy behavior are exactly the failures
nobody can reproduce by reading code. Our era model (`legacy` / `modern` / `auto`) already
gives us the negotiation seam to add a third era behind.

| Feature                                                                                                                                                      | Confidence | Notes                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Session lifecycle lane** — session id, creation, resumption, migration, and expiry as first-class events, not log lines                                    | 🟢         | Renders into the timeline (§4.1). Buildable against today's session model; extends to the new one.                                                                            |
| **`Last-Event-ID` resumption support and display**                                                                                                           | 🟢         | Existing gap — [#920](https://github.com/modelcontextprotocol/inspector/issues/920). Do it now; it is table stakes for the new session work.                                  |
| **Proxy / intermediary harness** — route through a configurable proxy, then deliberately misbehave: rewrite headers, drop the GET stream, close mid-response | 🟡         | Builds on [#1684](https://github.com/modelcontextprotocol/inspector/issues/1684). Needs a `misbehaving-proxy` preset in `test-servers/`.                                      |
| **Stateless-mode verification** — issue the same request across N synthetic instances and diff the responses                                                 | 🟡         | Directly tests the property the WG is specifying. Pairs with §4.3.                                                                                                            |
| **Third protocol era behind the existing negotiation seam**                                                                                                  | 🟡         | Cost is low _if_ we keep era-conditional exposure rather than replacing the legacy path.                                                                                      |
| **Custom transport support**                                                                                                                                 | 🟢         | [#1741](https://github.com/modelcontextprotocol/inspector/issues/1741). The roadmap pushes experimentation to custom transports, so the Inspector should be able to load one. |

### 3.2 Server Cards

**Upstream:** Server Card WG, [SEP-2127](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127) (Draft). A standard `.well-known` document exposing structured server metadata so browsers, crawlers, and registries can discover capabilities **without connecting**. Deliberately kept close to a subset of `server.json`.

**Read:** This is the single highest-leverage Track A item for us, because it creates a new
Inspector capability rather than a new panel: **inspect before connect**. It also creates an
obvious correctness question that only a tool like ours can answer.

| Feature                                                                                                     | Confidence | Notes                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Card preview** — paste a URL, fetch the card, render the capability surface, one-click add to catalog     | 🟡         | The pre-connection entry point. Wait for the format to settle.                                                                                                                                        |
| **Card-vs-reality diff** — compare the advertised card against what `initialize` + `*/list` actually return | 🟡         | _The_ Inspector-shaped feature here. Nobody else in the ecosystem is positioned to check this. Shares machinery with [#1034](https://github.com/modelcontextprotocol/inspector/issues/1034) and §4.3. |
| **`mcp-inspector --card-lint <url>`** — validate a card, non-zero exit on drift                             | 🟡         | CI-usable; a natural companion to the conformance runner (§3.11).                                                                                                                                     |
| **`server.json` support**                                                                                   | 🟢         | [#922](https://github.com/modelcontextprotocol/inspector/issues/922). Prerequisite — the card is a subset, so this lands first regardless.                                                            |

### 3.3 Agent communication and Tasks

**Upstream:** Agents WG. Tasks (`io.modelcontextprotocol/tasks`, SEP-2663) is being
**stabilized and promoted from an extension into core**. Named open gaps: **retry semantics**
(what happens on transient failure, who decides to retry) and **expiry policies** (result
retention, how clients learn a result expired). An Agents Extension is under evaluation.

**Read:** We already drive the modern Tasks extension ourselves over a raw-wire channel,
because SDK v2 era-gates `tasks/*` out. Promotion to core will move that back under the SDK —
plan for the migration, but **keep the era-conditional exposure**; the legacy `capabilities.tasks`
path must keep working.

| Feature                                                                                                              | Confidence | Notes                                                                                       |
| -------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| **Retry visualization** — attempts, backoff, who initiated each retry                                                | 🟡         | Design against the WG's gap list now.                                                       |
| **Expiry / TTL surfacing** — retention countdown on a completed task, distinct rendering for an expired-result error | 🟡         | Cheap once the semantics land; easy to get wrong if we guess early.                         |
| **Tasks as timeline spans** — a long-running task is a span, not a row                                               | 🟢         | Falls out of §4.1 for free. The strongest argument for building the timeline first.         |
| **Extension → core migration**                                                                                       | 🟡         | Retire the raw-wire channel when the SDK covers it; keep both paths during overlap.         |
| **`Mcp-Name` header on Tasks over Streamable HTTP**                                                                  | 🟢         | [#1917](https://github.com/modelcontextprotocol/inspector/issues/1917) — open bug, fix now. |
| **Discover checkmarks for task extensions**                                                                          | 🟢         | [#1887](https://github.com/modelcontextprotocol/inspector/issues/1887).                     |

### 3.4 Enterprise readiness

**Upstream:** An Enterprise WG is expected to form. Four named areas: **audit trails and
observability**, **enterprise-managed auth** (Cross-App Access / ID-JAG), **gateway and proxy
patterns**, and **configuration portability**. Most output is expected as extensions rather
than core spec changes. Related: the Enterprise-Managed Authorization IG, and sponsored work
on [SEP-1932 (DPoP)](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1932) and [SEP-1933 (Workload Identity Federation)](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1933).

**Read:** "Audit trails and observability, in a form enterprises can feed into their existing
pipelines" is a description of something the Inspector nearly already has. We hold the entire
session; we simply cannot **export** it in any pipeline-shaped format. That gap is cheap to
close and disproportionately valuable.

| Feature                                                                                                | Confidence | Notes                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OTLP export** — emit the session as OpenTelemetry spans; show trace/span ids inline; "copy as trace" | 🟢         | SEP-414 already puts trace context in `_meta`. Buildable today, no upstream dependency.                                                                                                                                                                                                     |
| **Structured audit transcript** — the full session as a stable, documented JSON artifact               | 🟢         | Shares its format with §4.2 record/replay. Build once, use for both.                                                                                                                                                                                                                        |
| **Machine-readable readiness summary**                                                                 | 🟢         | [#1916](https://github.com/modelcontextprotocol/inspector/issues/1916).                                                                                                                                                                                                                     |
| **ID-JAG / Cross-App Access test flow**                                                                | 🟡         | The EMA IG exists specifically because this only works when IdP + client + AS interoperate. A test client is exactly what they lack. Related: [#1937](https://github.com/modelcontextprotocol/inspector/issues/1937), [#571](https://github.com/modelcontextprotocol/inspector/issues/571). |
| **DPoP and Workload Identity Federation**                                                              | 🔴         | Both sponsored but pre-acceptance. Watch; do not build.                                                                                                                                                                                                                                     |
| **Gateway mode** — declare an intermediary, then show what we sent vs. what the gateway forwarded      | 🟡         | Depends on the Gateways IG settling propagation semantics.                                                                                                                                                                                                                                  |
| **Configuration portability**                                                                          | 🟢         | [#1912](https://github.com/modelcontextprotocol/inspector/issues/1912), [#904](https://github.com/modelcontextprotocol/inspector/issues/904), plus `server.json` (§3.2).                                                                                                                    |

### 3.5 Triggers and events

**Upstream:** Triggers and Events WG. A standardized server→client callback mechanism
(webhooks or similar), with subscription lifecycle and **ordering guarantees that hold across
all transports**. Status: "SEP: Events in MCP v1 RFC" — **Ideating**.

**Read:** ⚠️ **This is the largest architectural change on the horizon for us, and the one we
are least prepared for.** Every Inspector surface today assumes we are the party that
_initiated_ the connection. A webhook mechanism makes us a **server** — we must host a
publicly reachable callback endpoint, which for a tool that usually runs on `localhost` is a
real problem (tunnels, port forwarding, or a relay).

We should start the design conversation **now**, well ahead of the SEP, and bring it to the
WG as implementation feedback. The ordering-guarantee requirement in particular is
untestable without a client that records arrival order — which is us.

| Feature                                                                                   | Confidence | Notes                                                                                                                                            |
| ----------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Callback receiver** — backend-hosted endpoint, its URL registered as the trigger target | 🔴         | Needs design now, build later. Security review mandatory: an inbound public endpoint on a process that spawns subprocesses is a serious surface. |
| **Local reachability story** — tunnel integration or documented guidance                  | 🔴         | Likely the hardest UX problem of the whole six months.                                                                                           |
| **Delivery log with ordering and duplicate assertions**                                   | 🔴         | The conformance value: did events arrive in the promised order? were any redelivered?                                                            |

### 3.6 Result type improvements

**Upstream:** "On the Horizon." **Streamed results** (incremental output for generated text,
audio, video frames) and **reference-based results** (client decides when to pull a large
payload into context). Explicitly cross-cutting — streaming touches transport, references
touch the schema.

**Read:** Streaming changes how every result panel renders: today we display a _result_, and
we would need to display a _stream that becomes a result_. Worth a rendering abstraction
before the SEP, not after.

| Feature                                                                                                 | Confidence | Notes                                                                               |
| ------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| **Incremental result rendering** — progressive display, with time-to-first-chunk and inter-chunk timing | 🔴         | The timing view is Inspector-shaped; the timeline is the natural home.              |
| **Reference-result handling** — show a handle plus an explicit "pull payload", with size accounting     | 🔴         | Also a good default for large payloads _today_, independent of the SEP (see §4.11). |

### 3.7 Interceptors

**Upstream:** Interceptors WG, [SEP-1763](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2076) (Draft). Interceptors as a new primitive with two types — **validators** (pass/fail) and **mutators** (transform payloads) — across in-process, sidecar, and remote deployment models, with priority-based chain ordering and audit-mode semantics. A **CLI client for interceptor invocation and testing** is a listed WG deliverable (Ideating, unowned).

**Read:** Two things stand out. First, "CLI client for interceptor invocation and testing" is
**an unclaimed deliverable that describes our CLI**. Worth raising with the WG — Ola co-leads
both groups, so the liaison already exists. Second, an interceptor chain is a
_before → after payload transformation_, which is a diff, which we should already be able to
render (§4.3).

| Feature                                                                                                    | Confidence | Notes                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Interceptor test bench** — register a chain, show before/after diff per hop, visualize priority ordering | 🟡         | The clearest "Inspector as the reference tool" opportunity of the six months.                                          |
| **Audit-mode rendering** — what _would_ have been blocked or mutated                                       | 🟡         | Follows the SEP's audit semantics.                                                                                     |
| **CLI interceptor invocation**                                                                             | 🟡         | **Action: raise with the Interceptors WG.** If we take it, it needs its own milestone allocation.                      |
| **Our plugin architecture as an interceptor host**                                                         | 🟡         | [#1025](https://github.com/modelcontextprotocol/inspector/issues/1025). Prevents us building two extension mechanisms. |

### 3.8 File uploads

**Upstream:** File Uploads WG, [SEP-2356](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2356) (Draft, TS SDK reference impl targeted End May). Declarative `FileInputDescriptor` on tool input schemas and elicitation schemas, so hosts render native file pickers. Success criteria explicitly include **"at least one production host rendering a native file picker from the descriptor."**

**Read:** The most tractable Track A item on the list — narrow, well-specified, with a TS SDK
reference implementation coming, and we are a credible candidate for that "production host."
It touches three surfaces: `SchemaForm` (Tools), elicitation forms, and MCP Apps.

| Feature                                                                              | Confidence | Notes                                            |
| ------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------ |
| **File picker in `SchemaForm`** when a descriptor is present, with data-URI encoding | 🟡         | Wait for the TS SDK types, then build. Low risk. |
| **Same in elicitation forms**                                                        | 🟡         | Shared component.                                |
| **Size guardrails and host-side validation**                                         | 🟡         | The SEP references OWASP ASVS V5.                |

### 3.9 Skills over MCP

**Upstream:** Skills Over MCP WG, [SEP-2640](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2640) (In Review, Extensions Track). Resources-based; a reference implementation is also In Review.

**Read:** Because it is Resources-based, the incremental cost is low — a Skills view over the
existing resource machinery rather than a new subsystem.

| Feature                                                  | Confidence | Notes                                                                |
| -------------------------------------------------------- | ---------- | -------------------------------------------------------------------- |
| **Skills view** — list, preview content, show activation | 🟡         | Gate on the negotiated extension, the way the Tasks tab gates today. |

### 3.10 Primitive grouping and tool annotations

**Upstream:** Two IGs. **Primitive Grouping** explores organizing Tools/Resources/Prompts
beyond flat lists — deliberately not picking one canonical pattern early. **Tool Annotations**
is consolidating six independent annotation SEPs and considering runtime annotations and tool
_response_ annotations.

**Read:** Grouping is the rare case where the spec-following work and the UX work are the same
work. Flat lists are already our weakest surface on large servers — [#1957](https://github.com/modelcontextprotocol/inspector/issues/1957) (duplicate tool names) was a symptom. **Build the grouped sidebar as a UX
improvement now**, and adopt whatever grouping the IG lands as a data source later.

| Feature                                                            | Confidence | Notes                                                                                                                 |
| ------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| **Grouped / tree sidebars with group-aware search**                | 🟢         | Build now on client-side heuristics (name prefixes, annotations). Ship value immediately; swap the data source later. |
| **Richer annotation rendering**                                    | 🟢         | Extends the existing `AnnotationBadge`.                                                                               |
| **Annotation-driven confirmation** before a `destructiveHint` call | 🟢         | Small, obviously correct, no upstream dependency.                                                                     |
| **Runtime / response annotations**                                 | 🔴         | Watch.                                                                                                                |

### 3.11 Conformance and validation

**Upstream:** Standing investment — conformance test suites, SDK tiers ([SEP-1730](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1730)), reference implementations. [SEP-2484](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2484) now **requires conformance tests for final SEPs**, and the EMA IG is explicitly contributing scenarios to the `modelcontextprotocol/conformance` repository.

**Read:** A conformance suite needs a driver and a report. We are the natural driver, and we
already have a CLI that exits non-zero. This is the clearest path to the expanded role
described in §2 — and unlike most of Track A, **it is not gated on any SEP**.

| Feature                                                                                           | Confidence | Notes                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Conformance runner** — run the suite against a connected server, render pass/fail per assertion | 🟡         | Needs coordination on the suite's programmatic interface. **Action: open a conversation with the conformance maintainers.**                                                |
| **`mcp-inspector --conformance` for CI**                                                          | 🟡         | Same engine, CLI report, exit code.                                                                                                                                        |
| **Strict schema validation with actionable errors**                                               | 🟢         | [#1005](https://github.com/modelcontextprotocol/inspector/issues/1005), [#1015](https://github.com/modelcontextprotocol/inspector/issues/1015). No dependency; start here. |

---

## 4. Track B — experience work we choose

Nothing in this section waits on a SEP. Ordered by leverage, not by effort.

### 4.1 The zoomable timeline (headline)

**Committed.** The single feature that most changes what the Inspector _is_.

The Protocol and Network screens are chronological lists. A list answers "what happened next"
but not "what happened _at the same time_", "how long did this take", or "which of these
caused that" — and those are the questions people actually bring to the Inspector. A
session with an MRTR round-trip, a long-running task, a subscription stream, and a
mid-session OAuth step-up is, in list form, an interleaved mess. On a time axis it is legible
at a glance.

**Design sketch:**

- **A third view over the existing stores**, not a new data path. Protocol, Network, and
  Timeline become three renderings of one session. This keeps the coverage gate and the
  existing `protocolUtils` derivations intact.
- **Lanes**, each independently collapsible:
  `client → server` · `server → client` · notifications · tasks · subscription streams · OAuth/auth · errors
- **Spans, not points.** A request occupies from send to response; a task occupies its whole
  lifetime; a stream is a bar with events on it. Duration becomes visible, which is most of
  the value.
- **Zoom and pan** across the full range, from whole-session down to sub-millisecond.
  Brush-to-select a range and filter every other view to it.
- **Grouping** — an MRTR conversation is one collapsible span containing its rounds; a task
  contains its polls.
- **Click through** to the existing Protocol/Network entry. The timeline is navigation, not a
  replacement.
- **A pinned mini-timeline strip** above every tab, so a spike is visible while you are in
  Tools, and clicking it jumps to the full view.
- **Latency distribution** as a secondary view — per method, so a slow tool is obvious.
- **Virtualized**, keyboard-navigable, and rendered from the same store the other views use.

**Deliberately out of scope for v1 of this feature:** cross-server correlation (needs §4.10),
and OTLP-shaped nesting (needs §3.4).

### 4.2 Session record, replay, and share

Save a complete session — protocol log, network log, server config, negotiated capabilities —
to a single file. Reopen it later, on another machine, with no server running. Attach it to a
bug report.

This changes issue triage from "works on my machine" into an artifact, and it is the same
serialization format as the enterprise audit transcript (§3.4) — **build the format once**.
Replay also gives us fixtures: a recorded session is a regression test.

### 4.3 Diff and compare

Two sessions, or two servers, side by side. Concretely:

- **Capability diff** — reconnect after changing your server, see exactly what moved in
  `tools/list` / `resources/list` / `prompts/list`. ([#1034](https://github.com/modelcontextprotocol/inspector/issues/1034))
- **Session diff** — same calls, two servers, what differed.
- **Payload diff** — before/after for any pair of JSON documents.

The payload differ is a **shared primitive**: interceptor before/after (§3.7), Server
Card-vs-reality (§3.2), and stateless-instance comparison (§3.1) are all the same widget with
different inputs. Build it as a component first, then wire the three consumers.

### 4.4 Command palette and global search

`⌘K` to jump to any server, tool, resource, or prompt; re-run the last call; switch tabs. Plus
full-text search across the protocol log with a real filter syntax (`method:tools/call
status:error duration:>500ms`). The Inspector is currently a mouse-driven app; for a developer
tool that is a daily tax.

### 4.5 Saved calls and collections

Name a tool call with its arguments, save it, re-run it, parameterize it, share it. A
Postman-collection model for MCP. The single most requested shape of workflow improvement for
any protocol client, and it composes directly with §4.6.

### 4.6 Assertions and CI flows

Attach expectations to a saved call — result matches schema, field equals value, latency under
a bound — and run the collection from the CLI with a non-zero exit on failure. This turns the
Inspector from an interactive tool into part of a server author's test suite, and it shares an
engine with the conformance runner (§3.11).
Related: [#1005](https://github.com/modelcontextprotocol/inspector/issues/1005), [#1886](https://github.com/modelcontextprotocol/inspector/issues/1886), [#1916](https://github.com/modelcontextprotocol/inspector/issues/1916).

### 4.7 The argument editor workstream

Six open issues are all the same defect class — the argument editor is not schema-aware:

| Issue                                                                  | Symptom                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [#1853](https://github.com/modelcontextprotocol/inspector/issues/1853) | JSON parameter editor escaping while typing                         |
| [#1856](https://github.com/modelcontextprotocol/inspector/issues/1856) | Backspace recursively escapes JSON tool inputs                      |
| [#1885](https://github.com/modelcontextprotocol/inspector/issues/1885) | Null values corrupted with cascading escapes                        |
| [#1928](https://github.com/modelcontextprotocol/inspector/issues/1928) | Nullable enums fall back to a broken raw Textarea (v1.x regression) |
| [#1919](https://github.com/modelcontextprotocol/inspector/issues/1919) | Resource templates lack RFC 6570 expansion                          |
| [#1910](https://github.com/modelcontextprotocol/inspector/issues/1910) | Complex `_meta` not expressible                                     |

**Fix them as one workstream, not six bugs.** A proper schema-aware editor (CodeMirror or
Monaco with JSON Schema integration) resolves the class and unblocks file inputs (§3.8) and
strict validation (§3.11). Treating them individually has already produced one regression from
v1.

### 4.8 Connection Doctor

Connection failures are currently opaque, and five open issues say so
([#962](https://github.com/modelcontextprotocol/inspector/issues/962), [#1936](https://github.com/modelcontextprotocol/inspector/issues/1936), [#1951](https://github.com/modelcontextprotocol/inspector/issues/1951), [#1944](https://github.com/modelcontextprotocol/inspector/issues/1944), [#1914](https://github.com/modelcontextprotocol/inspector/issues/1914)).

Run an ordered checklist on failure — DNS · TCP · TLS (including local-cert cases) ·
`/.well-known` discovery · protocol version negotiation · auth — and report **which step
failed and what to do about it**. First-connection success is the entire first impression of
the tool, and today a `https://localhost` server or a dev container silently fails.

Bundle the related fixes: `*.localhost` domains ([#1944](https://github.com/modelcontextprotocol/inspector/issues/1944)), the trusted-local-host OAuth HTTP
exception ([#1911](https://github.com/modelcontextprotocol/inspector/issues/1911)), and the ghost-server entry left by a failed manual connect ([#1914](https://github.com/modelcontextprotocol/inspector/issues/1914)).

### 4.9 Server management and portability

Already well represented on the board; grouping it here so it is scheduled as a theme rather
than piecemeal: rich server configuration ([#1857](https://github.com/modelcontextprotocol/inspector/issues/1857)), custom headers and cookies ([#1915](https://github.com/modelcontextprotocol/inspector/issues/1915)),
auth/token URL overrides ([#1906](https://github.com/modelcontextprotocol/inspector/issues/1906)), file-backed secrets where no OS keychain exists ([#1950](https://github.com/modelcontextprotocol/inspector/issues/1950)),
paste-MCP-JSON ([#904](https://github.com/modelcontextprotocol/inspector/issues/904)), and registry discovery ([#1101](https://github.com/modelcontextprotocol/inspector/issues/1101)).

### 4.10 Workspace and layout

Multiple servers side by side — the actual shape of debugging a gateway, or comparing a
server against a reference implementation. Detachable/resizable panels, remembered layout per
server, density modes, and full-collapse ([#928](https://github.com/modelcontextprotocol/inspector/issues/928)). Prerequisite for cross-server timeline
correlation.

### 4.11 Performance at scale

A 1000-tool server or a long-running session should not degrade. Virtualize the long lists and
logs; cap in-memory protocol history with spill-to-disk; truncate large payloads by default
with explicit expansion (which is also the right default for reference results, §3.6).

### 4.12 Accessibility and keyboard-first operation

Full keyboard operation across every tab, correct roles and labels, high-contrast support,
and `prefers-reduced-motion` (which the timeline's animations will make newly relevant). We
have a Storybook a11y harness already; the gap is coverage, not tooling.

### 4.13 Onboarding

A first run currently presents an empty server list and no path forward. Add a guided first
connection, one-click example servers drawn from `test-servers/`, and inline links from each
panel to the relevant spec section.

### 4.14 Plugin architecture

[#1025](https://github.com/modelcontextprotocol/inspector/issues/1025). The multiplier on everything above — custom panels, custom transports (§3.1),
interceptor hosting (§3.7), and community-contributed views without core changes. Sequenced
late deliberately: designing a plugin API before the timeline, diff, and session format exist
would mean designing it against the wrong surfaces.

---

## 5. Sequencing

Four phases of roughly six weekly milestones each. Track A items appear where their upstream
signal is expected; Track B items are placed to unblock Track A wherever possible.

### Phase 1 — Foundations (~`v2.2` – `v2.7`, Aug–Sep 2026)

_Build the general surfaces the rest of the plan renders into, and clear the debt that makes
first impressions bad._

- 🅑 **Zoomable timeline v1** — lanes, spans, zoom/pan, click-through
- 🅑 **Argument editor workstream** (§4.7) — closes six issues as one
- 🅑 **Connection Doctor** (§4.8) + the local-host connection fixes
- 🅐 `Last-Event-ID` resumption ([#920](https://github.com/modelcontextprotocol/inspector/issues/920)); `Mcp-Name` on Tasks ([#1917](https://github.com/modelcontextprotocol/inspector/issues/1917)); discover checkmarks ([#1887](https://github.com/modelcontextprotocol/inspector/issues/1887))
- 🅐 `server.json` support ([#922](https://github.com/modelcontextprotocol/inspector/issues/922)) — prerequisite for Server Cards
- ⚙️ Windows CI/gate fixes already in `v2.2.0`

### Phase 2 — Artifacts and comparison (~`v2.8` – `v2.13`, Sep–Nov 2026)

_Make sessions into things you can keep, share, and compare._

- 🅑 **Session record / replay / share** (§4.2) — format shared with audit transcript
- 🅑 **Diff primitive** (§4.3) — then wire capability diff ([#1034](https://github.com/modelcontextprotocol/inspector/issues/1034))
- 🅑 **Command palette and global search** (§4.4)
- 🅐 **OTLP export and audit transcript** (§3.4) — no upstream dependency
- 🅐 **Grouped sidebars** (§3.10) on client-side heuristics
- 🅐 Strict schema validation ([#1005](https://github.com/modelcontextprotocol/inspector/issues/1005), [#1015](https://github.com/modelcontextprotocol/inspector/issues/1015))
- 🅐 Timeline lanes for tasks and sessions (falls out of Phase 1)

### Phase 3 — Automation and spec catch-up (~`v2.14` – `v2.20`, Nov 2026 – Jan 2027)

_Turn the Inspector into something you can run in CI, and absorb the SEPs that have landed._

- 🅑 **Saved calls / collections** (§4.5) → **assertions and CI flows** (§4.6)
- 🅐 **Conformance runner** (§3.11) — shares the assertion engine
- 🅐 **File uploads** (§3.8) — assumes the TS SDK reference impl has shipped
- 🅐 **Server Card preview + card-vs-reality diff** (§3.2) — assumes SEP-2127 has settled
- 🅐 **Skills view** (§3.9) — assumes SEP-2640 accepted
- 🅑 Performance at scale (§4.11); accessibility pass (§4.12)

### Phase 4 — Frontier (~`v2.21` – `v2.27`, Jan–Feb 2027)

_The items whose shape we cannot yet commit to, plus the multiplier._

- 🅐 **Interceptor test bench** (§3.7) — and a decision on owning the WG's CLI deliverable
- 🅐 **Triggers/events receiver** (§3.5) — design throughout, build only if the SEP lands
- 🅐 **Transport/session work** (§3.1) — proxy harness, stateless verification, third era
- 🅐 **ID-JAG / Cross-App Access flow** (§3.4)
- 🅑 **Plugin architecture** (§4.14) — designed against surfaces that now exist
- 🅑 Workspace and layout (§4.10); onboarding (§4.13)

### Standing commitments across all phases

- **Weekly milestone cadence** and the pre-push gate (`npm run local:gate`, renamed off `ci` in #2146) are unchanged.
- **Bug and triage capacity is reserved, not scheduled.** The board's Incoming queue keeps
  flowing regardless of phase.
- **WG liaison**: attend Transports, Agents, Triggers, Interceptors, and Server Card sessions
  and feed implementation experience back. Several items above are as much _inputs to_ the
  spec as outputs of it.

---

## 6. What we are deliberately not doing

Stating these so they are decisions rather than oversights.

- **Not building bespoke panels per SEP.** Where a new feature can render into the timeline,
  the diff, or the session format, it does. A new top-level tab needs justification.
- **Not chasing pre-Draft SEPs.** 🔴 items get a tracking issue and a WG liaison, not code.
  We were burned by this in v1.
- **Not publishing `core/` as a package this cycle.** [#1636](https://github.com/modelcontextprotocol/inspector/issues/1636) stays deferred; it adds an API
  compatibility obligation we cannot yet afford.
- **Not adding transports beyond what the spec blesses**, per the roadmap — but §3.1 makes
  _custom_ transports loadable so the community can experiment.
- **Not building a second extension mechanism.** If we host interceptors, they run on the
  plugin architecture (§4.14).

---

## 7. Open questions

For WG discussion before this plan is adopted.

1. **Does the private roadmap doc change §3?** This plan is built from the public roadmap; the
   private doc may carry timelines or themes it omits.
2. **Do we claim the Interceptors WG's "CLI client for interceptor invocation and testing"?**
   It is Ideating and unowned, it describes our CLI, and we have a co-lead in common. If yes,
   it needs milestone allocation in Phase 3, not Phase 4.
3. **How far do we take the conformance role?** §3.11 and §4.6 point at "the Inspector tells
   you whether your server is correct." That is a real expansion of mission — worth an
   explicit yes or no, and possibly a charter amendment.
4. **Who owns the triggers/events reachability problem?** A publicly reachable callback
   endpoint on a localhost dev tool is a security question as much as a UX one, and it needs
   an owner before Phase 4.
5. **Is the ~50/50 capacity split right?** It is an assertion in this draft, not a measurement.
6. **Timeline v1 scope.** The §4.1 sketch is deliberately broad. Which parts are v1 and which
   are follow-ups should be settled before Phase 1 starts.

---

## 8. Sources

- [MCP Roadmap](https://modelcontextprotocol.io/development/roadmap) (last updated 2026-03-05)
- WG charters: [Inspector V2](https://modelcontextprotocol.io/community/working-groups/inspector-v2) · [Server Card](https://modelcontextprotocol.io/community/working-groups/server-card) · [Triggers & Events](https://modelcontextprotocol.io/community/working-groups/triggers-events) · [Agents](https://modelcontextprotocol.io/community/working-groups/agents) · [Interceptors](https://modelcontextprotocol.io/community/working-groups/interceptors) · [File Uploads](https://modelcontextprotocol.io/community/working-groups/file-uploads) · [Skills Over MCP](https://modelcontextprotocol.io/community/working-groups/skills-over-mcp)
- IG charters: [Primitive Grouping](https://modelcontextprotocol.io/community/interest-groups/primitive-grouping) · [Tool Annotations](https://modelcontextprotocol.io/community/interest-groups/tool-annotations) · [Enterprise-Managed Authorization](https://modelcontextprotocol.io/community/interest-groups/enterprise-managed-authorization)
- Internal: [`specification/v2_new_spec_impact.md`](../specification/v2_new_spec_impact.md) · [`specification/v2_scope.md`](../specification/v2_scope.md) · [`specification/v2_ux_features.md`](../specification/v2_ux_features.md)
- [Inspector V2 project board (#28)](https://github.com/orgs/modelcontextprotocol/projects/28)
