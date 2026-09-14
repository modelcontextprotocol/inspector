import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { getAceText, setAceText } from "../../../test/aceEditor";
import type { Tool } from "@modelcontextprotocol/client";
import { EditReplayModal } from "./EditReplayModal";

const TOOLS: Tool[] = [
  {
    name: "echo",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" } },
    },
  },
  {
    name: "add",
    inputSchema: { type: "object", properties: { count: { type: "number" } } },
  },
];

const baseProps = {
  opened: true,
  method: "tools/call",
  onSend: vi.fn(),
  onClose: vi.fn(),
};

describe("EditReplayModal", () => {
  it("renders nothing while closed", () => {
    renderWithMantine(<EditReplayModal {...baseProps} opened={false} />);
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("seeds the editor with the entry's params and names the method", () => {
    renderWithMantine(
      <EditReplayModal {...baseProps} params={{ name: "echo" }} />,
    );
    expect(getAceText()).toBe('{\n  "name": "echo"\n}');
    expect(screen.getByText("tools/call")).toBeInTheDocument();
  });

  it("opens empty for a request that carried no params", () => {
    renderWithMantine(<EditReplayModal {...baseProps} method="tools/list" />);
    expect(getAceText()).toBe("");
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();
  });

  it("sends the edited params and closes", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onClose = vi.fn();
    renderWithMantine(
      <EditReplayModal
        {...baseProps}
        params={{ name: "echo" }}
        onSend={onSend}
        onClose={onClose}
      />,
    );
    await setAceText('{"name":"add","arguments":{"a":1}}');
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith({
      name: "add",
      arguments: { a: 1 },
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // `null`, not `undefined`: the caller has to be able to tell "the user
  // cleared the editor" from "the user did not edit anything" (#2151).
  it("reports an emptied editor as no params at all", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderWithMantine(
      <EditReplayModal
        {...baseProps}
        params={{ name: "echo" }}
        onSend={onSend}
      />,
    );
    await setAceText("");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith(null);
  });

  // Unlike the metadata editor, this modal has a commit gesture to gate — so
  // invalid text must disable it rather than silently sending the last value
  // that parsed.
  it("disables Send while the draft does not parse", async () => {
    renderWithMantine(
      <EditReplayModal {...baseProps} params={{ name: "echo" }} />,
    );
    await setAceText('{"name":');
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText(/Not valid JSON/)).toBeInTheDocument();
  });

  it("disables Send for JSON that is not an object", async () => {
    renderWithMantine(<EditReplayModal {...baseProps} />);
    await setAceText("42");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText(/must be a JSON object/i)).toBeInTheDocument();
  });

  // `JSON.parse("1e400")` yields `Infinity`, which `JSON.stringify` writes back
  // as `null` — so Send would dispatch a number the user never typed while the
  // editor still showed what they wrote.
  it("disables Send for a number that cannot survive being sent", async () => {
    renderWithMantine(<EditReplayModal {...baseProps} />);
    await setAceText('{"limit":1e400}');
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText(/Numbers must be finite/)).toBeInTheDocument();
  });

  // Replay dispatches through the typed client methods, so a param they have no
  // room for is dropped. Saying which, rather than seeding it into the editor,
  // is what keeps the modal from inviting an edit that Send discards.
  it("names the params replay cannot re-send", () => {
    renderWithMantine(
      <EditReplayModal
        {...baseProps}
        params={{ name: "echo" }}
        droppedParamKeys={["_meta"]}
      />,
    );
    expect(screen.getByText(/`_meta` is not re-sent/)).toBeInTheDocument();
  });

  it("says nothing when every param survives", () => {
    renderWithMantine(
      <EditReplayModal
        {...baseProps}
        params={{ name: "echo" }}
        droppedParamKeys={[]}
      />,
    );
    expect(screen.queryByText(/not re-sent/)).toBeNull();
  });

  it("agrees with its verb for several dropped params", () => {
    renderWithMantine(
      <EditReplayModal
        {...baseProps}
        params={{ cursor: "abc" }}
        droppedParamKeys={["_meta", "extra"]}
      />,
    );
    expect(
      screen.getByText(/`_meta`, `extra` are not re-sent/),
    ).toBeInTheDocument();
  });

  // Seeding from the projection is only half of it: a key the dispatcher does
  // not read can be *added* to the draft, and Send would then discard an edit
  // the user was looking at.
  it("disables Send for a key this method's dispatch would not read", async () => {
    renderWithMantine(
      <EditReplayModal {...baseProps} method="tools/list" params={undefined} />,
    );
    await setAceText('{"cursor":"abc","_meta":{"progressToken":1}}');
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(
      screen.getByText(/`_meta` is not carried by tools\/list/),
    ).toBeInTheDocument();
  });

  it("re-enables Send once the unsupported key is removed", async () => {
    renderWithMantine(
      <EditReplayModal {...baseProps} method="tools/list" params={undefined} />,
    );
    await setAceText('{"cursor":"abc","_meta":{}}');
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    await setAceText('{"cursor":"abc"}');
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();
    expect(screen.queryByText(/not carried by/)).toBeNull();
  });

  // The check is per method, not a fixed key list: `arguments` is read by a
  // tool call and by nothing on a list request.
  it("judges a key against the method it would be sent to", async () => {
    const { rerender } = renderWithMantine(
      <EditReplayModal {...baseProps} method="tools/call" />,
    );
    await setAceText('{"name":"echo","arguments":{"a":1}}');
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();

    rerender(<EditReplayModal {...baseProps} method="tools/list" />);
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(
      screen.getByText(/`name`, `arguments` are not carried by tools\/list/),
    ).toBeInTheDocument();
  });

  // Surviving the key check is not the same as being sent as written:
  // `replayProtocolRequest` applies `arguments ?? {}`, so a null shown in the
  // editor reaches the wire as `{}`.
  it("disables Send for a null arguments, which would be sent as {}", async () => {
    renderWithMantine(<EditReplayModal {...baseProps} method="tools/call" />);
    await setAceText('{"name":"echo","arguments":null}');
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText(/sent as `\{\}` when null/)).toBeInTheDocument();
  });

  it("disables Send for a non-object arguments", async () => {
    renderWithMantine(<EditReplayModal {...baseProps} method="tools/call" />);
    await setAceText('{"name":"echo","arguments":[1,2]}');
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(
      screen.getByText(/`arguments` must be a JSON object/),
    ).toBeInTheDocument();
  });

  // `JSON.parse` rounds a whole number past 2^53−1 to the nearest double, so
  // the draft shows digits the wire will not carry.
  it("disables Send for a whole number that loses digits when parsed", async () => {
    renderWithMantine(<EditReplayModal {...baseProps} method="tools/call" />);
    await setAceText('{"name":"echo","arguments":{"id":9007199254740993}}');
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText(/would not arrive as written/)).toBeInTheDocument();
  });

  it("disables Send for a non-string prompt argument", async () => {
    renderWithMantine(<EditReplayModal {...baseProps} method="prompts/get" />);
    await setAceText('{"name":"greet","arguments":{"count":2}}');
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(
      screen.getByText(/`count` would be sent as JSON text/),
    ).toBeInTheDocument();
  });

  // `callTool` coerces string arguments to the type the schema declares, so
  // `"2"` against a numeric field is sent as `2`.
  it("disables Send for a tool argument the schema would coerce", async () => {
    renderWithMantine(
      <EditReplayModal {...baseProps} method="tools/call" tools={TOOLS} />,
    );
    await setAceText('{"name":"add","arguments":{"count":"2"}}');
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText(/`count` would be converted/)).toBeInTheDocument();
  });

  // `name` is editable, so the schema to validate against is whichever tool the
  // draft *now* names — not the one the entry happened to call.
  it("re-validates against the tool the draft retargets to", async () => {
    renderWithMantine(
      <EditReplayModal
        {...baseProps}
        method="tools/call"
        params={{ name: "echo", arguments: { message: "hi" } }}
        tools={TOOLS}
      />,
    );
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();

    // Retargeted at `add`, whose `count` is a number — the string would coerce.
    await setAceText('{"name":"add","arguments":{"count":"2"}}');
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    // And back: `echo`'s `message` is a string, so nothing is converted.
    await setAceText('{"name":"echo","arguments":{"message":"2"}}');
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();
  });

  // `JSON.parse` keeps only the last occurrence, so the draft would show two
  // cursors and Send would dispatch one.
  it("disables Send for a document that names the same member twice", async () => {
    renderWithMantine(<EditReplayModal {...baseProps} method="tools/list" />);
    await setAceText('{"cursor":"first","cursor":"second"}');
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText(/`cursor` appears twice/)).toBeInTheDocument();
  });

  it("closes without sending when cancelled", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onClose = vi.fn();
    renderWithMantine(
      <EditReplayModal {...baseProps} onSend={onSend} onClose={onClose} />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  // The draft belongs to the one opening of the modal it was typed in.
  // Reopening must show the entry's params again, not whatever was typed and
  // abandoned last time.
  it("reseeds from the entry when reopened", async () => {
    const { rerender } = renderWithMantine(
      <EditReplayModal {...baseProps} params={{ name: "echo" }} />,
    );
    await setAceText('{"name":"abandoned"}');

    rerender(
      <EditReplayModal
        {...baseProps}
        opened={false}
        params={{ name: "echo" }}
      />,
    );
    rerender(<EditReplayModal {...baseProps} params={{ name: "echo" }} />);
    expect(getAceText()).toBe('{\n  "name": "echo"\n}');
  });
});
