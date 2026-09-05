/**
 * Skills extension test fixture — SEP-2640 (`io.modelcontextprotocol/skills`).
 *
 * Serves `skills/list` (paginated) and `skills/get`, plus `resources/read` for
 * the `skill://` URIs those entries name, so an Inspector connected here can
 * exercise the whole flow: enumerate, fetch a file, and verify its digest.
 *
 * **The non-conforming skills are the point.** A fixture that only served a
 * clean skill would leave every verification and conformance path in the
 * Inspector untestable, so the set below deliberately includes one `"dynamic"`
 * skill, one whose advertised digest does not match the bytes served, and one
 * whose URI path segment disagrees with `frontmatter.name`. Each is the exact
 * shape one of the checks in `core/mcp/skills.ts` exists to catch.
 *
 * Handlers are installed straight into the low-level `_requestHandlers` map
 * rather than through `setRequestHandler`, the same seam `modern-tasks.ts`
 * uses. `skills/*` are consumer-owned extension methods that neither era codec
 * defines, so they need no schemas and are era-blind in both directions —
 * which is what lets one fixture serve both the legacy and modern legs.
 */

import { createHash } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/server";

/** SEP-2133 extension identifier for the Skills extension (SEP-2640). */
export const SKILLS_EXTENSION_KEY = "io.modelcontextprotocol/skills";

/**
 * Entries per `skills/list` page. Two, deliberately: the fixture serves four
 * skills, so a client that stops after page one sees half the set — which is
 * what makes a broken cursor walk visible rather than merely slower.
 */
export const SKILLS_PAGE_SIZE = 2;

