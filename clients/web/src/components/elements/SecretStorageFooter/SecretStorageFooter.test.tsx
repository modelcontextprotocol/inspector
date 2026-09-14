import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { SecretStorageInfo } from "@inspector/core/auth/secret-storage-info.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { SecretStorageFooter } from "./SecretStorageFooter";

const keyring: SecretStorageInfo = {
  kind: "keyring",
  reason: "default",
  durable: true,
};
const encryptedFile: SecretStorageInfo = {
  kind: "file",
  reason: "fallback",
  durable: true,
  plaintext: false,
  path: "/home/node/.mcp-inspector/secrets.json",
};
const plaintextFile: SecretStorageInfo = { ...encryptedFile, plaintext: true };
const memory: SecretStorageInfo = {
  kind: "memory",
  reason: "fallback",
  durable: false,
};

describe("SecretStorageFooter", () => {
  it("names the keychain with no caveat and no warning tone", () => {
    renderWithMantine(<SecretStorageFooter info={keyring} />);
    // Asserted on the band's full text rather than with `getByText`: the
    // "Secrets:" prefix is its own `<span>`, and testing-library matches a
    // string against an element's *direct* text nodes only, so the label now
    // reads as two fragments even though it renders as one line.
    const band = screen.getByTestId("secret-storage-footer");
    expect(band).toHaveTextContent("Secrets: OS keychain");
    expect(band).toHaveAttribute("data-tone", "neutral");
  });

  it("states an encrypted file quietly, and offers its path for copying", () => {
    // Nothing is wrong here, so the band must not shout. The path is no longer
    // printed on the band — it goes to the clipboard — so the accessible name
    // is where it stays readable.
    renderWithMantine(<SecretStorageFooter info={encryptedFile} />);
    const band = screen.getByTestId("secret-storage-footer");
    expect(band).toHaveTextContent(
      "Secrets: Encrypted file. Owner-only permissions.",
    );
    expect(band).toHaveAttribute("data-tone", "neutral");
    // The accessible name must carry the *status* as well as the affordance:
    // `aria-label` replaces descendant text, so labelling it only "Copy…"
    // would announce the button and discard the warning the band exists for.
    expect(
      screen.getByRole("button", {
        name: "Secrets: Encrypted file. Owner-only permissions. Copy secrets file path: /home/node/.mcp-inspector/secrets.json",
      }),
    ).toBeInTheDocument();
  });

  it("says a plaintext file is plaintext, in the warning tone", () => {
    // The "loud warning" decision made concrete: the state is on the band
    // itself, not hidden behind a hover.
    renderWithMantine(<SecretStorageFooter info={plaintextFile} />);
    const band = screen.getByTestId("secret-storage-footer");
    expect(band).toHaveTextContent(
      "Secrets: Plaintext file. Owner-only permissions.",
    );
    expect(band).toHaveAttribute("data-tone", "warn");
  });

  it("copies the path on click", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    // happy-dom has no clipboard; define one so the copy path is exercised
    // rather than merely not throwing.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderWithMantine(<SecretStorageFooter info={plaintextFile} />);
    await user.click(screen.getByRole("button", { name: /Copy secrets file/ }));
    expect(writeText).toHaveBeenCalledWith(
      "/home/node/.mcp-inspector/secrets.json",
    );
  });

  it("is inert for a store with no file to point at", () => {
    // A keychain or in-memory store has no path, so there is nothing to copy
    // and the band must not pretend to be a control.
    renderWithMantine(<SecretStorageFooter info={keyring} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("declines to claim owner-only permissions when the mode says otherwise", () => {
    // The one assertion the band must never get wrong: `looseMode` is set
    // exactly when 0600 could not be reached, so "Owner-only permissions."
    // there would state the opposite of the truth.
    renderWithMantine(
      <SecretStorageFooter info={{ ...plaintextFile, looseMode: 0o644 }} />,
    );
    const band = screen.getByTestId("secret-storage-footer");
    expect(band).toHaveTextContent("Mode 0644 — not owner-only.");
    expect(band).not.toHaveTextContent("Owner-only permissions.");
  });

  it("warns that an in-memory store loses secrets on exit", () => {
    renderWithMantine(<SecretStorageFooter info={memory} />);
    const band = screen.getByTestId("secret-storage-footer");
    expect(band).toHaveTextContent("Secrets: Memory (this session only):");
    expect(screen.getByText(/lost on exit/)).toBeInTheDocument();
    expect(band).toHaveAttribute("data-tone", "warn");
  });

  it("does not claim exposure in the tooltip when encryption is unknown", async () => {
    // Mirrors `secretStorageCaveat`: `plaintext` is absent alongside
    // `encryptionUnknown`, and a two-way `!== false` test would assert that
    // a reader gets the secrets out of a file we could not even classify.
    // The claim lives in the *tooltip*, so that is what this hovers to read
    // — the visible line reports the unreadable envelope, which is a
    // different (and also correct) statement.
    const user = userEvent.setup();
    renderWithMantine(
      <SecretStorageFooter
        info={{
          ...plaintextFile,
          plaintext: undefined,
          looseMode: 0o644,
          encryptionUnknown: "not valid JSON",
        }}
      />,
    );
    const band = screen.getByTestId("secret-storage-footer");
    expect(band).toHaveAttribute("data-tone", "warn");

    // The tooltip's target is the copy button, not the band around it.
    await user.hover(screen.getByRole("button", { name: /Copy secrets file/ }));
    const tip = await screen.findByText(/Mode 0644 could not be tightened/);
    expect(tip).toHaveTextContent("could not determine");
    expect(tip).not.toHaveTextContent(
      "anyone who can read the file can read the secrets in it",
    );
  });

  it("announces the security status, not just the copy affordance", () => {
    // The regression this pins: `aria-label` overrides the button's
    // descendant text, so a screen-reader user heard "Copy secrets file
    // path …" and lost "Plaintext file" entirely — the one sentence that
    // should change their mind about typing a secret.
    renderWithMantine(<SecretStorageFooter info={plaintextFile} />);
    const button = screen.getByRole("button");
    expect(button).toHaveAccessibleName(
      /^Secrets: Plaintext file\. Owner-only permissions\./,
    );
    expect(button).toHaveAccessibleName(/Copy secrets file path/);
  });

  it("renders nothing when the backend didn't report a store", () => {
    // A guessed answer under a secret field is worse than no answer, so the
    // unknown case is silence rather than a default.
    renderWithMantine(<SecretStorageFooter info={undefined} />);
    expect(screen.queryByTestId("secret-storage-footer")).toBeNull();
  });

  it("says the permissions could not be checked rather than claiming owner-only", async () => {
    // The third permission state. Falling into the verified-0600 branch here
    // would have the band assert owner-only having read nothing — the same
    // bug as claiming 0600 in the caveat, one layer up.
    renderWithMantine(
      <SecretStorageFooter
        info={{
          kind: "file",
          reason: "fallback",
          durable: true,
          plaintext: true,
          path: "/home/node/.mcp-inspector/secrets.json",
          permissionsUnknown: "EACCES",
        }}
      />,
    );
    const band = screen.getByTestId("secret-storage-footer");
    expect(band).toHaveTextContent("Permissions could not be checked.");
    expect(band).not.toHaveTextContent("Owner-only");
    expect(band).toHaveAttribute("data-tone", "warn");
  });

  it("says an unreadable file is unreadable, not encrypted", async () => {
    // The descriptor omits `plaintext` here, and the band must not read a
    // default out of that absence.
    renderWithMantine(
      <SecretStorageFooter
        info={{
          kind: "file",
          reason: "fallback",
          durable: true,
          path: "/home/node/.mcp-inspector/secrets.json",
          encryptionUnknown: "not valid JSON",
        }}
      />,
    );
    const band = screen.getByTestId("secret-storage-footer");
    expect(band).toHaveTextContent("Unreadable file.");
    expect(band).toHaveTextContent("Saving a secret will fail.");
    expect(band).not.toHaveTextContent("Encrypted file");
    expect(band).toHaveAttribute("data-tone", "warn");
  });

  it("does not claim a loose-mode encrypted file exposes its secrets", async () => {
    renderWithMantine(
      <SecretStorageFooter
        info={{
          kind: "file",
          reason: "fallback",
          durable: true,
          plaintext: false,
          path: "/home/node/.mcp-inspector/secrets.json",
          looseMode: 0o644,
        }}
      />,
    );
    const band = screen.getByTestId("secret-storage-footer");
    expect(band).toHaveTextContent("Mode 0644 — not owner-only.");
    expect(band).toHaveAttribute("data-tone", "warn");
  });

  it("puts the path in the tooltip, not just an offer to copy it", async () => {
    // The band no longer prints the path and the accessible name carries it
    // for screen-reader users, which left a sighted user unable to see where
    // a custom destination points without copying it out somewhere else.
    renderWithMantine(
      <SecretStorageFooter
        info={{
          kind: "file",
          reason: "fallback",
          durable: true,
          plaintext: false,
          path: "/custom/place/secrets.json",
        }}
      />,
    );
    // Hover the control the tooltip is attached to, not the band around it.
    await userEvent.hover(
      screen.getByRole("button", { name: /Copy secrets file path/ }),
    );
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("/custom/place/secrets.json");
    expect(tip).toHaveTextContent("Click to copy.");
  });
});
