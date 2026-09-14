/**
 * The description of *where a typed secret ends up* — the one fact this
 * whole subsystem exists to make unmissable (#1950).
 *
 * Pure data plus its presentation helpers, deliberately kept out of
 * `core/auth/node/` so the browser can import it. The Node side resolves
 * the active store (`core/auth/node/secret-store-selection.ts`) and
 * produces one of these; it then travels three ways, and all three read
 * the same object so they cannot disagree:
 *
 *  1. the startup banner the launcher prints,
 *  2. `GET /api/config` → the web UI's settings-modal footers,
 *  3. the `SecretStore` doc comment's contract, in prose.
 *
 * A store's *kind* answers "where", `plaintext` answers "readable by
 * anyone who can read the file", and `durable` answers "will it still be
 * there next run". Those are three separate questions and a user asking
 * one of them is rarely helped by the answer to another, so none is
 * folded into the others.
 */

/** Which backend is holding secrets this session. */
export type SecretStoreKind = "keyring" | "file" | "memory";

/**
 * Why the active store is the active store. `configured` means the user
 * named it via `MCP_INSPECTOR_SECRET_STORE`; `default` means the keychain
 * was reachable and we used it; `fallback` means the keychain was *not*
 * reachable and we picked something that works instead — the case that
 * earns a loud banner, because it is the one where the answer to "where
 * did my secret go" changed without the user asking for it.
 */
export type SecretStoreReason = "configured" | "default" | "fallback";

export interface SecretStorageInfo {
  kind: SecretStoreKind;
  reason: SecretStoreReason;
  /**
   * Absolute path of the secrets file, for `kind: "file"` only. Shown in
   * the UI and the banner: a file-backed store whose location is a
   * mystery is barely better than no answer at all.
   */
  path?: string;
  /**
   * True when the secrets file is *currently* in the clear. Read off the
   * file's own envelope rather than off whether a passphrase is
   * configured, because those two disagree for a whole session: adding
   * `MCP_INSPECTOR_SECRET_KEY` to an install that already has a plaintext
   * file makes the next write encrypt, while the existing bytes stay
   * readable until then. Reporting the intent would tell that user their
   * secrets were encrypted while they were not.
   *
   * **File-only, and omitted entirely for the other kinds** — not "false".
   * A keychain is opaque to us and RAM is not "at rest" in the sense this
   * flag is about, so the producer leaves it off and
   * `useInitialConfig.usableSecretStorage` rejects a descriptor that carries
   * it on a non-file kind. Documenting it as "always false elsewhere" invited
   * an API consumer to construct exactly the shape the web client discards.
   */
  plaintext?: boolean;
  /**
   * True in exactly the transitional state above: `plaintext` is still
   * true, but a passphrase is set and the next write will encrypt. It
   * changes the *advice* rather than the verdict — "set a passphrase" is
   * the wrong thing to tell someone who already has, so the caveat says
   * what will actually clear the condition.
   */
  pendingEncryption?: boolean;
  /**
   * Octal mode of the secrets file when it is **not** `0600` and could not
   * be tightened — a file owned by another user, or on a read-only mount.
   *
   * Carried into the descriptor rather than left in a startup log line
   * because the caveat below states the mode as fact, at the point where a
   * user types a secret. On such a box that statement was simply untrue,
   * and the browser had no way to know.
   */
  looseMode?: number;
  /**
   * Set when the secrets file exists and its mode could not be read at all
   * — `EACCES` on the containing directory, or a filesystem with no POSIX
   * modes. Carries the errno so the message can say why.
   *
   * Distinct from {@link looseMode}, and the distinction matters: that one
   * says "we looked and it is wrong", this one says "we could not look".
   * Collapsing the second into silence is what let the footer keep stating
   * mode 0600 as fact having verified nothing.
   */
  permissionsUnknown?: string;
  /**
   * Set when the secrets file exists but its envelope could not be read —
   * corrupt JSON, or a format written by a newer Inspector. Carries the
   * reason.
   *
   * Mutually exclusive with a meaningful {@link plaintext}: the whole point
   * is that the encryption state was never established, so neither "File
   * (encrypted)" nor "File (unencrypted)" may be claimed. `set` will refuse
   * such a file rather than overwrite it, so this is also a live warning
   * about writes, not only a description.
   */
  encryptionUnknown?: string;
  /**
   * True when secrets outlive the process. False only for `memory`, and
   * it is the *promise* being made rather than an implementation detail:
   * an in-memory store is honest precisely because it never claims
   * durability it cannot deliver in a container's writable layer.
   */
  durable: boolean;
  /**
   * Why the keychain was unreachable, when `reason === "fallback"`. Free
   * text from the underlying loader/binding — surfaced rather than
   * summarized, because the three realistic causes (missing libsecret, no
   * platform binary, a packaging mismatch) need different fixes and only
   * the raw message distinguishes them.
   */
  detail?: string;
}

