# Inspector Roadmap — August 2026 → February 2027

> A six-month plan for the Inspector client family (Web, CLI, TUI), covering both
> **spec-following work** driven by the MCP roadmap and **experience work** we choose
> for ourselves.

**Horizon:** 2026-08-11 → 2027-02-11 (~26 weekly milestones, `v2.2.0` → ~`v2.27.0`)
**Owner:** [Inspector V2 WG](https://modelcontextprotocol.io/community/working-groups/inspector-v2)
**Status:** Draft for WG review — **revised 2026-09-17** against the published MCP roadmap of 2026-08-22 (#2400)

## Work we can start now, no external blockers

[Inspector Unblocked Work](https://claude.ai/artifact/MTFGsTVbKCqMchA1JYHo83) lists the roadmap items that depend on nothing outside this repo.

---

## Table of Contents

- [Work we can start now, no external blockers](#work-we-can-start-now-no-external-blockers)
- [1. Why this document exists](#1-why-this-document-exists)
- [2. The two tracks](#2-the-two-tracks)
- [3. Track A — following the spec](#3-track-a--following-the-spec)
  - [3.1 Agentic messaging primitives](#31-agentic-messaging-primitives)
  - [3.2 HTTP-native transport unification and hardening](#32-http-native-transport-unification-and-hardening)
  - [3.3 Agent identity and enterprise-ready security](#33-agent-identity-and-enterprise-ready-security)
  - [3.4 Improved primitives](#34-improved-primitives)
  - [3.5 Improved SDK developer experience](#35-improved-sdk-developer-experience)
  - [3.6 Conformance and validation](#36-conformance-and-validation)
  - [3.7 Off the published roadmap — watch only](#37-off-the-published-roadmap--watch-only)
- [4. Official extensions](#4-official-extensions)
- [5. Track B — experience work we choose](#5-track-b--experience-work-we-choose)
  - [5.1 The zoomable timeline (headline)](#51-the-zoomable-timeline-headline)
  - [5.2 Session record, replay, and share](#52-session-record-replay-and-share)
  - [5.3 Diff and compare](#53-diff-and-compare)
  - [5.4 Command palette and global search](#54-command-palette-and-global-search)
  - [5.5 Saved calls and collections](#55-saved-calls-and-collections)
  - [5.6 Assertions and CI flows](#56-assertions-and-ci-flows)
  - [5.7 Observability export](#57-observability-export)
  - [5.8 Connection Doctor](#58-connection-doctor)
  - [5.9 Server management and portability](#59-server-management-and-portability)
  - [5.10 Large servers: grouping and performance](#510-large-servers-grouping-and-performance)
  - [5.11 Workspace and layout](#511-workspace-and-layout)
  - [5.12 Accessibility and keyboard-first operation](#512-accessibility-and-keyboard-first-operation)
  - [5.13 Onboarding](#513-onboarding)
  - [5.14 Plugin architecture](#514-plugin-architecture)
- [6. Sequencing](#6-sequencing)
- [7. What we are deliberately not doing](#7-what-we-are-deliberately-not-doing)
- [8. Open questions](#8-open-questions)
- [9. Sources](#9-sources)

---

## 1. Why this document exists

Through v1, the Inspector was a **follow-along project**. The spec moved, we chased it, and
whatever planning capacity remained went to keeping up rather than to the tool's own design.
Every release was reactive by necessity.

That constraint has lifted. v2 meets the 2026-07-28 spec across all three clients (the open gaps are in official extensions, not the base protocol: the Tasks-extension `Mcp-Name` header, #1917, waits on an SDK release, and the rest are tracked in §4), on SDK v2,
with a shared `core/`, a ≥90% per-file coverage gate, and a smoke/e2e apparatus that catches
packaging failures. For the first time we can spend planned effort on **what the Inspector
should be**, not only on what the spec just became.

This document splits the next six months into those two kinds of work, so that neither
starves the other. The explicit intent is a **roughly even split of capacity** — spec-following
work is non-negotiable but bounded, and the remaining capacity is ours to direct.

> **Sourcing note.** The first draft (#1980) was written when the MCP roadmap could not be read
> directly, and was built from the 2026-03-05 public page plus WG charters. This revision (#2400)
> re-aligns §3 with the **published** roadmap at
> [`modelcontextprotocol.io/development/roadmap`](https://modelcontextprotocol.io/development/roadmap),
> last updated **2026-08-22**, which organizes the next spec cycle into five priority areas —
> §3.1 to §3.5 follow them one to one. The roadmap itself states it "reflects current thinking
> rather than firm commitments" and carries **no per-item dates**, only a "six to twelve months"
> window, so the phase placements in §6 remain our estimate. It also adds §4, a standing
> section for **official extensions**, which the roadmap does not list and which we must track
> separately.

### Already shipped since the first draft

Worth recording, because much of the first draft's "build now" list is done and should not
be re-planned:

| Item                                                                                        | Issue(s)                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Last-Event-ID` resumption (legacy Streamable HTTP only; the 2026-07-28 era removed SSE resumability)                                                                  | [#920](https://github.com/modelcontextprotocol/inspector/issues/920)                                                                                                                                                                                                                                                                                                                                                                           |
| `server.json` support                                                                       | [#922](https://github.com/modelcontextprotocol/inspector/issues/922)                                                                                                                                                                                                                                                                                                                                                                           |
| Discover checkmarks for task extensions                                                     | [#1887](https://github.com/modelcontextprotocol/inspector/issues/1887)                                                                                                                                                                                                                                                                                                                                                                         |
| Tool-schema portability lint (`--strict`)                                                               | [#1005](https://github.com/modelcontextprotocol/inspector/issues/1005), [#1015](https://github.com/modelcontextprotocol/inspector/issues/1015)                                                                                                                                                                                                                                                                                                 |
| The argument editor workstream (all six issues)                                             | [#1853](https://github.com/modelcontextprotocol/inspector/issues/1853), [#1856](https://github.com/modelcontextprotocol/inspector/issues/1856), [#1885](https://github.com/modelcontextprotocol/inspector/issues/1885), [#1928](https://github.com/modelcontextprotocol/inspector/issues/1928), [#1919](https://github.com/modelcontextprotocol/inspector/issues/1919), [#1910](https://github.com/modelcontextprotocol/inspector/issues/1910) |
| Connection fixes (version-negotiation DX, dev containers, ghost entry) and self-signed `https://localhost` guidance (documented trust configuration, not a code fix) | [#962](https://github.com/modelcontextprotocol/inspector/issues/962), [#1936](https://github.com/modelcontextprotocol/inspector/issues/1936), [#1951](https://github.com/modelcontextprotocol/inspector/issues/1951), [#1914](https://github.com/modelcontextprotocol/inspector/issues/1914)                                                                                                                                                   |
| Server config: paste-JSON, custom headers, auth URL overrides, file-backed secrets          | [#904](https://github.com/modelcontextprotocol/inspector/issues/904), [#1915](https://github.com/modelcontextprotocol/inspector/issues/1915), [#1906](https://github.com/modelcontextprotocol/inspector/issues/1906), [#1950](https://github.com/modelcontextprotocol/inspector/issues/1950)                                                                                                                                                   |
| IdP OIDC option (EMA itself, #1509, predates the first draft) | [#1937](https://github.com/modelcontextprotocol/inspector/issues/1937)                                                                                                                                                                                                                                                                                                 |
| Skills over MCP (SEP-2640) across web, CLI and TUI                                          | [#2234](https://github.com/modelcontextprotocol/inspector/issues/2234), [#2248](https://github.com/modelcontextprotocol/inspector/issues/2248)                                                                                                                                                                                                                                                                                                 |

Closed as **not planned**, so not carried forward: custom transports ([#1741](https://github.com/modelcontextprotocol/inspector/issues/1741)), the configurable-proxy base ([#1684](https://github.com/modelcontextprotocol/inspector/issues/1684)), the readiness summary ([#1916](https://github.com/modelcontextprotocol/inspector/issues/1916)), full panel collapse ([#928](https://github.com/modelcontextprotocol/inspector/issues/928)), `*.localhost` domains ([#1944](https://github.com/modelcontextprotocol/inspector/issues/1944)), and the trusted-local-host OAuth HTTP exception ([#1911](https://github.com/modelcontextprotocol/inspector/issues/1911)).

---

## 2. The two tracks

|                             | **Track A — Spec-following**                                      | **Track B — Experience**                    |
| --------------------------- | ----------------------------------------------------------------- | ------------------------------------------- |
| **Driver**                  | MCP roadmap, WG deliverables, SEP acceptance, approved extensions | Our own judgment about the tool             |
| **Trigger to start**        | A SEP reaches Draft with a Tier-1 SDK reference impl, or is Final; or an extension is approved as official (§4) | Whenever we have capacity                   |
| **Risk**                    | Slips when upstream slips; we cannot control the date             | We control the date entirely                |
| **Failure mode if starved** | Inspector stops being the reference test client                   | Inspector stays a protocol dump, not a tool |
| **Target capacity**         | ~50%                                                              | ~50%                                        |

The two tracks are not independent. Several Track B items — the timeline, session
record/replay, diff — are **force multipliers for Track A**: each new protocol feature
arrives with a rendering problem, and a general timeline plus a general diff is cheaper than
one bespoke panel per SEP. That is the core scheduling argument of this plan: **build the
general surfaces early so the spec work that lands later is cheap to display.**

### How the Inspector's role is changing

Worth stating plainly, because it shapes the priorities below. The roadmap's SDK area makes
the **conformance test suite** the source of truth that SDKs and quickstarts are validated
against, and SEP-2484 (Final) requires conformance tests for Standards Track SEPs that change observable protocol behavior to reach
Final. The Inspector is the most visible MCP client in the ecosystem and is already the thing
people reach for when a server misbehaves.

That points at an expanded role: not just _"show me the traffic"_ but _"tell me whether this
server is correct."_ Several items below (the conformance runner, assertions, cache-hint
validation, the capability diff) are steps toward that, and they should be evaluated as a
group rather than individually.

---

## 3. Track A — following the spec

§3.1–§3.5 mirror the five priority areas of the published roadmap, in its order. Each states
the upstream area, our read on what it means for the Inspector, and a concrete feature list.
**Confidence** flags how much of the list we can commit to now:

- 🟢 **Build now** — the shape is known (the SEP is Final, or the work is ours alone); blocked only on our own capacity.
- 🟡 **Design now, build on signal** — enough detail to design against; wait for a Draft SEP or a Tier-1 SDK impl before building.
- 🔴 **Watch** — too early to predict a UI; keep a tracking issue and a WG liaison.
- ✅ **Shipped** — already in the Inspector; listed for completeness, not scheduled.

### 3.1 Agentic messaging primitives

**Upstream:** Triggers & Events, Agents, and Transports WGs. Messaging beyond
request/response: work that runs for minutes, servers that push, results that stream, and
steering work mid-flight. This period: **server-initiated events** ("channels and
subscriptions for push delivery, including webhooks") and a **composition review** so Tasks,
triggers, `subscriptions/listen` and progress notifications share "a lifecycle, a cancellation
model, [and] an error surface". **Beyond this period:** Tasks (SEP-2663) toward eventual
inclusion in core.

**Read:** Two changes from the first draft. First, **Tasks moving into core is no longer a
this-period item**, so the raw-wire Tasks channel stays for the whole horizon and its
retirement drops out of the plan. Second, the composition review names the exact thing a
timeline can show better than any list: three kinds of "not done yet" work side by side. That
argues for **one lane for in-flight work** rather than a tasks lane and a subscriptions lane.

The webhook half remains the largest architectural change on the horizon for us. Every
Inspector surface assumes we initiated the connection; a webhook makes us a **server** that
must be publicly reachable, which a tool usually run on `localhost` is not. Start the design
conversation now and bring it to the WG as implementation feedback.

| Feature                                                                                                                                            | Confidence | Notes                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **In-flight work lane** — tasks, open `subscriptions/listen` streams and progress-reporting requests as spans on one timeline lane (§5.1)          | 🟢         | `subscriptions/listen` and progress are in the 2026-07-28 spec; Tasks is the official `io.modelcontextprotocol/tasks` extension (§4). Makes composition gaps (mismatched cancellation, divergent errors) visible, which the WG can use. |
| **Cancellation and error comparison** — show how each in-flight kind ended (completed, cancelled, errored, server-closed) with the same vocabulary | 🟢         | A small, direct contribution to the composition review.                                                                                           |
| **Callback receiver** — backend-hosted endpoint registered as a push target                                                                        | 🔴         | Design now, build when the SEP lands. Security review mandatory: an inbound public endpoint on a process that spawns subprocesses.                |
| **Local reachability story** — tunnel integration or documented guidance                                                                           | 🔴         | Likely the hardest UX problem of the six months.                                                                                                  |
| **Delivery log with ordering and duplicate assertions**                                                                                            | 🔴         | The conformance value: did events arrive in order? were any redelivered?                                                                          |
| **`Mcp-Name` header on Tasks over Streamable HTTP**                                                                                                | 🟡         | [#1917](https://github.com/modelcontextprotocol/inspector/issues/1917) — a current non-conformance: the fix is merged upstream but unreleased, so the pinned SDK still omits the header SEP-2663 requires. Waits on the next SDK release.                                                        |
| **Tasks extension → core migration**                                                                                                               | 🔴         | Moved to "Beyond" upstream. Keep the era-conditional exposure; the legacy `capabilities.tasks` path must keep working.                            |

### 3.2 HTTP-native transport unification and hardening

**Upstream:** Transports WG. "The 2026-07-28 release made a remote MCP server a normal HTTP
workload." The goal is **one transport model**: **HTTP over stdio** (Streamable HTTP as the
single binding, possibly HTTP/2 over stdin/stdout for multiplexing) and **caching** — SEP-2549
(Final) added `ttlMs` and `cacheScope` to list results and resource reads, with **ETags** next,
including for tool-call results. **Beyond:** standardized error handling across all surfaces,
capability scoping for tool lists after SEP-2575, and a secure way to hand servers
configuration.

**Read:** For **modern** (2026-07-28) connections, the first draft's §3.1 (stateless Streamable
HTTP, session creation / resumption / migration) is **largely obsolete**: SEP-2575 (stateless)
and SEP-2567 (sessionless) are Final and already shipped, so a session lifecycle lane has nothing
to show there. The Inspector is still a dual-era client, though, and **legacy** Streamable HTTP
keeps `initialize` and session-scoped state; a session lifecycle lane for legacy connections stays
a valid, **deferred** timeline follow-up (§5.1) rather than being dropped. Caching, on the other hand, is
Final and we already parse the fields — we just do not render them, and a client that shows
cache hints is exactly how a server author finds out theirs are wrong.

HTTP over stdio would change how every stdio server connects, and our transport layer is
where the Inspector is thinnest over the SDK. Watch closely.

| Feature                                                                                                                                                       | Confidence | Notes                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cache hint display** — `ttlMs` / `cacheScope` on the SEP-2549 surfaces (`tools/list`, `prompts/list`, `resources/list`, `resources/templates/list`, `resources/read`), plus modern (2026-07-28+) `skills/list` and `skills/get`, which the stable ext-skills spec requires to carry both fields (both validated as required on modern connections since [#2404](https://github.com/modelcontextprotocol/inspector/issues/2404)); legacy results do not require the fields but are shown when a server sends them, with freshness countdown and "stale" marking                                 | 🟢         | SEP-2549 is Final. The runtime parses the hints everywhere and honors them through the SDK cache for the four `*/list` methods; `resources/read`, `skills/list` and `skills/get` go through plain requests that validate but do not honor them, so this item includes that plumbing as well as the display.                                                                 |
| **Cache behavior observations** — note a re-fetch of a still-fresh result, and a list that changed inside its declared TTL, as diagnostics rather than errors | 🟢         | Inspector-shaped: nobody else observes both the hint and the reality. `ttlMs` is a freshness hint, so both are compliant.                                                                    |
| **Stateful-tool workflow investigation** — how to help a user carry an SEP-2567-style handle from one tool result into the next call                          | 🟡         | Replaces the first draft's "session lifecycle lane". The protocol has no concept of a handle (it is ordinary tool data), so a generic view would be inference; investigate before designing. |
| **ETag support** — send `If-None-Match`, show 304s and version changes                                                                                        | 🔴         | Watch until a SEP reaches Draft with an SDK impl.                                                                                                                                           |
| **HTTP over stdio**                                                                                                                                           | 🔴         | Watch. If it lands, the Network screen becomes meaningful for stdio servers too — a large win.                                                                                               |
| **Standardized error rendering**                                                                                                                              | 🔴         | "Beyond". Our Protocol-vs-Network error split (#1628) is the seam to adopt it into.                                                                                                          |

### 3.3 Agent identity and enterprise-ready security

**Upstream:** Agent Identity WG (forming this period), coordinated with the IETF OAuth and
WIMSE WGs. MCP authorization assumes a person at a browser; increasingly the caller is an
agent. This period: **finalize DPoP** and drive adoption; an opinionated **agent identity and
delegation** model built on **Workload Identity Federation** ([SEP-1933](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1933)), **ID-JAG** as used by
Enterprise-Managed Authorization, and **RFC 8693 token exchange**. **Beyond:**
human-presence attestation.

**Read:** DPoP was 🔴 in the first draft and is now a named deliverable, so it moves up. Our
EMA work (#1509) already gives us the ID-JAG leg, which makes the Inspector a credible test
client for the whole identity chain. The first draft's audit trails and gateway mode are **no longer on the MCP roadmap**, and
configuration ("providing servers with configuration options in a secure way") is now a
"Beyond" item (§3.2), outside this horizon; OTLP export and the audit
transcript are still worth building, but as our own Track B work (§5.7), not as spec-following.

| Feature                                                                                            | Confidence | Notes                                                                                           |
| -------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------- |
| **OAuth Client Credentials extension** — client-secret and JWT-bearer assertion flows              | 🟢         | An **approved** official extension (§4) we do not support. No upstream dependency.              |
| **Token exchange (RFC 8693) test flow**                                                            | 🟡         | Named in the roadmap; the RFC is stable, the MCP profile of it is not.                          |
| **DPoP** — generate a proof key, send `DPoP` proofs, show proof/nonce exchange in the Network view | 🟡         | Design against [SEP-1932](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1932); build when it is Final or has a Tier-1 SDK impl.                       |
| **Workload Identity Federation**                                                                   | 🟡         | SEP-1933. Needs a way to present a workload credential from a developer machine — design first. |
| **Human-presence attestation**                                                                     | 🔴         | "Beyond".                                                                                       |

### 3.4 Improved primitives

**Upstream:** Core Primitives WG (forming this period); File Uploads WG. This period: a
**`tools/call` result-shape redesign** to resolve the `content` vs `structuredContent`
confusion; **progressive discovery**, where clients learn tools and resources as needed
instead of ingesting the whole catalog, interacting with the caching work; and a review of
**primitive annotations** (audience and priority), which "most implementers haven't adopted"
and which may be deprecated. The File Uploads WG continues on **scoped file operations and
filesystem-like resource semantics** (range reads, hierarchical listing).

**Read:** Every item here touches a panel we own. The result-shape redesign rewrites the tool
result view; progressive discovery breaks the assumption behind every list we render (that
`*/list` returns everything); and a possible annotation deprecation means we should not invest
in richer annotation rendering now. The first draft's §3.6 (streamed and reference results)
and §3.8 (the SEP-2356 file picker) are **not prioritized deliverables for this period** — the
roadmap mentions "results that stream" only in framing — so they move to watch.

What we _can_ do now is show one concrete symptom of the problem the redesign is solving: a
server that returns `structuredContent` without the serialized-JSON text block the spec asks
for can hide its structured data from older clients today.

| Feature                                                                                                                                                                                     | Confidence | Notes                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Serialized-JSON check for `structuredContent`** — when a result carries `structuredContent`, flag the absence of a `TextContent` block holding its serialized JSON, the one relationship the spec defines (a SHOULD, "for backwards compatibility"). Reported as a diagnostic, never an error; any other text is a legitimate summary and is not compared | 🟢 | Useful today, and implementation evidence for the Core Primitives WG. A missing `structuredContent` under a declared `outputSchema` is already flagged by `validateToolOutput` (shipped). |
| **New tool result shape**                                                                                                                                                                   | 🔴         | WG still forming. Keep both renderings behind the era seam when it lands.                                                |
| **Progressive discovery**                                                                                                                                                                   | 🔴         | Design the lists (§5.10) so "not loaded yet" is a state, not an empty list.                                              |
| **Annotation-driven confirmation** before a `destructiveHint` call                                                                                                                          | 🟢         | Tool annotations are not the audience/priority content annotations under review. Small and obviously correct.            |
| **Richer audience / priority annotation rendering**                                                                                                                                         | 🔴         | Paused: may be deprecated.                                                                                               |
| **Range reads and hierarchical resource listing**                                                                                                                                           | 🟡         | We already render `resources/directory/read` for Skills (#2248); generalize it when the File Uploads WG publishes a SEP. |

### 3.5 Improved SDK developer experience

**Upstream:** SDK WG with the Core Maintainers. This period: **the extension contract** —
which role an extension binds (host, client, server, agent), what each does when the
capability is declared, what SDKs must support natively, packaging, and capability additions
as versioned changes; and **the generated-artifacts experiment** — generate a Tier-1 SDK and its
quickstarts from the spec, validated against the conformance suite.

**Read:** The extension contract decides how we present extensions: today our capability view
lists advertised extension ids, and a contract that names roles and versions gives us
something to validate declarations against. The generated-artifacts experiment makes the
conformance suite central, which strengthens §3.6.

| Feature                                                                                                                        | Confidence | Notes                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------- |
| **Extension declaration view** — for each advertised extension: identifier, settings object, whether the Inspector supports it | 🟢         | Buildable on today's negotiation (#1738); extend with role and version once the contract lands. |
| **Extension contract validation**                                                                                              | 🟡         | Validate a server's declaration against the contract once published.                            |
| **Run generated quickstart servers as fixtures**                                                                               | 🔴         | If the experiment publishes them, they are free test servers.                                   |

### 3.6 Conformance and validation

**Upstream:** Standing investment rather than a priority area — the conformance suite, SDK
tiers ([SEP-1730](https://modelcontextprotocol.io/seps/1730-sdks-tiering-system)), and
[SEP-2484](https://modelcontextprotocol.io/seps/2484-conformance-tests-required-for-final-seps)
(Final), which requires conformance tests for Standards Track SEPs that change observable protocol behavior to reach Final. §3.5 makes
the suite the validation target for generated SDKs.

**Read:** A conformance suite needs a driver and a report. We are the natural driver, and we
already have a CLI that exits non-zero. The runner itself needs agreement with the suite's
maintainers on a programmatic interface; the **assertion engine** it would share with §5.6
does not.

| Feature                                                                                           | Confidence | Notes                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Conformance runner** — run the suite against a connected server, render pass/fail per assertion | 🟡         | **Action: open a conversation with the conformance maintainers.** Build the shared assertion engine (§5.6) first.                                         |
| **`mcp-inspector --conformance` for CI**                                                          | 🟡         | Same engine, CLI report, exit code.                                                                                                                       |
| **Tool-schema portability lint (`--strict`)** — not a full JSON Schema validator | ✅ | Shipped — [#1005](https://github.com/modelcontextprotocol/inspector/issues/1005), [#1015](https://github.com/modelcontextprotocol/inspector/issues/1015). |

### 3.7 Off the published roadmap — watch only

The first draft planned build work for several WG efforts that are not priority deliverables in
the 2026-08-22 roadmap (some, such as streamed results, appear only in its framing). They are not cancelled upstream — WGs keep working outside the priority areas — but the
roadmap says SEPs outside those areas "expect a longer queue", so **we do not schedule build
work for them this horizon**. Each keeps a tracking issue and a liaison.

| Effort                                                | First-draft plan                                             | Now                                                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Server Cards** (SEP-2127)                           | Card preview, card-vs-reality diff, `--card-lint` in Phase 3 | 🔴 Watch. [#1857](https://github.com/modelcontextprotocol/inspector/issues/1857)'s **registry** half does not depend on it (§5.9). |
| **Interceptors** ([SEP-2624](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2624); originally SEP-1763)                           | Test bench, audit mode, CLI invocation in Phase 4            | 🔴 Watch. The WG's unowned "CLI client for interceptor invocation" is still worth raising (§8).                                    |
| **Primitive grouping** (IG)                           | Grouped sidebars                                             | The **UX** half proceeds as Track B (§5.10) on client-side heuristics; no spec data source is expected this horizon.               |
| **Streamed and reference results**                    | Incremental rendering, reference handles                     | 🔴 Watch. Planned payload truncation (§5.10) will cover the large-result case; result views render full payloads today.                                                          |
| **File picker from `FileInputDescriptor`** (SEP-2356) | `SchemaForm` + elicitation picker                            | 🔴 Watch. The File Uploads WG's published direction is now filesystem-like resources (§3.4).                                       |
| **Gateways, audit trails** | Gateway mode; OTLP as spec work | Gateway mode dropped. OTLP and the audit transcript continue as Track B (§5.7). (Secure server configuration is not off the roadmap: it is a "Beyond" item, §3.2; our rich server configuration and registry browsing, #1857, continue in §5.9.)                                                    |

---

## 4. Official extensions

The MCP roadmap mentions Tasks (§3.1) but carries no inventory of official extensions, and **approved extensions are spec-following work** —
a client that ignores them stops being a reference client. The list lives at
[`/extensions/overview`](https://modelcontextprotocol.io/extensions/overview); implementations
are recorded in the community-maintained
[client matrix](https://modelcontextprotocol.io/extensions/client-matrix), and extensions reach
official status through the Extensions Track of
[SEP-2133](https://modelcontextprotocol.io/seps/2133-extensions), optionally after incubating in an
`experimental-ext-*` repository (encouraged, not required).

### Current support (as of 2026-09-17)

| Extension                        | Identifier                                                 | Web | CLI | TUI | Upstream matrix         | Notes                                                                                                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------- | --- | --- | --- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP Apps                         | `io.modelcontextprotocol/ui`                               | ✅  | —  | —   | Inspector row, cell blank | Apps tab. Columns are rendering support: rendering needs a browser, so neither CLI nor TUI renders Apps (the CLI does offer an `--app-info` metadata probe). The shared client still advertises the extension from CLI and TUI, which is a compatibility bug tracked in [#2403](https://github.com/modelcontextprotocol/inspector/issues/2403). |
| Tasks                            | `io.modelcontextprotocol/tasks`                            | 🟡  | 🟡  | 🟡  | No column in the matrix | Raw-wire channel; stays for the horizon (§3.1). All three clients are currently partial, for two separate reasons. (1) Over Streamable HTTP, the shared `InspectorClient` sends modern `tasks/*` requests without the `Mcp-Name` header SEP-2663 requires, so strict servers reject them; stdio is unaffected. It is fixed once the upstream SDK change tracked by #1917 is released. (2) CLI and TUI have no user-facing task surface: `mcp-inspector --cli` rejects `tasks/*` (they are not in `ONE_SHOT_METHODS`), and the TUI has no Tasks pane. #1917 does not change that. |
| Skills over MCP                  | `io.modelcontextprotocol/skills`                           | ✅  | ✅  | ✅  | "Partial" (CLI README)  | [#2234](https://github.com/modelcontextprotocol/inspector/issues/2234), [#2248](https://github.com/modelcontextprotocol/inspector/issues/2248). Checks mean the inspection surface is complete (list, get, digest and frontmatter verification), including the cache fields the stable spec requires on modern `skills/list` and `skills/get` results ([#2404](https://github.com/modelcontextprotocol/inspector/issues/2404)). Host behaviors (activation, per-skill consent, content-bound approval) are out of scope by design, since the Inspector is not a host (`core/mcp/skills.ts`); that is also why the upstream matrix says "Partial".                                                                 |
| Enterprise-Managed Authorization | `io.modelcontextprotocol/enterprise-managed-authorization` | ✅  | 🟡  | 🟡  | Inspector row, cell blank | [#1509](https://github.com/modelcontextprotocol/inspector/issues/1509). CLI and TUI have no in-client Client Settings surface; they consume the `client.json` / `mcp.json` and keychain state the web settings flows write (or hand-edited files), and terminal EMA follow-ups remain (`specification/v2_auth_ema.md`).                                                                                                                                         |
| OAuth Client Credentials         | `io.modelcontextprotocol/oauth-client-credentials`         | ❌  | ❌  | ❌  | Inspector row, cell blank | **Gap** (§3.3). [#1225](https://github.com/modelcontextprotocol/inspector/issues/1225) was closed only because v1 is frozen.                                                                                    |

**Actions:** implement OAuth Client Credentials; and, with maintainer sign-off, open a PR on
`modelcontextprotocol/modelcontextprotocol` to update the Inspector row. That matrix has one row per product,
so it cannot represent the Inspector's separate Web, CLI and TUI clients: mark Apps as partial with a link explaining the split (Apps renders in
Web only; the CLI has a metadata probe), or propose separate Web/CLI/TUI rows. Enterprise Auth can be a plain check; Skills stays "Partial" upstream, because the Inspector is not a host. The same PR should propose a **Tasks** column: Tasks is an official extension the matrix cannot currently represent at all.

### Keeping up as extensions are approved

We picked up Skills because someone noticed, not because anything told us. Make it a
mechanism, the way SDK releases already are:

- **An extension-watch sweep**, modelled on `scripts/sdk-watch.mjs`: on a schedule, treat
  `/extensions/overview` as the authoritative set of official extensions (Tasks, for one, has no
  `ext-*` repository), enumerate the org's `experimental-ext-*` repositories to discover
  experimental entries and `ext-*` repositories only to enrich official ones, and read each extension's identifier from its own specification or repository (the
  overview lists names and links, not identifiers), and file one issue per entry it has not filed before. As in the SDK watch, the **issue markers
  are the source of truth** for idempotency: an entry whose marker is on an existing issue (open or
  closed) authored by the automation is skipped, so nothing needs committing back. It **files
  issues, never PRs**. Two details are left to the sweep's own design issue: which labels a trusted
  marker issue must also carry (as `sdk-watch` requires), and the first-run bootstrap for extensions
  already tracked by hand-filed issues (Apps #1740, Tasks #1887, Skills #2234, EMA #1509), so that it does not file duplicates. OAuth Client Credentials is the exception: its only hand-filed issue, #1225, was closed on the frozen v1 line, so a new v2 issue is filed for it deliberately, cross-referencing #1225.
- **Official extension** → a `v2` + `enhancement` issue to implement it, filed with the current milestone as `sdk-watch` does; only when no dated milestone is open is it left unmilestoned for triage to place in Incoming.
- **Experimental extension** → a `v2` + `question` tracking issue, filed **unmilestoned and
  unboarded** so triage places it in Incoming (the documented exception for unapproved work); it
  gets a milestone only if a maintainer approves design work against it before its SEP.
- **This table is maintainer-maintained.** The sweep never edits it; a maintainer adds a row when
  an extension's issue is triaged and moves its cells as support lands.

---

## 5. Track B — experience work we choose

No item here waits on a SEP or another project to **start**. Some later parts depend on each other or on Track A (for example, cross-server timeline correlation needs §5.11, and the assertion engine is shared with §3.6). Ordered by leverage, not by effort.

### 5.1 The zoomable timeline (headline)

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
  `client → server` · `server → client` · notifications · **in-flight work** (tasks, subscriptions, progress — §3.1) · OAuth/auth · errors
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

**Deliberately out of scope for v1 of this feature:** cross-server correlation (needs §5.11),
and OTLP-shaped nesting (needs §5.7).

### 5.2 Session record, replay, and share

Save a complete session — protocol log, network log, server config, negotiated capabilities —
to a single file. Reopen it later, on another machine, with no server running. Attach it to a
bug report.

This changes issue triage from "works on my machine" into an artifact, and it is the same
serialization format as the audit transcript (§5.7) — **build the format once**. Replay also
gives us fixtures: a recorded session is a regression test.

### 5.3 Diff and compare

Two sessions, or two servers, side by side. Concretely:

- **Capability diff** — reconnect after changing your server, see exactly what moved in
  `tools/list` / `resources/list` / `prompts/list`. ([#1034](https://github.com/modelcontextprotocol/inspector/issues/1034))
- **Session diff** — same calls, two servers, what differed.
- **Payload diff** — before/after for any pair of JSON documents.

The payload differ is a **shared primitive**: capability diff, session diff, the cache checks
(§3.2) and any later card-vs-reality or interceptor view are the same widget with different
inputs. Build it as a component first, then wire the consumers.

### 5.4 Command palette and global search

`⌘K` to jump to any server, tool, resource, or prompt; re-run the last call; switch tabs. Plus
full-text search across the protocol log with a real filter syntax (`method:tools/call
status:error duration:>500ms`). The Inspector is currently a mouse-driven app; for a developer
tool that is a daily tax.

### 5.5 Saved calls and collections

Name a tool call with its arguments, save it, re-run it, parameterize it, share it. A
Postman-collection model for MCP. The single most requested shape of workflow improvement for
any protocol client, and it composes directly with §5.6.

### 5.6 Assertions and CI flows

Attach expectations to a saved call — result matches schema, field equals value, latency under
a bound — and run the collection from the CLI with a non-zero exit on failure. This turns the
Inspector from an interactive tool into part of a server author's test suite, and it shares an
engine with the conformance runner (§3.6).

### 5.7 Observability export

Moved here from the first draft's enterprise section: the roadmap no longer lists audit trails,
but we hold the entire session and cannot export it in any pipeline-shaped form.

- **OTLP export** — emit the session as OpenTelemetry spans; show trace/span ids from `_meta`
  (SEP-414) inline; "copy as trace".
- **Structured audit transcript** — the §5.2 session file, documented as a stable format.

### 5.8 Connection Doctor

The connection fixes listed in §1 have shipped (and #1944 and #1911 were closed as not planned), but a failure is still reported as a
single error. Run an ordered checklist on failure — DNS · TCP · TLS (including local-cert
cases) · `/.well-known` discovery · protocol version negotiation · auth — and report **which
step failed and what to do about it**. First-connection success is the entire first impression
of the tool.

### 5.9 Server management and portability

Most of the first draft's list has shipped (§1). What remains is
[#1857](https://github.com/modelcontextprotocol/inspector/issues/1857), rich server configuration,
whose **registry** half — browse an MCP Registry, pick a server, generate its configuration
form from `server.json` — needs nothing but the Registry API and our existing `server.json`
support (#922). Its Server Card half waits on SEP-2127 (§3.7).

### 5.10 Large servers: grouping and performance

A 1000-tool server or a long-running session should not degrade.

- **Grouped / tree lists with group-aware search**, built on client-side heuristics (name
  prefixes, annotations). No spec data source is expected this horizon (§3.7).
- **Virtualize** the long lists and logs; cap in-memory protocol history with spill-to-disk, so evicted entries still reach the §5.2 session file; truncate large
  payloads by default with explicit expansion.
- Design lists so **"not loaded yet" is a state**, ready for progressive discovery (§3.4).

### 5.11 Workspace and layout

Multiple servers side by side — the actual shape of debugging a gateway, or comparing a
server against a reference implementation. Detachable/resizable panels, remembered layout per
server, and density modes. Prerequisite for cross-server timeline correlation.

### 5.12 Accessibility and keyboard-first operation

Full keyboard operation across every tab, correct roles and labels, high-contrast support,
and `prefers-reduced-motion` (which the timeline's animations will make newly relevant). We
have a Storybook a11y harness already; the gap is coverage, not tooling.

### 5.13 Onboarding

A first run currently presents an empty server list and no path forward. Add a guided first
connection, one-click example servers drawn from `test-servers/`, and inline links from each
panel to the relevant spec section.

### 5.14 Plugin architecture

[#1025](https://github.com/modelcontextprotocol/inspector/issues/1025) recorded the placeholder
spec. The multiplier on everything above — custom panels and community-contributed views
without core changes. Sequenced late deliberately: designing a plugin API before the timeline,
diff, and session format exist would mean designing it against the wrong surfaces.

---

## 6. Sequencing

Four phases of roughly six weekly milestones each. Track A items appear where their upstream
signal is expected; Track B items are placed to unblock Track A wherever possible. Phase 1 is
annotated with a selection of what has already shipped; §1 has the full list.

### Phase 1 — Foundations (~`v2.2` – `v2.9`, Aug–Sep 2026)

- ✅ `Last-Event-ID` resumption, legacy only (#920); discover checkmarks (#1887); `server.json` (#922)
- ✅ Argument editor workstream (six issues); connection fixes (§1)
- ✅ Skills over MCP (#2234, #2248)
- 🅑 **Zoomable timeline v1** — carried into Phase 2
- 🅑 **Connection Doctor** (§5.8) — carried into Phase 2

### Phase 2 — Artifacts, comparison, and cheap spec wins (~`v2.10` – `v2.15`, Oct–Nov 2026)

_Make sessions into things you can keep, share, and compare; take the Final-SEP and extension
items that need no upstream work._

- 🅑 **Zoomable timeline v1**, including the **in-flight work lane** (§3.1)
- 🅑 **Session record / replay / share** (§5.2) — format shared with the audit transcript
- 🅑 **Diff primitive** (§5.3) — then capability diff (#1034)
- 🅑 **Command palette and global search** (§5.4); **Connection Doctor** (§5.8)
- 🅐 **Cache hint display and observations** (§3.2) — SEP-2549 is Final
- 🅐 **OAuth Client Credentials extension** (§3.3, §4)
- 🅐 **Serialized-JSON check for `structuredContent`** and **destructive-call confirmation** (§3.4)
- 🅐 **Extension-watch sweep** (§4)

### Phase 3 — Automation (~`v2.16` – `v2.21`, Nov 2026 – Jan 2027)

_Turn the Inspector into something you can run in CI._

- 🅑 **Saved calls / collections** (§5.5) → **assertions and CI flows** (§5.6)
- 🅐 **Conformance runner** (§3.6) — shares the assertion engine, if the maintainers agree an interface
- 🅑 **OTLP export** (§5.7); **registry browsing** (§5.9)
- 🅑 **Grouping and performance at scale** (§5.10); accessibility pass (§5.12)
- 🅐 **Stateful-tool workflow investigation** (§3.2); **extension declaration view** (§3.5)

### Phase 4 — Frontier (~`v2.22` – `v2.27`, Jan–Feb 2027)

_The items whose shape we cannot yet commit to, plus the multiplier._

- 🅐 **DPoP**, **token exchange**, **Workload Identity Federation** (§3.3) — as each reaches Final or a Tier-1 SDK impl
- 🅐 **Server-initiated events receiver** (§3.1) — design throughout, build only if the SEP lands
- 🅐 **ETags** (§3.2), only if a SEP reaches Draft with an SDK impl; **extension contract validation** (§3.5), only once the contract is published
- 🅑 **Plugin architecture** (§5.14) — designed against surfaces that now exist
- 🅑 Workspace and layout (§5.11); onboarding (§5.13)

### Standing commitments across all phases

- **Weekly milestone cadence** and the pre-push gate (`npm run local:gate`) are unchanged.
- **Bug and triage capacity is reserved, not scheduled.** The board's Incoming queue keeps
  flowing regardless of phase.
- **Re-read the MCP roadmap when it changes.** It carries a "Last updated" date; a change there
  is the trigger to revisit §3 and §6, the way #2400 revisited this draft.
- **WG liaison**: attend Triggers & Events, Transports, Agents, Agent Identity, Core Primitives,
  and SDK sessions and feed implementation experience back. Several items above are as much
  _inputs to_ the spec as outputs of it.

---

## 7. What we are deliberately not doing

Stating these so they are decisions rather than oversights.

- **Not building bespoke panels per SEP.** Where a new feature can render into the timeline,
  the diff, or the session format, it does. A new top-level tab needs justification.
- **Not chasing pre-Draft SEPs.** 🔴 items get a tracking issue and a WG liaison, not code.
  We were burned by this in v1.
- **Not scheduling build work outside the published priority areas** (§3.7). A WG effort that
  the roadmap does not list gets a liaison, not milestones. Approved official extensions (§4)
  are exempt: they count as spec-following work even though the roadmap does not list them.
- **Not publishing `core/` as a package this cycle.** [#1636](https://github.com/modelcontextprotocol/inspector/issues/1636) stays deferred; it adds an API
  compatibility obligation we cannot yet afford.
- **Not adding transports beyond what the spec blesses.** Custom transports were closed as not
  planned ([#1741](https://github.com/modelcontextprotocol/inspector/issues/1741)).
- **Not investing in audience/priority annotation rendering** while their deprecation is under
  review (§3.4).
- **Not building a second extension mechanism.** Anything pluggable runs on the plugin
  architecture (§5.14).

---

## 8. Open questions

For WG discussion.

1. **Do we claim the Interceptors WG's "CLI client for interceptor invocation and testing"?**
   It is unowned and describes our CLI, but Interceptors is no longer on the published roadmap
   (§3.7). If yes, it needs its own allocation rather than borrowed Phase 4 capacity.
2. **How far do we take the conformance role?** §3.6 and §5.6 point at "the Inspector tells
   you whether your server is correct." With conformance now central to the SDK area (§3.5),
   that is worth an explicit yes or no, and possibly a charter amendment.
3. **Who owns the server-initiated events reachability problem?** A publicly reachable
   callback endpoint on a localhost dev tool is a security question as much as a UX one, and
   it needs an owner before Phase 4.
4. **Should the Inspector feed the composition review directly?** The in-flight work lane
   (§3.1) produces exactly the evidence the review needs; decide whether we bring it to the
   Agents / Triggers & Events WGs as a demo.
5. **Is the ~50/50 capacity split right?** It is an assertion in this draft, not a measurement.
6. **Timeline v1 scope.** The §5.1 sketch is deliberately broad. Which parts are v1 and which
   are follow-ups should be settled before it starts.

---

## 9. Sources

- [MCP Roadmap](https://modelcontextprotocol.io/development/roadmap) (last updated 2026-08-22)
- [Extensions overview](https://modelcontextprotocol.io/extensions/overview) · [Extension support matrix](https://modelcontextprotocol.io/extensions/client-matrix) · [SEP-2133: Extensions](https://modelcontextprotocol.io/seps/2133-extensions)
- Final SEPs cited: [SEP-2549 (TTL for list results)](https://modelcontextprotocol.io/seps/2549-TTL-for-list-results) · [SEP-2567 (sessionless)](https://modelcontextprotocol.io/seps/2567-sessionless-mcp) · [SEP-2575 (stateless)](https://modelcontextprotocol.io/seps/2575-stateless-mcp) · [SEP-2663 (Tasks extension)](https://modelcontextprotocol.io/seps/2663-tasks-extension) · [SEP-2640 (Skills extension)](https://modelcontextprotocol.io/seps/2640-skills-extension) · [SEP-2484 (conformance tests)](https://modelcontextprotocol.io/seps/2484-conformance-tests-required-for-final-seps) · [SEP-414 (request `_meta`, trace context)](https://modelcontextprotocol.io/seps/414-request-meta)
- WG charters: [Inspector V2](https://modelcontextprotocol.io/community/working-groups/inspector-v2) · [Triggers & Events](https://modelcontextprotocol.io/community/working-groups/triggers-events) · [Agents](https://modelcontextprotocol.io/community/working-groups/agents) · [Transports](https://modelcontextprotocol.io/community/working-groups/transports) · [File Uploads](https://modelcontextprotocol.io/community/working-groups/file-uploads) · [SDK](https://modelcontextprotocol.io/community/working-groups/sdk)
- [SDK tiers and conformance testing](https://modelcontextprotocol.io/community/sdk-tiers)
- Internal: [`specification/v2_new_spec_impact.md`](../specification/v2_new_spec_impact.md) · [`specification/v2_scope.md`](../specification/v2_scope.md) · [`specification/v2_ux_features.md`](../specification/v2_ux_features.md)
- [Inspector V2 project board (#28)](https://github.com/orgs/modelcontextprotocol/projects/28)
