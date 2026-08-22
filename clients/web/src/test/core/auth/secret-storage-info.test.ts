/**
 * The secret-storage descriptor's presentation helpers (#1950).
 *
 * These are shared by the terminal banner and the browser footer, which is
 * the whole reason they live in `core/auth/` rather than beside either
 * consumer — so the cases below are about the *statements* they make,
 * particularly which states are loud and which are quiet. A helper that
 * quietly stopped warning about a plaintext file would leave both surfaces
 * silently wrong at once.
 */
import { describe, it, expect } from "vitest";
import {
  secretStorageCaveat,
  secretStorageLabel,
  secretStorageSummary,
  secretStorageTone,
  type SecretStorageInfo,
} from "@inspector/core/auth/secret-storage-info.js";

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
const plaintextFile: SecretStorageInfo = {
  ...encryptedFile,
  plaintext: true,
};
const memory: SecretStorageInfo = {
  kind: "memory",
  reason: "fallback",
  durable: false,
};

describe("secretStorageLabel", () => {
  it("names the keychain", () => {
    expect(secretStorageLabel(keyring)).toBe("OS keychain");
  });

  it("distinguishes an encrypted file from an unencrypted one", () => {
    // The distinction is the point — "File" alone would answer "where"
    // while dropping the half a user needs to judge the risk.
    expect(secretStorageLabel(encryptedFile)).toBe("File (encrypted)");
    expect(secretStorageLabel(plaintextFile)).toBe("File (unencrypted)");
  });

  it("says memory is session-scoped in the label itself", () => {
    expect(secretStorageLabel(memory)).toBe("Memory (this session only)");
  });
});

describe("secretStorageTone", () => {
  it("stays neutral for the keychain and an encrypted file", () => {
    // A tone that fired for every store would carry no information.
    expect(secretStorageTone(keyring)).toBe("neutral");
    expect(secretStorageTone(encryptedFile)).toBe("neutral");
  });

  it("warns for an unencrypted file and for memory", () => {
    expect(secretStorageTone(plaintextFile)).toBe("warn");
    expect(secretStorageTone(memory)).toBe("warn");
  });
});