/** Short label naming the store — the footer's primary text. */
export function secretStorageLabel(info: SecretStorageInfo): string {
  switch (info.kind) {
    case "keyring":
      return "OS keychain";
    case "file":
      if (info.encryptionUnknown !== undefined) return "File (unreadable)";
      return info.plaintext ? "File (unencrypted)" : "File (encrypted)";
    case "memory":
      return "Memory (this session only)";
  }
}

/**
 * How loudly to say it. `warn` is reserved for the two states a user
 * would want to know about before typing a secret — it is on disk in the
 * clear, or it is about to be lost on exit — so that the ordinary
 * keychain and encrypted-file cases stay quiet and the warning keeps its
 * meaning.
 */
export type SecretStorageTone = "neutral" | "warn";

export function secretStorageTone(info: SecretStorageInfo): SecretStorageTone {
  if (info.kind === "memory") return "warn";
  if (info.plaintext) return "warn";
  // An encrypted file that anyone can read is still worth flagging: the
  // passphrase is the only thing standing between a reader and the values.
  if (info.looseMode !== undefined) return "warn";
  // Unverified is not the same as fine. The quiet tone here would read as a
  // confirmation we never made.
  if (info.permissionsUnknown !== undefined) return "warn";
  // A file we cannot read is one we cannot write either — a warning about
  // the next save, not just about the past.
  if (info.encryptionUnknown !== undefined) return "warn";
  return "neutral";
}

/**
 * One sentence of consequence, or undefined when there is none worth
 * saying. Consequence, not mechanism: "lost on exit" is what a user can
 * act on; "uses an in-memory Map" is not.
 */
export function secretStorageCaveat(
  info: SecretStorageInfo,
): string | undefined {
  if (info.kind === "memory") {
    return "Secrets are not written anywhere and are lost on exit.";
  }
  // The permission problem outranks the encryption one when both hold: a
  // file other users can read is a live exposure, while "unencrypted" is a
  // property of a file only its owner can open.
  if (info.looseMode !== undefined) {
    const mode = info.looseMode.toString(8).padStart(4, "0");
    // The consequence differs by encryption, and overstating it is its own
    // kind of wrong: a reader of an *encrypted* file gets ciphertext, not
    // secrets. Saying otherwise trains people to discount the warning on the
    // occasion it is literally true.
    // Three cases, not two. With `encryptionUnknown` set, `plaintext` is
    // absent — and `!== false` then lands on the plaintext wording, which
    // asserts that a reader gets the secrets. The envelope may well hold
    // ciphertext; we simply could not tell. Claiming the worse of two
    // unknowns is still claiming something we did not establish, which is
    // the failure this descriptor exists to avoid.
    if (info.encryptionUnknown !== undefined) {
      return `The secrets file is mode ${mode}, not 0600, and could not be tightened — others can copy it, and whether that exposes the secrets depends on encryption this build could not determine (${info.encryptionUnknown}).`;
    }
    return info.plaintext === false
      ? `The secrets file is mode ${mode}, not 0600, and could not be tightened — others can copy it, and the passphrase is then the only thing protecting its contents.`
      : `The secrets file is mode ${mode}, not 0600, and could not be tightened — anyone who can read it can read the secrets in it.`;
  }
  // Ordered with the permission problems, above encryption, for the same
  // reason: not knowing whether others can read the file is a question about
  // exposure, and it should not be answered by a reassuring silence.
  if (info.permissionsUnknown !== undefined) {
    return `The secrets file's permissions could not be checked (${info.permissionsUnknown}), so it is not known whether others can read it.`;
  }
  // An unreadable envelope outranks the encryption caveats below, which all
  // presuppose we know which mode the file is in.
  if (info.encryptionUnknown !== undefined) {
    return `The secrets file could not be read (${info.encryptionUnknown}). Saving a secret will fail rather than overwrite it.`;
  }
  if (info.plaintext) {
    return info.pendingEncryption
      ? "Existing secrets in this file are still unencrypted (file mode 0600). They are re-encrypted the next time a secret is saved."
      : "Secrets are stored unencrypted (file mode 0600). Set MCP_INSPECTOR_SECRET_KEY to encrypt them.";
  }
  return undefined;
}

/**
 * The full sentence, for the startup banner and any single-line surface.
 * Built from the same three helpers the UI uses so the terminal and the
 * browser cannot drift into describing the same store differently.
 */
export function secretStorageSummary(info: SecretStorageInfo): string {
  const parts = [secretStorageLabel(info)];
  if (info.path) parts.push(`at ${info.path}`);
  if (info.reason === "fallback") {
    parts.push("— fell back from the OS keychain");
  }
  return parts.join(" ");
}
