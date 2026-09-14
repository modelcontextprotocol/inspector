import { useState } from "react";
import type { Tool } from "@modelcontextprotocol/client";
import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { JsonEditor } from "../../elements/JsonEditor/JsonEditor";
import {
  duplicateKeyError,
  findDuplicateObjectKey,
  findUnsendableNumberLiteral,
  isJsonObject,
  unsendableNumberError,
} from "../../../utils/jsonObjectDraft";
import {
  replayableParams,
  reshapedReplayParam,
} from "../../../lib/protocolReplay";
import { isSerializableJson } from "@inspector/core/json/jsonUtils.js";

export interface EditReplayModalProps {
  opened: boolean;
  /** The method being replayed, shown so the editor is unambiguous. */
  method: string;
  /**
   * The originating entry's params, seeded into the editor — already reduced to
   * the ones replay will actually read. See {@link droppedParamKeys}.
   */
  params?: Record<string, unknown>;
  /**
   * Param names the entry carried that replay cannot re-send, so the modal can
   * say so rather than leave the difference to be discovered.
   *
   * Replay dispatches through the typed `InspectorClient` methods rather than
   * re-sending the captured frame, and those signatures have no room for
   * `_meta` (or for anything but `cursor` on a list request). Seeding the
   * editor with them would invite an edit that Send silently discards, which is
   * the one thing an inspector must not do.
   */
  droppedParamKeys?: string[];
  /**
   * The connected server's tools, used only to detect an argument the client
   * would coerce to the type the schema declares — see
   * {@link reshapedReplayParam}.
   *
   * The whole list rather than the one the entry called, because `name` is
   * itself editable: retargeting an `echo` replay at `add` has to be validated
   * against `add`'s schema, not the one the entry happened to use.
   */
  tools?: Tool[];
  /**
   * Re-issue the request with these params. `null` means "send no params",
   * which is a request an empty editor can legitimately express — see
   * {@link ReplayParamsOverride} for why it is not `undefined`.
   */
  onSend: (params: Record<string, unknown> | null) => void;
  onClose: () => void;
}

const MethodText = Text.withProps({
  size: "sm",
  c: "dimmed",
  ff: "monospace",
});

const Footer = Group.withProps({ justify: "flex-end", gap: "sm" });

// Names the params replay cannot carry. `light` and gray rather than a warning
// colour: nothing is wrong and there is nothing for the user to fix — it is a
// property of how replay dispatches.
const DroppedNote = Alert.withProps({ variant: "light", color: "gray" });

/** "`a`, `b` are" / "`a` is" — the list, agreeing with its verb. */
function formatDroppedKeys(keys: string[]): string {
  const names = keys.map((key) => `\`${key}\``).join(", ");
  return `${names} ${keys.length === 1 ? "is" : "are"}`;
}

/**
 * What the editor's text currently means: the params to send, or why they
 * cannot be sent.
 *
 * Empty text is "no params" rather than an error — a `tools/list` replay
 * genuinely carries none, and an empty editor wearing a red error would read as
 * broken. A non-object is reported separately from text that is not JSON at
 * all: JSON-RPC `params` must be a structured value, so `42` is a shape that
 * cannot be sent however finished it is. A number that overflows, and a key
 * this method's dispatch does not read, are the two subtle cases — see the
 * notes on those branches.
 */