describe("secretStorageCaveat", () => {
  it("has none for the quiet stores", () => {
    expect(secretStorageCaveat(keyring)).toBeUndefined();
    expect(secretStorageCaveat(encryptedFile)).toBeUndefined();
  });

  it("names the loss for memory", () => {
    expect(secretStorageCaveat(memory)).toContain("lost on exit");
  });

  it("names the fix for an unencrypted file, not just the problem", () => {
    const caveat = secretStorageCaveat(plaintextFile);
    expect(caveat).toContain("unencrypted");
    expect(caveat).toContain("MCP_INSPECTOR_SECRET_KEY");
  });

  it("changes the advice once a passphrase is set but not yet applied", () => {
    // Telling someone to set MCP_INSPECTOR_SECRET_KEY when they already have
    // is advice that cannot clear the condition. The condition here is the
    // pending write, so that is what the sentence names — while the verdict
    // (still unencrypted, still a warning) stays exactly the same.
    const pending: SecretStorageInfo = {
      ...plaintextFile,
      pendingEncryption: true,
    };
    expect(secretStorageTone(pending)).toBe("warn");
    expect(secretStorageLabel(pending)).toBe("File (unencrypted)");
    const caveat = secretStorageCaveat(pending);
    expect(caveat).toContain("next time a secret is saved");
    expect(caveat).not.toContain("MCP_INSPECTOR_SECRET_KEY");
  });

  it("reports a mode it could not tighten, ahead of the encryption caveat", () => {
    // A file other users can read is a live exposure; "unencrypted" is a
    // property of a file only its owner can open. When both hold, the
    // permission problem is the one to say out loud.
    const loose: SecretStorageInfo = { ...plaintextFile, looseMode: 0o644 };
    expect(secretStorageTone(loose)).toBe("warn");
    expect(secretStorageCaveat(loose)).toContain("0644");
    expect(secretStorageCaveat(loose)).not.toContain(
      "MCP_INSPECTOR_SECRET_KEY",
    );
  });

  it("does not claim exposure when the encryption state is unknown", () => {
    // `looseMode` with `encryptionUnknown` leaves `plaintext` absent, and a
    // `!== false` test then lands on the plaintext wording — asserting that
    // a reader gets the secrets. The envelope may hold ciphertext; we could
    // not classify it. Claiming the worse of two unknowns is still claiming
    // something we never established.
    const loose: SecretStorageInfo = {
      kind: "file",
      reason: "fallback",
      durable: true,
      looseMode: 0o644,
      encryptionUnknown: "not valid JSON",
      path: "/tmp/secrets.json",
    };
    const caveat = secretStorageCaveat(loose);
    expect(secretStorageTone(loose)).toBe("warn");
    expect(caveat).toContain("0644");
    expect(caveat).toContain("could not determine");
    expect(caveat).not.toContain("anyone who can read it can read the secrets");
  });

  it("warns about a loose mode even on an encrypted file", () => {
    // The passphrase is then the only thing between a reader and the values,
    // which is worth saying rather than rendering the quiet neutral state.
    const loose: SecretStorageInfo = { ...encryptedFile, looseMode: 0o640 };
    expect(secretStorageTone(loose)).toBe("warn");
    expect(secretStorageCaveat(loose)).toContain("0640");
  });

  it("does not overstate exposure for an encrypted file with a loose mode", () => {
    // A reader of an encrypted file gets ciphertext, not secrets. Saying
    // otherwise trains people to discount the warning on the occasion it is
    // literally true.
    const loose: SecretStorageInfo = { ...encryptedFile, looseMode: 0o644 };
    const caveat = secretStorageCaveat(loose);
    expect(caveat).toContain("0644");
    expect(caveat).toContain("passphrase is then the only thing");
    expect(caveat).not.toContain("can read the secrets in it");
  });

  it("keeps the blunt wording for a plaintext file with a loose mode", () => {
    const loose: SecretStorageInfo = { ...plaintextFile, looseMode: 0o644 };
    expect(secretStorageCaveat(loose)).toContain("can read the secrets in it");
  });

  it("says a file it could not read is unreadable, and warns about the next save", () => {
    const unreadable: SecretStorageInfo = {
      kind: "file",
      reason: "fallback",
      durable: true,
      path: "/x/secrets.json",
      encryptionUnknown: "not valid JSON",
    };
    // Neither "encrypted" nor "unencrypted" is a claim we can make here.
    expect(secretStorageLabel(unreadable)).toBe("File (unreadable)");
    expect(secretStorageTone(unreadable)).toBe("warn");
    expect(secretStorageCaveat(unreadable)).toMatch(
      /could not be read \(not valid JSON\)\. Saving a secret will fail/,
    );
  });

  it("prefers the memory caveat when a memory store somehow carries the flag", () => {
    // Defensive ordering: `plaintext` is meaningless for memory, and the
    // durability loss is the more consequential of the two statements.
    expect(secretStorageCaveat({ ...memory, plaintext: true })).toContain(
      "lost on exit",
    );
  });
});

describe("secretStorageSummary", () => {
  it("is just the label when there is nothing else to say", () => {
    expect(secretStorageSummary(keyring)).toBe("OS keychain");
  });

  it("includes the path so a file-backed store is findable", () => {
    expect(secretStorageSummary(encryptedFile)).toContain(
      "/home/node/.mcp-inspector/secrets.json",
    );
  });

  it("marks a fallback as a fallback", () => {
    // The banner has to distinguish "you configured this" from "we had to".
    expect(secretStorageSummary(memory)).toContain("fell back");
    expect(
      secretStorageSummary({ ...memory, reason: "configured" }),
    ).not.toContain("fell back");
  });
});
