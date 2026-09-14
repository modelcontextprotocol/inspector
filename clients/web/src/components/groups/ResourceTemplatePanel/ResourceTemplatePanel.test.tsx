import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { ResourceTemplateType as ResourceTemplate } from "@modelcontextprotocol/client";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ResourceTemplatePanel } from "./ResourceTemplatePanel";

const singleVarTemplate: ResourceTemplate = {
  name: "User Profile",
  uriTemplate: "file:///users/{userId}/profile",
  description: "Fetch a user profile.",
};

const titledTemplate: ResourceTemplate = {
  name: "Table Row",
  title: "Database Row",
  uriTemplate: "db://tables/{tableName}/rows/{rowId}",
};

const annotatedTemplate: ResourceTemplate = {
  name: "Dynamic",
  uriTemplate: "resource://dynamic/{id}",
  annotations: { audience: ["user"], priority: 0.8 },
};

const noVarTemplate: ResourceTemplate = {
  name: "Static",
  uriTemplate: "file:///static.txt",
};

const queryTemplate: ResourceTemplate = {
  name: "Events",
  uriTemplate: "foobar://events{?topic}",
};

describe("ResourceTemplatePanel", () => {
  it("renders the template title (or name) and description", () => {
    renderWithMantine(
      <ResourceTemplatePanel
        template={singleVarTemplate}
        onReadResource={vi.fn()}
      />,
    );
    expect(screen.getByText("User Profile Template")).toBeInTheDocument();
    expect(screen.getByText("Fetch a user profile.")).toBeInTheDocument();
  });

  it("prefers the title over the name when present", () => {
    renderWithMantine(
      <ResourceTemplatePanel
        template={titledTemplate}
        onReadResource={vi.fn()}
      />,
    );
    expect(screen.getByText("Database Row Template")).toBeInTheDocument();
  });

  it("renders an input per template variable", () => {
    renderWithMantine(
      <ResourceTemplatePanel
        template={titledTemplate}
        onReadResource={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("tableName")).toBeInTheDocument();
    expect(screen.getByLabelText("rowId")).toBeInTheDocument();
  });

  it("disables Read Resource until all variables are filled", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ResourceTemplatePanel
        template={titledTemplate}
        onReadResource={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: "Read Resource" });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText("tableName"), "users");
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText("rowId"), "42");
    expect(button).not.toBeDisabled();
  });

  it("invokes onReadResource with the resolved URI when submitted", async () => {
    const user = userEvent.setup();
    const onReadResource = vi.fn();
    renderWithMantine(
      <ResourceTemplatePanel
        template={singleVarTemplate}
        onReadResource={onReadResource}
      />,
    );
    await user.type(screen.getByLabelText("userId"), "alice");
    await user.click(screen.getByRole("button", { name: "Read Resource" }));
    expect(onReadResource).toHaveBeenCalledWith("file:///users/alice/profile");
  });

  it("updates the URI preview as variables change", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ResourceTemplatePanel
        template={singleVarTemplate}
        onReadResource={vi.fn()}
      />,
    );
    expect(
      screen.getByText("file:///users/{userId}/profile"),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("userId"), "bob");
    expect(screen.getByText("file:///users/bob/profile")).toBeInTheDocument();
  });

  it("clears a variable via its Clear button (non-autocomplete branch)", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ResourceTemplatePanel
        template={singleVarTemplate}
        onReadResource={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("userId");
    await user.type(input, "alice");
    expect(input).toHaveValue("alice");
    // The Clear button only renders while the value is non-empty.
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(input).toHaveValue("");
  });

  it("renders annotation badges when present", () => {
    renderWithMantine(
      <ResourceTemplatePanel
        template={annotatedTemplate}
        onReadResource={vi.fn()}
      />,
    );
    expect(screen.getByText("audience: user")).toBeInTheDocument();
    expect(screen.getByText("priority: high")).toBeInTheDocument();
  });

  it("renders without description when not provided", () => {
    renderWithMantine(
      <ResourceTemplatePanel
        template={titledTemplate}
        onReadResource={vi.fn()}
      />,
    );
    expect(screen.queryByText("Fetch a user profile.")).not.toBeInTheDocument();
  });

  it("enables submission immediately when there are no variables", () => {
    renderWithMantine(
      <ResourceTemplatePanel
        template={noVarTemplate}
        onReadResource={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Read Resource" }),
    ).not.toBeDisabled();
  });

  describe("RFC 6570 expansion (#1919)", () => {
    it("renders an input for a query expression the old regex could not see", () => {
      renderWithMantine(
        <ResourceTemplatePanel
          template={queryTemplate}
          onReadResource={vi.fn()}
        />,
      );
      expect(screen.getByLabelText("topic")).toBeInTheDocument();
    });

    it("percent-encodes a reserved character in a simple variable", async () => {
      const user = userEvent.setup();
      const onReadResource = vi.fn();
      renderWithMantine(
        <ResourceTemplatePanel
          template={singleVarTemplate}
          onReadResource={onReadResource}
        />,
      );
      await user.type(screen.getByLabelText("userId"), "foo/bar");
      await user.click(screen.getByRole("button", { name: "Read Resource" }));
      expect(onReadResource).toHaveBeenCalledWith(
        "file:///users/foo%2Fbar/profile",
      );
    });

    it("builds an encoded query expression for {?topic}", async () => {
      const user = userEvent.setup();
      const onReadResource = vi.fn();
      renderWithMantine(
        <ResourceTemplatePanel
          template={queryTemplate}
          onReadResource={onReadResource}
        />,
      );
      await user.type(screen.getByLabelText("topic"), "foo/bar");
      await user.click(screen.getByRole("button", { name: "Read Resource" }));
      expect(onReadResource).toHaveBeenCalledWith(
        "foobar://events?topic=foo%2Fbar",
      );
    });

    it("marks a query variable Optional and does not gate the read on it", async () => {
      const user = userEvent.setup();
      const onReadResource = vi.fn();
      renderWithMantine(
        <ResourceTemplatePanel
          template={queryTemplate}
          onReadResource={onReadResource}
        />,
      );
      expect(screen.getByText("Optional")).toBeInTheDocument();
      const button = screen.getByRole("button", { name: "Read Resource" });
      expect(button).not.toBeDisabled();
      // Left blank, the whole expression drops out per RFC 6570.
      await user.click(button);
      expect(onReadResource).toHaveBeenCalledWith("foobar://events");
    });

    it("does not mark a required simple variable Optional", () => {
      renderWithMantine(
        <ResourceTemplatePanel
          template={singleVarTemplate}
          onReadResource={vi.fn()}
        />,
      );
      expect(screen.queryByText("Optional")).not.toBeInTheDocument();
    });

    it("previews the query expression verbatim until it is filled", async () => {
      const user = userEvent.setup();
      renderWithMantine(
        <ResourceTemplatePanel
          template={queryTemplate}
          onReadResource={vi.fn()}
        />,
      );
      expect(screen.getByText("foobar://events{?topic}")).toBeInTheDocument();
      await user.type(screen.getByLabelText("topic"), "news");
      expect(
        screen.getByText("foobar://events?topic=news"),
      ).toBeInTheDocument();
    });

    // A template the server advertised can be malformed. There is no URI to
    // send for one, so the read is withheld and the reason shown -- reading the
    // raw template with its braces intact would draw a confusing "not found"
    // from the server for a defect that is not the user's.
    it.each([
      ["an out-of-grammar prefix modifier", "x://items/{id:abc}"],
      ["an expression declaring no variable", "x://items/{}"],
    ])("refuses to read a template with %s", (_label, uriTemplate) => {
      const onReadResource = vi.fn();
      renderWithMantine(
        <ResourceTemplatePanel
          template={{ name: "Broken", uriTemplate }}
          onReadResource={onReadResource}
        />,
      );
      expect(
        screen.getByRole("button", { name: "Read Resource" }),
      ).toBeDisabled();
      expect(screen.getByText(/Invalid RFC 6570 varspec/)).toBeInTheDocument();
      expect(onReadResource).not.toHaveBeenCalled();
    });

    it("names every unmet group, so a disabled button always has a reason", async () => {
      // With `{a,b}{b,c}{a,c}`, filling `b` satisfies the first two groups. A
      // per-field hint then looks satisfied while Read Resource stays disabled
      // on the third -- so the outstanding requirement is stated form-level.
      const user = userEvent.setup();
      renderWithMantine(
        <ResourceTemplatePanel
          template={{ name: "Shared", uriTemplate: "x://{a,b}{b,c}{a,c}" }}
          onReadResource={vi.fn()}
        />,
      );
      expect(screen.getByText(/Still needed:/)).toHaveTextContent(
        "Still needed: a or b; b or c; a or c",
      );
      await user.type(screen.getByLabelText("b"), "1");
      expect(screen.getByText(/Still needed:/)).toHaveTextContent(
        "Still needed: a or c",
      );
      expect(
        screen.getByRole("button", { name: "Read Resource" }),
      ).toBeDisabled();
      await user.type(screen.getByLabelText("a"), "2");
      expect(screen.queryByText(/Still needed:/)).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Read Resource" }),
      ).toBeEnabled();
    });

    it("hints every shared group a variable sits in, not just the first", () => {
      renderWithMantine(
        <ResourceTemplatePanel
          template={{ name: "Shared", uriTemplate: "x://{a,b}{a,c}" }}
          onReadResource={vi.fn()}
        />,
      );
      expect(
        screen.getByText("Any one of each: a, b; a, c"),
      ).toBeInTheDocument();
    });

    it("treats a name repeated in one expression as a plain requirement", () => {
      renderWithMantine(
        <ResourceTemplatePanel
          template={{ name: "Twice", uriTemplate: "x://{a,a}" }}
          onReadResource={vi.fn()}
        />,
      );
      // Not "Any one of: a, a" -- it is one field, required.
      expect(screen.queryByText(/Any one of/)).not.toBeInTheDocument();
      expect(screen.getByText("Still needed: a")).toBeInTheDocument();
    });

    it("renders an autocomplete field for a name that collides with Object.prototype", async () => {
      // `toString` is a valid RFC 6570 varname and `completions` starts empty,
      // so a bare `completions[varName] ?? []` handed Mantine the prototype's
      // *function* as its options array (`??` catches only null/undefined) and
      // the field crashed on first render.
      const user = userEvent.setup();
      const onCompleteArgument = vi.fn().mockResolvedValue(["a", "b"]);
      const onReadResource = vi.fn();
      renderWithMantine(
        <ResourceTemplatePanel
          template={{ name: "Proto", uriTemplate: "x://{toString}" }}
          onReadResource={onReadResource}
          onCompleteArgument={onCompleteArgument}
          completionsSupported
        />,
      );
      // By role, not label: "toString" also appears in the "Still needed" line.
      const input = screen.getByRole("textbox", { name: "toString" });
      expect(input).toBeInTheDocument();
      await user.type(input, "v");
      await user.click(screen.getByRole("button", { name: "Read Resource" }));
      expect(onReadResource).toHaveBeenCalledWith("x://v");
    });

    it("shows the malformed template unexpanded in the preview", () => {
      renderWithMantine(
        <ResourceTemplatePanel
          template={{ name: "Broken", uriTemplate: "x://items/{}" }}
          onReadResource={vi.fn()}
        />,
      );
      expect(screen.getByText("x://items/{}")).toBeInTheDocument();
    });
  });

  describe("completions", () => {
    it("fires a completion immediately on focus before any keystroke", async () => {
      const user = userEvent.setup();
      const onCompleteArgument = vi
        .fn<
          (
            argName: string,
            value: string,
            context: Record<string, string>,
          ) => Promise<string[]>
        >()
        .mockResolvedValue(["alpha", "alphabet"]);

      renderWithMantine(
        <ResourceTemplatePanel
          template={titledTemplate}
          onReadResource={vi.fn()}
          completionsSupported
          onCompleteArgument={onCompleteArgument}
        />,
      );

      await user.click(screen.getByRole("textbox", { name: "tableName" }));
      await new Promise((r) => setTimeout(r, 0));
      // Empty value, empty sibling — but the sibling key is still
      // present so the server sees the full argument set.
      expect(onCompleteArgument).toHaveBeenCalledWith("tableName", "", {
        rowId: "",
      });
      expect(await screen.findByText("alpha")).toBeInTheDocument();
    });

    it("calls onCompleteArgument (debounced) and surfaces values when supported", async () => {
      const user = userEvent.setup();
      const onCompleteArgument = vi
        .fn<
          (
            argName: string,
            value: string,
            context: Record<string, string>,
          ) => Promise<string[]>
        >()
        .mockResolvedValue(["alpha", "alphabet"]);

      renderWithMantine(
        <ResourceTemplatePanel
          template={singleVarTemplate}
          onReadResource={vi.fn()}
          completionsSupported
          onCompleteArgument={onCompleteArgument}
        />,
      );

      await user.type(screen.getByRole("textbox", { name: "userId" }), "al");
      // Wait past the 300ms debounce.
      await new Promise((r) => setTimeout(r, 400));
      // user.type focuses first (firing one immediate completion) and
      // then types the characters (firing the debounced one). Only the
      // typed-prefix call is the one we care about here.
      expect(onCompleteArgument).toHaveBeenLastCalledWith("userId", "al", {});

      // Server-returned values surface in the Autocomplete dropdown.
      expect(await screen.findByText("alpha")).toBeInTheDocument();
      expect(screen.getByText("alphabet")).toBeInTheDocument();
    });

    it("passes sibling variables as completion context", async () => {
      const user = userEvent.setup();
      const onCompleteArgument = vi
        .fn<
          (
            argName: string,
            value: string,
            context: Record<string, string>,
          ) => Promise<string[]>
        >()
        .mockResolvedValue([]);

      renderWithMantine(
        <ResourceTemplatePanel
          template={titledTemplate}
          onReadResource={vi.fn()}
          completionsSupported
          onCompleteArgument={onCompleteArgument}
        />,
      );

      await user.type(
        screen.getByRole("textbox", { name: "tableName" }),
        "users",
      );
      await new Promise((r) => setTimeout(r, 400));
      // The completing arg ("tableName") is excluded from context; only
      // the other variables ride along.
      expect(onCompleteArgument).toHaveBeenLastCalledWith(
        "tableName",
        "users",
        { rowId: "" },
      );

      await user.type(screen.getByRole("textbox", { name: "rowId" }), "42");
      await new Promise((r) => setTimeout(r, 400));
      expect(onCompleteArgument).toHaveBeenLastCalledWith("rowId", "42", {
        tableName: "users",
      });
    });

    it("clears stale dropdown options the instant a new keystroke arrives", async () => {
      const user = userEvent.setup();
      const deferred: Array<{
        value: string;
        resolve: (values: string[]) => void;
      }> = [];
      const onCompleteArgument = vi.fn(
        (_argName: string, value: string) =>
          new Promise<string[]>((resolve) => {
            deferred.push({ value, resolve });
          }),
      );

      renderWithMantine(
        <ResourceTemplatePanel
          template={singleVarTemplate}
          onReadResource={vi.fn()}
          completionsSupported
          onCompleteArgument={onCompleteArgument}
        />,
      );

      // Focus → first call (value=""). Resolve so the dropdown has
      // something to show.
      await user.click(screen.getByRole("textbox", { name: "userId" }));
      await new Promise((r) => setTimeout(r, 0));
      expect(deferred.length).toBe(1);
      deferred[0].resolve(["alpha", "alphabet"]);
      expect(await screen.findByText("alpha")).toBeInTheDocument();

      // Type a new character — the keystroke handler must drop the
      // stale options immediately so the dropdown doesn't show
      // "alpha" / "alphabet" while the next request is in flight
      // (300ms debounce + network latency).
      await user.type(screen.getByRole("textbox", { name: "userId" }), "z");
      expect(screen.queryByText("alpha")).not.toBeInTheDocument();
      expect(screen.queryByText("alphabet")).not.toBeInTheDocument();
    });

    it("surfaces an empty dropdown when the completion request rejects", async () => {
      const user = userEvent.setup();
      // Focus call resolves with options; the debounced keystroke call
      // rejects. The rejection (not aborted) must reset the dropdown to [].
      const onCompleteArgument = vi
        .fn<
          (
            argName: string,
            value: string,
            context: Record<string, string>,
          ) => Promise<string[]>
        >()
        .mockResolvedValueOnce(["alpha", "alphabet"])
        .mockRejectedValueOnce(new Error("completion failed"));

      renderWithMantine(
        <ResourceTemplatePanel
          template={singleVarTemplate}
          onReadResource={vi.fn()}
          completionsSupported
          onCompleteArgument={onCompleteArgument}
        />,
      );

      const input = screen.getByRole("textbox", { name: "userId" });
      await user.click(input);
      await new Promise((r) => setTimeout(r, 0));
      expect(await screen.findByText("alpha")).toBeInTheDocument();

      await user.type(input, "z");
      await new Promise((r) => setTimeout(r, 400));
      expect(screen.queryByText("alpha")).not.toBeInTheDocument();
      expect(screen.queryByText("alphabet")).not.toBeInTheDocument();
    });

    it("cancels a pending debounce timer when the input is re-focused", async () => {
      const user = userEvent.setup();
      const onCompleteArgument = vi
        .fn<
          (
            argName: string,
            value: string,
            context: Record<string, string>,
          ) => Promise<string[]>
        >()
        .mockResolvedValue([]);

      renderWithMantine(
        <ResourceTemplatePanel
          template={titledTemplate}
          onReadResource={vi.fn()}
          completionsSupported
          onCompleteArgument={onCompleteArgument}
        />,
      );

      const tableInput = screen.getByRole("textbox", { name: "tableName" });
      const rowInput = screen.getByRole("textbox", { name: "rowId" });

      // Type into tableName → schedules a debounce timer. Move focus away
      // and back before the 300ms fires so handleVariableFocus sees a
      // pending timer for "tableName" and clears it.
      await user.type(tableInput, "u");
      await user.click(rowInput);
      await user.click(tableInput);
      onCompleteArgument.mockClear();
      await new Promise((r) => setTimeout(r, 400));
      const tableCalls = onCompleteArgument.mock.calls.filter(
        ([n]) => n === "tableName",
      );
      // Only the focus-fire call (value "u"), never the cancelled debounce.
      expect(tableCalls.every(([, v]) => v === "u")).toBe(true);
    });

    it("drops a stale in-flight response when a faster keystroke arrives", async () => {
      const user = userEvent.setup();
      const calls: Array<{
        value: string;
        resolve: (values: string[]) => void;
      }> = [];
      const onCompleteArgument = vi.fn(
        (_argName: string, value: string) =>
          new Promise<string[]>((resolve) => {
            calls.push({ value, resolve });
          }),
      );

      renderWithMantine(
        <ResourceTemplatePanel
          template={singleVarTemplate}
          onReadResource={vi.fn()}
          completionsSupported
          onCompleteArgument={onCompleteArgument}
        />,
      );

      // Focus → first call (value=""). Type "h" → second call after
      // debounce. Type "i" → third call after debounce, which aborts the
      // "h" controller.
      const input = screen.getByRole("textbox", { name: "userId" });
      await user.type(input, "h");
      await new Promise((r) => setTimeout(r, 350));
      await user.type(input, "i");
      await new Promise((r) => setTimeout(r, 350));

      const hi = calls.find((c) => c.value === "hi");
      const h = calls.find((c) => c.value === "h");
      expect(hi).toBeDefined();
      expect(h).toBeDefined();
      // Resolve the stale "h" after it was aborted — its signal.aborted
      // guard drops the response so it can't overwrite the fresh one.
      h?.resolve(["from-stale-h"]);
      hi?.resolve(["from-fresh-hi"]);
      await new Promise((r) => setTimeout(r, 0));

      expect(await screen.findByText("from-fresh-hi")).toBeInTheDocument();
      expect(screen.queryByText("from-stale-h")).not.toBeInTheDocument();
    });

    it("aborts in-flight completion requests on unmount", async () => {
      const user = userEvent.setup();
      // A request that never settles, so it is still in flight at unmount.
      const onCompleteArgument = vi.fn(() => new Promise<string[]>(() => {}));

      const { unmount } = renderWithMantine(
        <ResourceTemplatePanel
          template={singleVarTemplate}
          onReadResource={vi.fn()}
          completionsSupported
          onCompleteArgument={onCompleteArgument}
        />,
      );

      // Focus fires a completion immediately, leaving an in-flight request.
      await user.click(screen.getByRole("textbox", { name: "userId" }));
      await new Promise((r) => setTimeout(r, 0));
      expect(onCompleteArgument).toHaveBeenCalled();

      // The unmount-cleanup effect iterates the in-flight controllers and
      // aborts each — this must not throw.
      expect(() => unmount()).not.toThrow();
    });

    it("does not fire completions on focus when completions are unsupported", async () => {
      const user = userEvent.setup();
      const onCompleteArgument = vi.fn();
      renderWithMantine(
        <ResourceTemplatePanel
          template={singleVarTemplate}
          onReadResource={vi.fn()}
          completionsSupported={false}
          onCompleteArgument={onCompleteArgument}
        />,
      );
      // Focusing the plain TextInput hits the early `!useAutocomplete`
      // return in handleVariableFocus.
      await user.click(screen.getByLabelText("userId"));
      await new Promise((r) => setTimeout(r, 0));
      expect(onCompleteArgument).not.toHaveBeenCalled();
    });

    it("does not call onCompleteArgument when completions are unsupported", async () => {
      const user = userEvent.setup();
      const onCompleteArgument = vi.fn();
      renderWithMantine(
        <ResourceTemplatePanel
          template={singleVarTemplate}
          onReadResource={vi.fn()}
          completionsSupported={false}
          onCompleteArgument={onCompleteArgument}
        />,
      );
      await user.type(screen.getByLabelText("userId"), "ab");
      await new Promise((r) => setTimeout(r, 400));
      expect(onCompleteArgument).not.toHaveBeenCalled();
    });
  });
});
