import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "./helpers/renderTui";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import type { SkillEntry } from "@inspector/core/mcp/skillsSchemas.js";
import { AuthRecoveryRequiredError } from "@inspector/core/auth/challenge.js";
import { sha256Digest, textToBytes } from "@inspector/core/mcp/skills.js";

// MUST mock ink-scroll-view: the real ScrollView renders a placeholder minimap
// in the non-TTY test env and never mounts its children.
vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));

import { SkillsTab } from "../src/components/SkillsTab.js";

const tick = async () => {
  for (let i = 0; i < 8; i++)
    await new Promise((resolve) => setTimeout(resolve, 4));
};

const ESC = String.fromCharCode(27);
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;
const PAGE_UP = `${ESC}[5~`;
const PAGE_DOWN = `${ESC}[6~`;
const ENTER = "\r";

const SKILL_MD = "---\nname: clean\ndescription: A clean skill\n---\n\n# C\n";
// sha256 of SKILL_MD, so the clean fixture actually verifies.
const CLEAN_DIGEST =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000";

const clean: SkillEntry = {
  uri: "skill://clean/SKILL.md",
  frontmatter: { name: "clean", description: "A clean skill" },
  resources: [
    { uri: "skill://clean/SKILL.md", digest: CLEAN_DIGEST, size: 51 },
  ],
};
// A `name-path-mismatch`: the one structural invariant SEP-2640 states
// outright, so this row must carry the error mark.
const broken: SkillEntry = {
  uri: "skill://wrong-folder/SKILL.md",
  frontmatter: { name: "right-name", description: "Mismatched" },
  resources: [
    { uri: "skill://wrong-folder/SKILL.md", digest: CLEAN_DIGEST, size: 1 },
  ],
};
// Legal but unverifiable — a WARNING, which must read differently from an error.
const dynamic: SkillEntry = {
  uri: "skill://gen/SKILL.md",
  frontmatter: { name: "gen", description: "Generated" },
  resources: "dynamic",
};
const noSize: SkillEntry = {
  uri: "skill://nosize/SKILL.md",
  frontmatter: { name: "nosize", description: "No declared size" },
  resources: [{ uri: "skill://nosize/SKILL.md", digest: CLEAN_DIGEST }],
};

const skills = [clean, broken, dynamic, noSize];

function mockClient(
  readResource: unknown = vi.fn().mockResolvedValue({
    result: { contents: [{ uri: "skill://clean/SKILL.md", text: SKILL_MD }] },
  }),
): InspectorClient {
  return { readResource } as unknown as InspectorClient;
}