/** `sha256:<64 lowercase hex>` over a UTF-8 string, the SEP's digest form. */
function digestOf(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/** Byte length of a UTF-8 string, for the manifest's `size`. */
function sizeOf(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

interface FixtureFile {
  uri: string;
  text: string;
  mimeType: string;
  /**
   * Digest to *advertise*, when it should differ from the real one. The
   * tampered skill sets this; everywhere else the advertised digest is
   * computed from the very bytes served, so a clean skill verifies.
   */
  advertisedDigest?: string;
}

interface FixtureSkill {
  /** The `<skill-path>` segment; `skill://<path>/SKILL.md` is the entry URI. */
  path: string;
  frontmatter: Record<string, unknown>;
  /** `"dynamic"` for a generated skill with no enumerable manifest. */
  files: FixtureFile[] | "dynamic";
}

function skillMd(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}

const DATA_ANALYSIS_MD = skillMd(
  "data-analysis",
  "Analyze a CSV and summarize its columns",
  "# Data analysis\n\nLoad the CSV, then follow `reference.md` for the column rules.",
);
const DATA_ANALYSIS_REF =
  "# Column rules\n\nNumeric columns get min/max/mean; text columns get a value count.\n";

const TAMPERED_MD = skillMd(
  "tampered-notes",
  "A skill whose manifest digest does not match its served bytes",
  "# Tampered notes\n\nThe digest advertised for `notes.md` is wrong on purpose.",
);
const TAMPERED_NOTES =
  "# Notes\n\nThese bytes hash to something other than what the manifest claims.\n";

const DYNAMIC_MD = skillMd(
  "dynamic-report",
  "A skill whose files are generated per request",
  "# Dynamic report\n\nThis skill's file set is generated, so it advertises no manifest.",
);

// The frontmatter says `right-name` while the URI segment says `wrong-folder`,
// breaking the one structural invariant SEP-2640 states outright: the segment
// before /SKILL.md must equal frontmatter.name.
const MISMATCHED_MD = skillMd(
  "right-name",
  "A skill whose URI path segment disagrees with its frontmatter name",
  "# Mismatched name\n\nServed from `wrong-folder/` while claiming the name `right-name`.",
);

const FIXTURE_SKILLS: FixtureSkill[] = [
  {
    path: "data-analysis",
    frontmatter: {
      name: "data-analysis",
      description: "Analyze a CSV and summarize its columns",
    },
    files: [
      {
        uri: "skill://data-analysis/SKILL.md",
        text: DATA_ANALYSIS_MD,
        mimeType: "text/markdown",
      },
      {
        uri: "skill://data-analysis/reference.md",
        text: DATA_ANALYSIS_REF,
        mimeType: "text/markdown",
      },
    ],
  },
  {
    path: "tampered-notes",
    frontmatter: {
      name: "tampered-notes",
      description: "A skill whose manifest digest does not match its bytes",
    },
    files: [
      {
        uri: "skill://tampered-notes/SKILL.md",
        text: TAMPERED_MD,
        mimeType: "text/markdown",
      },
      {
        uri: "skill://tampered-notes/notes.md",
        text: TAMPERED_NOTES,
        mimeType: "text/markdown",
        // A syntactically valid digest of the *wrong* bytes, so the failure the
        // Inspector reports is a mismatch rather than a malformed-digest
        // finding — those are different checks and must stay distinguishable.
        advertisedDigest: digestOf("not the bytes this server serves"),
      },
    ],
  },
  {
    path: "dynamic-report",
    frontmatter: {
      name: "dynamic-report",
      description: "A skill whose files are generated per request",
    },
    files: "dynamic",
  },
  {
    path: "wrong-folder",
    frontmatter: {
      name: "right-name",
      description: "A skill whose URI segment disagrees with its name",
    },
    files: [
      {
        uri: "skill://wrong-folder/SKILL.md",
        text: MISMATCHED_MD,
        mimeType: "text/markdown",
      },
    ],
  },
];

/** Every servable `skill://` file, by URI. `dynamic` skills contribute their
 * `SKILL.md` too, so the screen's "View SKILL.md" works there as well. */
const FILES_BY_URI = new Map<string, FixtureFile>();
for (const skill of FIXTURE_SKILLS) {
  if (skill.files === "dynamic") {
    FILES_BY_URI.set(`skill://${skill.path}/SKILL.md`, {
      uri: `skill://${skill.path}/SKILL.md`,
      text: DYNAMIC_MD,
      mimeType: "text/markdown",
    });
    continue;
  }
  for (const file of skill.files) FILES_BY_URI.set(file.uri, file);
}

/** The wire entry for one fixture skill. */
function toEntry(skill: FixtureSkill): Record<string, unknown> {
  return {
    uri: `skill://${skill.path}/SKILL.md`,
    frontmatter: skill.frontmatter,
    resources:
      skill.files === "dynamic"
        ? "dynamic"
        : skill.files.map((file) => ({
            uri: file.uri,
            digest: file.advertisedDigest ?? digestOf(file.text),
            size: sizeOf(file.text),
          })),
  };
}

/** One `skills/list` page starting at `cursor` (an index, as a string). */
export function listSkillsPage(cursor?: string): Record<string, unknown> {
  const start = cursor ? Number.parseInt(cursor, 10) : 0;
  // A cursor the fixture never issued is answered as an empty final page
  // rather than an error: the Inspector's walk should terminate, and a thrown
  // error here would read as a transport failure instead.
  const from = Number.isFinite(start) && start > 0 ? start : 0;
  const page = FIXTURE_SKILLS.slice(from, from + SKILLS_PAGE_SIZE);
  const next = from + SKILLS_PAGE_SIZE;
  return {
    skills: page.map(toEntry),
    ...(next < FIXTURE_SKILLS.length ? { nextCursor: String(next) } : {}),
  };
}

/** The `skills/get` result for one entry URI. */
export function getSkillEntry(uri: string): Record<string, unknown> {
  const skill = FIXTURE_SKILLS.find(
    (candidate) => `skill://${candidate.path}/SKILL.md` === uri,
  );
  if (!skill) throw new Error(`Unknown skill uri: ${uri}`);
  // The envelope (`{ skill }`) is the conforming shape, and the only one the
  // Inspector accepts — see `GetSkillResultSchema`.
  return { skill: toEntry(skill) };
}

/** The `resources/read` result for a `skill://` file, or `undefined`. */
export function readSkillFile(
  uri: string,
): Record<string, unknown> | undefined {
  const file = FILES_BY_URI.get(uri);
  if (!file) return undefined;
  return {
    contents: [{ uri: file.uri, mimeType: file.mimeType, text: file.text }],
  };
}

/** The private handler registry the SDK dispatches through. */
interface RawHandlerHost {
  _requestHandlers: Map<
    string,
    (request: unknown, ctx: unknown) => Promise<unknown>
  >;
}

interface UriRequest {
  params?: { uri?: string; cursor?: string };
}

/**
 * Wire `skills/list`, `skills/get` and the `skill://` half of `resources/read`
 * onto an `McpServer`.
 *
 * `resources/read` is wrapped rather than replaced: a `skill://` URI is
 * answered here and everything else falls through to whatever the SDK
 * registered, so a config can serve ordinary resources alongside its skills.
 */
export function wireSkillsHandlers(mcpServer: McpServer): void {
  const registry = (mcpServer.server as unknown as RawHandlerHost)
    ._requestHandlers;

  registry.set("skills/list", async (request) => {
    const req = request as UriRequest;
    return listSkillsPage(req.params?.cursor);
  });

  registry.set("skills/get", async (request) => {
    const req = request as UriRequest;
    return getSkillEntry(req.params?.uri ?? "");
  });

  const sdkResourcesRead = registry.get("resources/read");
  registry.set("resources/read", async (request, ctx) => {
    const req = request as UriRequest;
    const skillFile = readSkillFile(req.params?.uri ?? "");
    if (skillFile) return skillFile;
    if (!sdkResourcesRead) {
      throw new Error(`Unknown resource: ${req.params?.uri}`);
    }
    return sdkResourcesRead(request, ctx);
  });
}
