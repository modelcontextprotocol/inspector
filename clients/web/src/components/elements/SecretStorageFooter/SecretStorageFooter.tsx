import type { ReactNode } from "react";
import {
  CopyButton,
  Group,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { TbAlertTriangle, TbDeviceDesktop, TbLock } from "react-icons/tb";
import {
  secretStorageCaveat,
  secretStorageLabel,
  secretStorageTone,
  type SecretStorageInfo,
} from "@inspector/core/auth/secret-storage-info.js";

/**
 * Height of the footer band. Matches `InspectorView`'s `FOOTER_HEIGHT`
 * deliberately: these are the app's only permanent status strips, and a
 * modal footer standing a few pixels taller than the one behind it would
 * read as a different kind of thing.
 */
export const SECRET_STORAGE_FOOTER_HEIGHT = 32;

export interface SecretStorageFooterProps {
  /**
   * The active store, from `GET /api/config`. Renders nothing when
   * undefined — a backend that didn't report one leaves the question
   * genuinely open, and an invented answer directly beneath a secret field
   * is worse than silence.
   */
  info?: SecretStorageInfo;
}

// A thin band, same height as the app footer. Mantine's compound Modal has no
// `Modal.Footer`, so it renders as the last child of `Modal.Content`, after the
// `Modal.Body`, and its theme variant pins it with `position: sticky` — the
// mirror of Mantine's own sticky header, because `Modal.Content` scrolls
// header, body and footer as one. `nowrap` keeps it to one line at any modal
// width; the truncating detail text on the right absorbs a narrow modal.
const FooterBand = Group.withProps({
  variant: "stickyModalFooter",
  h: SECRET_STORAGE_FOOTER_HEIGHT,
  gap: 0,
  align: "center",
  wrap: "nowrap",
  w: "100%",
});

// The icon + message row. Carries the horizontal padding (rather than the band)
// so that when the row is a copy button it covers the band edge to edge — a
// click target with dead margins is a click target people miss.
const FooterRow = Group.withProps({
  h: "100%",
  w: "100%",
  px: "md",
  gap: 6,
  align: "center",
  wrap: "nowrap",
});

// The whole strip becomes the copy affordance for a file-backed store. An
// `UnstyledButton` rather than a click handler on the Group: this is a real
// action, so it needs to be reachable by keyboard and announced as a button.
const CopyTarget = UnstyledButton.withProps({
  h: "100%",
  w: "100%",
});

// The whole statement, prefix included, as one clamped line.
//
// `lineClamp` rather than `truncate`, and the difference is load-bearing.
// `Modal.Content` sizes its scroll container to its children's **max-content**
// width, and `truncate` sets `white-space: nowrap`, whose max-content is the
// entire sentence — so the band grew the container to 770px inside a 620px
// modal and the *form above it* got clipped at the right edge (measured).
// Clamped text still wraps internally, so its max-content is merely its
// longest word, and the container stays the modal's width; the clamp then
// keeps it to the one line this 32px band has room for. `miw: 0` + `flex: 1`
// let it shrink to the leftover space rather than to its content.
const FooterMessage = Text.withProps({
  size: "xs",
  fw: 500,
  lineClamp: 1,
  miw: 0,
  flex: 1,
  ta: "left",
});

// "Secrets:" carries the heavier weight so the band reads as a labelled fact
// rather than as one run of prose — the eye lands on what the line is about
// before reading which store it names.
//
// A `span` inside the label rather than a sibling in the `Group`: `Text`
// renders a `<p>`, so a nested one would be a `<p>` inside a `<p>` (invalid,
// and the browser would close the outer paragraph early), and a sibling would
// take the Group's `gap` and sit too far from the value it labels. `inherit`
// keeps it at the label's own size and line height instead of Mantine's `Text`
// defaults.
const FooterLabelPrefix = Text.withProps({
  span: true,
  inherit: true,
  fw: 700,
});

// `multiline` + a fixed width so the sentence wraps instead of forming a
// tooltip wider than the modal it explains. Only the `label` is dynamic.
const CaveatTooltip = Tooltip.withProps({
  multiline: true,
  w: 320,
  position: "top",
  withArrow: true,
});

const ICON_SIZE = 14;

/** Octal mode, as `stat` would print it (`0644`). */
const formatMode = (mode: number): string => mode.toString(8).padStart(4, "0");

/**
 * How the band describes the file's permissions.
 *
 * Three states, not two, and the third is the point: "Owner-only
 * permissions." is a claim of *fact*, so it may only be made when the mode
 * was actually read and found to be 0600. `looseMode` says we looked and it
 * was wrong; `permissionsUnknown` says we could not look at all. Treating
 * the second like the first — which a plain `looseMode === undefined` test
 * does — makes the footer assert owner-only having verified nothing, which
 * is the failure this band exists to prevent, arrived at by omission rather
 * than by error.
 */
function filePermissionsSentence(info: SecretStorageInfo): string {
  if (info.looseMode !== undefined) {
    return `Mode ${formatMode(info.looseMode)} — not owner-only.`;
  }
  if (info.permissionsUnknown !== undefined) {
    return "Permissions could not be checked.";
  }
  return "Owner-only permissions.";
}

/**
 * The visible statement, per store.
 *
 * Deliberately not built from `secretStorageLabel` for the file case: that
 * label is parenthetical ("File (unencrypted)") because the startup banner
 * appends " at <path>" to it, and the footer wants a sentence instead. The
 * two surfaces have different shapes, so each phrases its own; the *tone*
 * and the underlying facts still come from the shared helpers, which is
 * what keeps them from disagreeing about anything that matters.
 */
function footerMessage(info: SecretStorageInfo): string {
  if (info.kind === "keyring") return secretStorageLabel(info);
  if (info.kind === "memory") {
    // Derived rather than restated — memory's consequence is the caveat, and
    // the banner prints the same sentence.
    const caveat = secretStorageCaveat(info);
    return caveat
      ? `${secretStorageLabel(info)}: ${caveat}`
      : secretStorageLabel(info);
  }
  // "Unreadable" rather than guessing a mode: the envelope could not be
  // parsed, so neither "Plaintext" nor "Encrypted" is a claim we can make.
  if (info.encryptionUnknown !== undefined) {
    return "Unreadable file. Saving a secret will fail.";
  }
  const encryption = info.plaintext ? "Plaintext" : "Encrypted";
  const permissions = filePermissionsSentence(info);
  return `${encryption} file. ${permissions}`;
}

/**
 * The hover text, per store. Undefined leaves the band without a tooltip.
 *
 * For a file-backed store it always ends with the copy hint, because the
 * path is no longer shown on the band — it is in the clipboard instead, and
 * an affordance nobody knows about is not one.
 */
function footerTooltip(info: SecretStorageInfo): string | undefined {
  if (info.kind !== "file" || !info.path) return undefined;
  const parts: string[] = [];
  if (info.encryptionUnknown !== undefined) {
    parts.push(
      `The file could not be read (${info.encryptionUnknown}), so its contents are unknown and saving a secret will fail rather than overwrite it.`,
    );
  } else if (info.plaintext) {
    // Advice that can actually clear the condition: someone who has already
    // set the passphrase is waiting on the next write, not on themselves.
    parts.push(
      info.pendingEncryption
        ? "Re-encrypted the next time a secret is saved."
        : "Set MCP_INSPECTOR_SECRET_KEY to encrypt.",
    );
  }
  if (info.looseMode !== undefined) {
    // Encryption-aware: a reader of an encrypted file gets ciphertext, not
    // secrets. Claiming otherwise overstates the exposure, and a warning
    // that cries wolf is discounted on the occasion it is literally true.
    parts.push(
      // Three cases, mirroring `secretStorageCaveat`. With
      // `encryptionUnknown` set, `plaintext` is absent and `!== false` would
      // land on the "anyone can read the secrets" wording — asserting an
      // exposure we did not establish, since the envelope may hold
      // ciphertext we simply could not classify.
      info.encryptionUnknown !== undefined
        ? `Mode ${formatMode(info.looseMode)} could not be tightened to 0600 — others can copy the file, and whether that exposes the secrets depends on encryption this build could not determine (${info.encryptionUnknown}).`
        : info.plaintext === false
          ? `Mode ${formatMode(info.looseMode)} could not be tightened to 0600 — others can copy the file, and the passphrase is then the only thing protecting its contents.`
          : `Mode ${formatMode(info.looseMode)} could not be tightened to 0600 — anyone who can read the file can read the secrets in it.`,
    );
  } else if (info.permissionsUnknown !== undefined) {
    parts.push(
      `The file's permissions could not be read (${info.permissionsUnknown}), so it is not known whether others can read it.`,
    );
  }
  // The path itself, not just an offer to copy it. The band no longer prints
  // it, and the accessible name carries it for screen-reader users — which
  // left a sighted user unable to see *where* a custom destination points
  // without copying it out to somewhere else first.
  parts.push(info.path);
  parts.push("Click to copy.");
  return parts.join(" ");
}

/**
 * The permanent "here is where your secrets go" strip at the bottom of the
 * Client Settings and Server Settings modals (#1950).
 *
 * It appears wherever the Inspector accepts a secret — Client Settings (the
 * enterprise IdP client secret), Server Settings (the per-server OAuth
 * client secret and stdio `env:` values), and Server Config (stdio `env:`
 * values again). This comment named only the first two until review round
 * 20, and the dialog it omitted was the one taking secrets with no
 * disclosure at all, so the wrong count here was the bug rather than a
 * description of it. The alternatives were
 * considered and rejected: a startup banner is seen once, by whoever
 * started the process, possibly hours before anyone types anything; a
 * toast is seen once and then gone; a dismissible banner is, by design,
 * the thing a user makes disappear before doing the work it describes.
 * This is always present, is not dismissible, and has no empty state
 * beyond "the backend didn't say".
 *
 * When the store is lossy or unencrypted the caveat is rendered *inline*
 * rather than left to the tooltip. That is the whole point of the
 * "plaintext gets a loud warning" decision: a warning you have to hover to
 * discover is not one. The tooltip carries the full sentence for the case
 * where a narrow modal truncates it, and — for the quiet stores — the file
 * path.
 *
 * Deliberately read-only for now. Choosing the store from here is the
 * obvious follow-up, but the gap this closes is that users could not find
 * out *at all*, and closing that does not require a control.
 */
export function SecretStorageFooter({ info }: SecretStorageFooterProps) {
  if (!info) return null;

  const warn = secretStorageTone(info) === "warn";
  const color = warn
    ? "var(--inspector-warning-text)"
    : "var(--inspector-text-secondary)";
  const Icon = warn
    ? TbAlertTriangle
    : info.kind === "keyring"
      ? TbDeviceDesktop
      : TbLock;

  const row = (
    <FooterRow>
      {/* A react-icons glyph, not a Mantine factory component — outside the
          `.withProps()` rule, and it takes `color` as a prop rather than a
          style. */}
      <Icon size={ICON_SIZE} color={color} aria-hidden />
      <FooterMessage c={color}>
        <FooterLabelPrefix>Secrets:</FooterLabelPrefix> {footerMessage(info)}
      </FooterMessage>
    </FooterRow>
  );

  const tip = footerTooltip(info);
  const band = (content: ReactNode) => (
    <FooterBand
      data-testid="secret-storage-footer"
      data-tone={warn ? "warn" : "neutral"}
    >
      {content}
    </FooterBand>
  );

  // A keychain or in-memory store has no path, so there is nothing to copy and
  // the band stays inert — no button, no tooltip beyond what it already shows.
  if (!info.path) return band(row);

  return (
    <CopyButton value={info.path} timeout={1500}>
      {({ copied, copy }) =>
        band(
          <CaveatTooltip label={copied ? "Path copied" : tip}>
            {/* The accessible name has to carry **both** halves. `aria-label`
                replaces the button's descendant text, so labelling it only
                "Copy secrets file path …" announced the affordance and threw
                away the security status — "Plaintext file", "Unreadable
                file", "not owner-only" — which is the entire reason this band
                exists. The status leads, because it is the part a user needs
                before deciding to type a secret; the path follows, since a
                clipboard is no use to someone who cannot inspect it. Leading
                with the visible text also keeps the accessible name a
                superset of it (WCAG 2.5.3). */}
            <CopyTarget
              onClick={copy}
              aria-label={`Secrets: ${footerMessage(info)} Copy secrets file path: ${info.path}`}
            >
              {row}
            </CopyTarget>
          </CaveatTooltip>,
        )
      }
    </CopyButton>
  );
}