function parseParamsDraft(
  method: string,
  text: string,
  tools: Tool[] | undefined,
):
  | { ok: true; value: Record<string, unknown> | null }
  | { ok: false; error: string } {
  if (text.trim() === "") return { ok: true, value: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not valid JSON — this cannot be sent" };
  }
  if (!isJsonObject(parsed)) {
    return { ok: false, error: "Params must be a JSON object (`{ … }`)" };
  }
  // `JSON.parse` accepts numeric literals it cannot represent: `1e400` parses to
  // `Infinity`, which `JSON.stringify` then writes as `null`. Accepting it here
  // would show the user one value and send another — the one thing an inspector
  // must not do. Same guard, same reason, as `parseJsonObjectDraft`.
  if (!isSerializableJson(parsed)) {
    return {
      ok: false,
      error:
        "Numbers must be finite — a value like `1e400` overflows and would be sent as null",
    };
  }
  const unsendable = findUnsendableNumberLiteral(text);
  if (unsendable !== null) {
    return { ok: false, error: unsendableNumberError(unsendable) };
  }
  const duplicate = findDuplicateObjectKey(text);
  if (duplicate !== null) {
    return { ok: false, error: duplicateKeyError(duplicate) };
  }
  // Seeding from the projection is only half of it: a key the dispatcher does
  // not read can also be *added* to the draft, and Send would then discard an
  // edit the user was looking at. Checked with the same function the seed is
  // built from, so the editor and the dispatcher cannot disagree about which
  // keys survive.
  const { dropped } = replayableParams(method, parsed);
  if (dropped.length > 0) {
    return {
      ok: false,
      error: `${formatDroppedKeys(dropped)} not carried by ${method} — remove ${
        dropped.length === 1 ? "it" : "them"
      } so this matches what is sent`,
    };
  }
  // Surviving the key check is not the same as being sent as written: see
  // `reshapedReplayParam` for the two ways `arguments` does not.
  // Resolved from the *draft's* name, so retargeting the call re-validates
  // against the tool it would actually reach.
  const named = typeof parsed.name === "string" ? parsed.name : undefined;
  const reshaped = reshapedReplayParam(
    method,
    parsed,
    tools?.find((candidate) => candidate.name === named),
  );
  if (reshaped !== null) {
    return { ok: false, error: reshaped };
  }
  return { ok: true, value: parsed };
}

/**
 * The modal's body, split out so its draft is owned by a component Mantine
 * unmounts on close — which is what makes reopening start from the entry's
 * params again rather than from whatever was last typed and abandoned.
 */
function EditReplayForm({
  method,
  params,
  droppedParamKeys,
  tools,
  onSend,
  onClose,
}: Omit<EditReplayModalProps, "opened">) {
  const [draft, setDraft] = useState(() =>
    params === undefined ? "" : JSON.stringify(params, null, 2),
  );
  const parsed = parseParamsDraft(method, draft, tools);

  return (
    <Stack gap="sm">
      <MethodText>{method}</MethodText>
      {droppedParamKeys && droppedParamKeys.length > 0 && (
        <DroppedNote>
          <Text size="xs">
            {`Replay re-issues this request through the client's own ${method}
              method, which carries only the fields below, so
              ${formatDroppedKeys(droppedParamKeys)} not re-sent.`}
          </Text>
        </DroppedNote>
      )}
      <JsonEditor
        ariaLabel="Request params"
        label="Params"
        value={draft}
        onChange={setDraft}
        error={parsed.ok ? undefined : parsed.error}
        minLines={8}
        maxLines={24}
      />
      <Footer>
        <Button variant="default" onClick={onClose}>
          Cancel
        </Button>
        <Button
          // Unlike the metadata editor, this modal *has* a commit gesture to
          // gate — so invalid text disables Send rather than quietly sending
          // the last value that parsed. Same reasoning as `SchemaJsonField`.
          disabled={!parsed.ok}
          onClick={() => {
            /* v8 ignore next -- Send is disabled while the draft is invalid */
            if (!parsed.ok) return;
            onSend(parsed.value);
            onClose();
          }}
        >
          Send
        </Button>
      </Footer>
    </Stack>
  );
}

/**
 * Edit a Protocol entry's request params, then replay it (#2151).
 *
 * Replay itself is one click and unchanged; this is a second way to *supply*
 * the params, not a second replay implementation — Send dispatches through the
 * same `replayProtocolRequest` the plain Replay button does, so the same
 * method gate and the same "Can't replay" failure toast apply.
 */
export function EditReplayModal({
  opened,
  method,
  params,
  droppedParamKeys,
  tools,
  onSend,
  onClose,
}: EditReplayModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title="Edit and replay" size="lg">
      <EditReplayForm
        method={method}
        params={params}
        droppedParamKeys={droppedParamKeys}
        tools={tools}
        onSend={onSend}
        onClose={onClose}
      />
    </Modal>
  );
}