describe("SkillsTab (#2248)", () => {
  it("renders the empty state when there are no skills", () => {
    const { lastFrame } = render(
      <SkillsTab
        skills={[]}
        pageCount={0}
        inspectorClient={null}
        width={140}
        height={30}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Skills (0)");
    expect(frame).toContain("No skills available");
    expect(frame).toContain("Select a skill to view details");
  });

  it("shows the page count only when the walk took more than one page", () => {
    const one = render(
      <SkillsTab
        skills={skills}
        pageCount={1}
        inspectorClient={null}
        width={140}
        height={30}
      />,
    );
    expect(one.lastFrame() ?? "").toContain("Skills (4)");
    expect(one.lastFrame() ?? "").not.toContain("pages");
    const many = render(
      <SkillsTab
        skills={skills}
        pageCount={3}
        inspectorClient={null}
        width={140}
        height={30}
      />,
    );
    expect(many.lastFrame() ?? "").toContain("3 pages");
  });

  it("renders the list error in place of the list", () => {
    const { lastFrame } = render(
      <SkillsTab
        skills={[]}
        pageCount={0}
        loadError={new Error("walk failed")}
        inspectorClient={null}
        width={140}
        height={30}
      />,
    );
    expect(lastFrame() ?? "").toContain("walk failed");
  });

  it("marks each row with its static conformance verdict", () => {
    // The mark is a glyph, not only a colour: this pane is read over ssh, in
    // tmux and through `script(1)`, where colour may not survive.
    const { lastFrame } = render(
      <SkillsTab
        skills={skills}
        pageCount={1}
        inspectorClient={null}
        width={140}
        height={30}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("✓ clean");
    // `skillDisplayName` prefers the declared name over the URI segment.
    expect(frame).toContain("✗ right-name");
    expect(frame).toContain("! gen");
  });

  it("does not claim the listing conforms while verification is failing", async () => {
    // The two verdicts sat in one pane and contradicted each other: the static
    // checks pass on `clean` (its advertised digest is well-formed), while the
    // bytes do not hash to it. The heading now names what it actually covers.
    const { lastFrame, stdin } = render(
      <SkillsTab
        skills={[clean]}
        pageCount={1}
        inspectorClient={mockClient()}
        width={140}
        height={30}
        focusedPane="list"
      />,
    );
    stdin.write(ENTER);
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Verification FAILED");
    expect(frame).toContain("Listing checks: no structural issues");
    expect(frame).not.toContain("conforms");
  });

  it("shows the selected skill's URI, description, findings and manifest", () => {
    const { lastFrame } = render(
      <SkillsTab
        skills={skills}
        pageCount={1}
        inspectorClient={null}
        width={140}
        height={30}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("skill://clean/SKILL.md");
    expect(frame).toContain("A clean skill");
    // Named for what it covers: the static checks against the listing.
    expect(frame).toContain("Listing checks: no structural issues");
    expect(frame).toContain("Manifest (1)");
    expect(frame).toContain("SKILL.md");
    expect(frame).toContain("(51 B)");
    expect(frame).toContain("[Enter to verify digests and frontmatter]");
  });

  it("renders a dynamic skill's manifest as unadvertised rather than empty", async () => {
    const { lastFrame, stdin } = render(
      <SkillsTab
        skills={skills}
        pageCount={1}
        inspectorClient={null}
        width={140}
        height={30}
        focusedPane="list"
      />,
    );
    stdin.write(DOWN);
    await tick();
    stdin.write(DOWN);
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain('"dynamic" — no files advertised');
    expect(frame).toContain("integrity cannot be verified");
  });

  it("omits the size caption when the manifest declares none", async () => {
    const { lastFrame, stdin } = render(
      <SkillsTab
        skills={skills}
        pageCount={1}
        inspectorClient={null}
        width={140}
        height={30}
        focusedPane="list"
      />,
    );
    for (let i = 0; i < 3; i++) {
      stdin.write(DOWN);
      await tick();
    }
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Manifest (1)");
    expect(frame).not.toContain(" B)");
  });

  it("moves selection with the arrow keys and stops at both boundaries", async () => {
    const { lastFrame, stdin } = render(
      <SkillsTab
        skills={skills}
        pageCount={1}
        inspectorClient={null}
        width={140}
        height={30}
        focusedPane="list"
      />,
    );
    stdin.write(UP);
    await tick();
    expect(lastFrame() ?? "").toContain("▶ ✓ clean");
    stdin.write(DOWN);
    await tick();
    expect(lastFrame() ?? "").toContain("▶ ✗ right-name");
    for (let i = 0; i < 5; i++) {
      stdin.write(DOWN);
      await tick();
    }
    // `nosize` omits a required `size`, so its row carries the error mark too
    // — the mark tracks the checks, not the position.
    expect(lastFrame() ?? "").toContain("▶ ✗ nosize");
    // …and back up from the bottom, which is the other direction of the same
    // guard: the top boundary above never exercises the move itself.
    stdin.write(UP);
    await tick();
    expect(lastFrame() ?? "").toContain("▶ ! gen");
  });

  it("scrolls the details pane without moving the selection", async () => {
    const scrollBy = vi.fn();
    const { stdin } = render(
      <SkillsTab
        skills={skills}
        pageCount={1}
        inspectorClient={null}
        width={140}
        height={30}
        focusedPane="details"
      />,
    );
    stdin.write(UP);
    stdin.write(DOWN);
    stdin.write(PAGE_UP);
    stdin.write(PAGE_DOWN);
    await tick();
    // Nothing to assert on the mock beyond not crashing and not moving the
    // selection — the ScrollView handle is stubbed by the shared mock.
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("ignores input entirely when a modal is open", async () => {
    const { lastFrame, stdin } = render(
      <SkillsTab
        skills={skills}
        pageCount={1}
        inspectorClient={null}
        width={140}
        height={30}
        focusedPane="list"
        modalOpen
      />,
    );
    stdin.write(DOWN);
    await tick();
    expect(lastFrame() ?? "").toContain("▶ ✓ clean");
  });

  it("verifies the selected skill on Enter and reports the outcome", async () => {
    const readResource = vi.fn().mockResolvedValue({
      result: { contents: [{ uri: "skill://clean/SKILL.md", text: SKILL_MD }] },
    });
    const { lastFrame, stdin } = render(
      <SkillsTab
        skills={[clean]}
        pageCount={1}
        inspectorClient={mockClient(readResource)}
        width={140}
        height={30}
        focusedPane="list"
      />,
    );
    stdin.write(ENTER);
    await tick();
    expect(readResource).toHaveBeenCalled();
    const frame = lastFrame() ?? "";
    // The fixture's advertised digest is all zeroes, so this is a mismatch —
    // which is the outcome worth showing loudly.
    expect(frame).toContain("Verification FAILED");
    expect(frame).toContain("✗ SKILL.md");
  });

  it("surfaces the frontmatter cross-check after verifying", async () => {
    const lying: SkillEntry = {
      ...clean,
      frontmatter: { name: "clean", description: "Something else entirely" },
    };
    const { lastFrame, stdin } = render(
      <SkillsTab
        skills={[lying]}
        pageCount={1}
        inspectorClient={mockClient()}
        width={140}
        height={30}
        focusedPane="list"
      />,
    );
    stdin.write(ENTER);
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Frontmatter cross-check:");
    expect(frame).toContain("Something else entirely");
  });

  it("reports an ordinary read failure as a failed verdict, not a crash", async () => {
    // `verifySkills` records a plain read failure per file rather than
    // throwing, so the pane shows the verdict rather than the error banner.
    const readResource = vi.fn().mockRejectedValue(new Error("network down"));
    const { lastFrame, stdin } = render(
      <SkillsTab
        skills={[clean]}
        pageCount={1}
        inspectorClient={mockClient(readResource)}
        width={140}
        height={30}
        focusedPane="list"
      />,
    );
    stdin.write(ENTER);
    await tick();
    expect(lastFrame() ?? "").toContain("Verification FAILED");
    expect(lastFrame() ?? "").toContain("network down");
  });

  it("hands an auth-recovery error to the callback instead of rendering it", async () => {
    // The one error `verifySkills` re-throws: the session's authorization
    // expired, and this callback is how the TUI offers to fix it. Rendered as
    // a message instead, the user would be told the file could not be read and
    // given no way to recover.
    const err = new AuthRecoveryRequiredError(
      new URL("https://auth.example/authorize"),
      { reason: "expired" } as never,
    );
    const onAuthRecoveryRequired = vi.fn();
    const { lastFrame, stdin } = render(
      <SkillsTab
        skills={[clean]}
        pageCount={1}
        inspectorClient={mockClient(vi.fn().mockRejectedValue(err))}
        width={140}
        height={30}
        focusedPane="list"
        onAuthRecoveryRequired={onAuthRecoveryRequired}
      />,
    );
    stdin.write(ENTER);
    await tick();
    expect(onAuthRecoveryRequired).toHaveBeenCalledWith(err);
    expect(lastFrame() ?? "").not.toContain("Verification FAILED");
  });

  it("shows the read failure's own reason under the file it happened on", async () => {
    // A client missing `readResource` entirely fails every read; the walk
    // records the reason per file rather than aborting, so the diagnosis lands
    // beside the file it belongs to.
    const { lastFrame, stdin } = render(
      <SkillsTab
        skills={[clean]}
        pageCount={1}
        inspectorClient={{} as unknown as InspectorClient}
        width={140}
        height={30}
        focusedPane="list"
      />,
    );
    stdin.write(ENTER);
    await tick();
    expect(lastFrame() ?? "").toContain("is not a function");
  });

  it("does nothing on Enter with no connected client", async () => {
    const { lastFrame, stdin } = render(
      <SkillsTab
        skills={[clean]}
        pageCount={1}
        inspectorClient={null}
        width={140}
        height={30}
        focusedPane="list"
      />,
    );
    stdin.write(ENTER);
    await tick();
    expect(lastFrame() ?? "").toContain(
      "[Enter to verify digests and frontmatter]",
    );
  });

  it("reports a verified skill and re-verifies on a second Enter", async () => {
    // The digest is computed from the very bytes the fake read returns, so the
    // pass is real rather than a constant that happens to match.
    const digest = await sha256Digest(textToBytes(SKILL_MD));
    const verifiable: SkillEntry = {
      ...clean,
      resources: [
        {
          uri: "skill://clean/SKILL.md",
          digest,
          size: textToBytes(SKILL_MD).byteLength,
        },
      ],
    };
    const readResource = vi.fn().mockResolvedValue({
      result: { contents: [{ uri: "skill://clean/SKILL.md", text: SKILL_MD }] },
    });
    const { lastFrame, stdin } = render(
      <SkillsTab
        skills={[verifiable]}
        pageCount={1}
        inspectorClient={mockClient(readResource)}
        width={140}
        height={30}
        focusedPane="list"
      />,
    );
    stdin.write(ENTER);
    await tick();
    expect(lastFrame() ?? "").toContain("Verified — Enter to re-verify");
    expect(lastFrame() ?? "").toContain("✓ SKILL.md");

    stdin.write(ENTER);
    await tick();
    expect(readResource).toHaveBeenCalledTimes(2);
  });

  it("shows a verifying state and ignores Enter while one is in flight", async () => {
    // The guard is what stops a held Enter from opening a second walk over the
    // same manifest on top of the first.
    let release: ((value: unknown) => void) | undefined;
    const readResource = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { lastFrame, stdin } = render(
      <SkillsTab
        skills={[clean]}
        pageCount={1}
        inspectorClient={mockClient(readResource)}
        width={140}
        height={30}
        focusedPane="list"
      />,
    );
    stdin.write(ENTER);
    await tick();
    expect(lastFrame() ?? "").toContain("[Verifying…]");
    stdin.write(ENTER);
    await tick();
    expect(readResource).toHaveBeenCalledTimes(1);
    release?.({
      result: { contents: [{ uri: "skill://clean/SKILL.md", text: SKILL_MD }] },
    });
    await tick();
  });

  it("drops a verdict when the entry changes under the same URI", async () => {
    // A refresh can replace the manifest or the frontmatter without the URI
    // moving. A URI-keyed verdict would then present hashes and findings
    // computed for the PREVIOUS snapshot as if they described the new one.
    const digest = await sha256Digest(textToBytes(SKILL_MD));
    const verifiable: SkillEntry = {
      ...clean,
      resources: [
        {
          uri: "skill://clean/SKILL.md",
          digest,
          size: textToBytes(SKILL_MD).byteLength,
        },
      ],
    };
    const { lastFrame, stdin, rerender } = render(
      <SkillsTab
        skills={[verifiable]}
        pageCount={1}
        inspectorClient={mockClient()}
        width={140}
        height={30}
        focusedPane="list"
      />,
    );
    stdin.write(ENTER);
    await tick();
    expect(lastFrame() ?? "").toContain("Verified — Enter to re-verify");

    // Same URI, different manifest — the old verdict must not carry over.
    rerender(
      <SkillsTab
        skills={[
          {
            ...verifiable,
            resources: [
              { uri: "skill://clean/SKILL.md", digest: CLEAN_DIGEST, size: 9 },
            ],
          },
        ]}
        pageCount={1}
        inspectorClient={mockClient()}
        width={140}
        height={30}
        focusedPane="list"
      />,
    );
    await tick();
    expect(lastFrame() ?? "").toContain(
      "[Enter to verify digests and frontmatter]",
    );
  });

  it("keeps a verdict across a reorder that leaves the entry unchanged", async () => {
    // The reason the key is the entry rather than the list index: moving a
    // skill down the list must not discard a verdict the user paid for.
    const digest = await sha256Digest(textToBytes(SKILL_MD));
    const verifiable: SkillEntry = {
      ...clean,
      resources: [
        {
          uri: "skill://clean/SKILL.md",
          digest,
          size: textToBytes(SKILL_MD).byteLength,
        },
      ],
    };
    const { lastFrame, stdin, rerender } = render(
      <SkillsTab
        skills={[verifiable]}
        pageCount={1}
        inspectorClient={mockClient()}
        width={140}
        height={30}
        focusedPane="list"
      />,
    );
    stdin.write(ENTER);
    await tick();
    expect(lastFrame() ?? "").toContain("Verified — Enter to re-verify");
    rerender(
      <SkillsTab
        skills={[verifiable, dynamic]}
        pageCount={1}
        inspectorClient={mockClient()}
        width={140}
        height={30}
        focusedPane="list"
      />,
    );
    await tick();
    expect(lastFrame() ?? "").toContain("Verified — Enter to re-verify");
  });

  it("falls back to the whole URI when a manifest entry has no path separator", async () => {
    const odd: SkillEntry = {
      uri: "skill://odd/SKILL.md",
      frontmatter: { name: "odd", description: "d" },
      resources: [{ uri: "urn:opaque", digest: CLEAN_DIGEST, size: 1 }],
    };
    const { lastFrame } = render(
      <SkillsTab
        skills={[odd]}
        pageCount={1}
        inspectorClient={null}
        width={140}
        height={30}
      />,
    );
    expect(lastFrame() ?? "").toContain("urn:opaque");
  });

  it("renders both rows when a listing repeats a URI", () => {
    // A malformed listing can carry the same skill twice, and this pane exists
    // to show BOTH — a URI-keyed row would collide them and let React drop or
    // reuse one (Copilot).
    const dup: SkillEntry = {
      uri: "skill://twice/SKILL.md",
      frontmatter: { name: "twice", description: "Listed twice" },
      resources: [],
    };
    const { lastFrame } = render(
      <SkillsTab
        skills={[dup, dup]}
        pageCount={1}
        inspectorClient={null}
        width={140}
        height={30}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Skills (2)");
    expect(frame.match(/twice/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("keys a row by its index when the entry carries no URI", () => {
    // A URI-less entry is a `malformed-uri` finding this pane reports, so it
    // must still render a addressable row rather than colliding React keys.
    const nameless = {
      uri: "",
      frontmatter: { name: "nameless", description: "d" },
      resources: [],
    } as SkillEntry;
    const { lastFrame } = render(
      <SkillsTab
        skills={[nameless]}
        pageCount={1}
        inspectorClient={null}
        width={140}
        height={30}
      />,
    );
    expect(lastFrame() ?? "").toContain("nameless");
  });

  it("reports a name collision on both entries, as a warning", async () => {
    // A catalog-level fact `checkSkillConformance` structurally cannot see —
    // and a warning, because the server did nothing wrong: the obligation is
    // on the consumer to tell two same-named skills apart.
    const acme: SkillEntry = {
      uri: "skill://acme/reports/SKILL.md",
      frontmatter: { name: "reports", description: "Acme ledger" },
      resources: [
        { uri: "skill://acme/reports/SKILL.md", digest: CLEAN_DIGEST, size: 1 },
      ],
    };
    const globex: SkillEntry = {
      uri: "skill://globex/reports/SKILL.md",
      frontmatter: { name: "reports", description: "Globex ledger" },
      resources: [
        {
          uri: "skill://globex/reports/SKILL.md",
          digest: CLEAN_DIGEST,
          size: 1,
        },
      ],
    };
    const { lastFrame, stdin } = render(
      <SkillsTab
        skills={[acme, globex]}
        pageCount={1}
        inspectorClient={null}
        width={160}
        height={30}
        focusedPane="list"
      />,
    );
    const frame = lastFrame() ?? "";
    // Both rows carry the warning mark, not the error one.
    expect(frame.match(/! reports/g)).toHaveLength(2);
    expect(frame).not.toContain("✗ reports");
    expect(frame).toContain("also declares the name");
    // The detail pane names the OTHER skill, which is the disambiguation.
    expect(frame).toContain("skill://globex/reports/SKILL.md");

    stdin.write(DOWN);
    await tick();
    expect(lastFrame() ?? "").toContain("skill://acme/reports/SKILL.md");
  });

  it("shows the digests for a mismatch, not just the failed mark", async () => {
    // `verifySkillResource` sets `reason` for a SIZE mismatch but not a digest
    // one, so a pane rendering only `reason` left a bare `✗` with no diagnosis
    // — a failed verification the reader cannot act on (Copilot).
    // The declared size must be RIGHT, or the cheaper size cross-check
    // short-circuits before hashing and reports its own `reason` instead —
    // which is the path that already rendered.
    const digestOnly: SkillEntry = {
      ...clean,
      resources: [
        {
          uri: "skill://clean/SKILL.md",
          digest: CLEAN_DIGEST,
          size: textToBytes(SKILL_MD).byteLength,
        },
      ],
    };
    const { lastFrame, stdin } = render(
      <SkillsTab
        skills={[digestOnly]}
        pageCount={1}
        inspectorClient={mockClient()}
        width={160}
        height={30}
        focusedPane="list"
      />,
    );
    stdin.write(ENTER);
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Verification FAILED");
    // Truncated to keep the line inside a narrow pane; the CLI report carries
    // the digests in full.
    expect(frame).toMatch(/expected sha256:0+…/);
    expect(frame).toMatch(/got sha256:[0-9a-f]+…/);
  });

  it("shows the reason for a size mismatch, which carries no digest", async () => {
    // The other arm: a length disagreement fails before the hash, so there is
    // no actual digest to print and the reason is the whole diagnosis.
    const { lastFrame, stdin } = render(
      <SkillsTab
        skills={[clean]}
        pageCount={1}
        inspectorClient={mockClient()}
        width={160}
        height={30}
        focusedPane="list"
      />,
    );
    stdin.write(ENTER);
    await tick();
    expect(lastFrame() ?? "").toContain(
      "Manifest declares 51 bytes but the fetched file is 52.",
    );
  });

  it("shows a read failure the manifest does not cover", async () => {
    // A dynamic skill has no manifest rows, so the synthetic read-error row
    // `verifySkills` records for its own SKILL.md was rendered nowhere and the
    // pane said only "Verification FAILED".
    const { lastFrame, stdin } = render(
      <SkillsTab
        skills={[dynamic]}
        pageCount={1}
        inspectorClient={mockClient(
          vi.fn().mockRejectedValue(new Error("upstream gone")),
        )}
        width={160}
        height={30}
        focusedPane="list"
      />,
    );
    stdin.write(ENTER);
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Read failures:");
    expect(frame).toContain("SKILL.md");
    expect(frame).toContain("upstream gone");
    expect(frame).toContain("Verification FAILED");
  });

  it("shows the details footer only when the details pane is focused", () => {
    const unfocused = render(
      <SkillsTab
        skills={[clean]}
        pageCount={1}
        inspectorClient={null}
        width={140}
        height={30}
        focusedPane="list"
      />,
    );
    expect(unfocused.lastFrame() ?? "").not.toContain("Enter to verify\n");
    const focused = render(
      <SkillsTab
        skills={[clean]}
        pageCount={1}
        inspectorClient={null}
        width={140}
        height={30}
        focusedPane="details"
      />,
    );
    expect(focused.lastFrame() ?? "").toContain(
      "↑/↓ to scroll, Enter to verify",
    );
  });
});
