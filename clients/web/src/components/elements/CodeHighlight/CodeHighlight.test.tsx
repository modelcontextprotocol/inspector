import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderWithMantine,
  screen,
  waitFor,
} from "../../../test/renderWithMantine";

// --- Mock the lazily-imported react-syntax-highlighter chunks -----------------
// The prism-light runtime: a component that renders its code into a probeable
// element, plus a `registerLanguage` spy so tests can assert load behavior.
const registerLanguage = vi.fn();
vi.mock("react-syntax-highlighter/dist/esm/prism-light", () => ({
  default: Object.assign(
    ({ language, children }: { language: string; children: string }) => (
      <pre data-testid="prism" data-language={language}>
        {children}
      </pre>
    ),
    { registerLanguage },
  ),
}));
vi.mock("react-syntax-highlighter/dist/esm/styles/prism/tomorrow", () => ({
  default: {},
}));
vi.mock("react-syntax-highlighter/dist/esm/languages/prism/json", () => ({
  default: { __grammar: "json" },
}));
vi.mock("react-syntax-highlighter/dist/esm/languages/prism/markup", () => ({
  default: { __grammar: "markup" },
}));
vi.mock("react-syntax-highlighter/dist/esm/languages/prism/css", () => ({
  default: { __grammar: "css" },
}));
vi.mock("react-syntax-highlighter/dist/esm/languages/prism/yaml", () => ({
  default: { __grammar: "yaml" },
}));
// markdown's import rejects, exercising the failed-load path.
vi.mock("react-syntax-highlighter/dist/esm/languages/prism/markdown", () => {
  throw new Error("grammar load failed");
});

// Module-level caches in CodeHighlight must reset between tests; re-import fresh.
async function loadComponent() {
  vi.resetModules();
  registerLanguage.mockClear();
  return (await import("./CodeHighlight")).CodeHighlight;
}

beforeEach(() => {
  vi.resetModules();
});

describe("CodeHighlight", () => {
  it("renders plain code initially, then upgrades to the highlighter", async () => {
    const CodeHighlight = await loadComponent();
    renderWithMantine(<CodeHighlight language="json" code='{"a":1}' />);
    // Plain Mantine Code before the grammar resolves.
    expect(screen.queryByTestId("prism")).not.toBeInTheDocument();
    expect(screen.getByText('{"a":1}')).toBeInTheDocument();
    // After the lazy grammar loads, the prism runtime takes over.
    const prism = await screen.findByTestId("prism");
    expect(prism).toHaveAttribute("data-language", "json");
    expect(registerLanguage).toHaveBeenCalledWith("json", {
      __grammar: "json",
    });
  });

  it("resolves the xml alias to the markup grammar", async () => {
    const CodeHighlight = await loadComponent();
    renderWithMantine(<CodeHighlight language="xml" code="<a/>" />);
    const prism = await screen.findByTestId("prism");
    expect(prism).toHaveAttribute("data-language", "markup");
    expect(registerLanguage).toHaveBeenCalledWith("markup", {
      __grammar: "markup",
    });
  });

  it("stays plain for an unknown language and never imports a grammar", async () => {
    const CodeHighlight = await loadComponent();
    renderWithMantine(<CodeHighlight language="brainfuck" code="++." />);
    // Give the effect a chance to run.
    await waitFor(() => expect(screen.getByText("++.")).toBeInTheDocument());
    expect(screen.queryByTestId("prism")).not.toBeInTheDocument();
    expect(registerLanguage).not.toHaveBeenCalled();
  });

  it("stays plain when a grammar import rejects", async () => {
    const CodeHighlight = await loadComponent();
    renderWithMantine(<CodeHighlight language="md" code="# hi" />);
    await waitFor(() => expect(screen.getByText("# hi")).toBeInTheDocument());
    // markdown's import throws → failed load → never registered, stays plain.
    expect(screen.queryByTestId("prism")).not.toBeInTheDocument();
    expect(registerLanguage).not.toHaveBeenCalledWith(
      "markdown",
      expect.anything(),
    );
  });

  it("shares one grammar load across concurrent mounts of the same language", async () => {
    const CodeHighlight = await loadComponent();
    renderWithMantine(
      <>
        <CodeHighlight language="css" code=".a{}" />
        <CodeHighlight language="css" code=".b{}" />
      </>,
    );
    await waitFor(() => expect(screen.getAllByTestId("prism")).toHaveLength(2));
    // Both mounts shared the in-flight promise → grammar registered once.
    expect(registerLanguage).toHaveBeenCalledTimes(1);
    expect(registerLanguage).toHaveBeenCalledWith("css", { __grammar: "css" });
  });

  it("reuses an already-registered grammar without re-importing", async () => {
    const CodeHighlight = await loadComponent();
    const { unmount } = renderWithMantine(
      <CodeHighlight language="json" code='{"a":1}' />,
    );
    await screen.findByTestId("prism");
    expect(registerLanguage).toHaveBeenCalledTimes(1);
    unmount();
    // A second mount finds json already registered: ready synchronously, no
    // second registerLanguage call.
    renderWithMantine(<CodeHighlight language="json" code='{"b":2}' />);
    expect(await screen.findByTestId("prism")).toBeInTheDocument();
    expect(registerLanguage).toHaveBeenCalledTimes(1);
  });

  it("loads a second language reusing the already-loaded runtime", async () => {
    const CodeHighlight = await loadComponent();
    const { unmount } = renderWithMantine(
      <CodeHighlight language="json" code='{"a":1}' />,
    );
    await screen.findByTestId("prism");
    unmount();
    // Runtime is cached now; mounting css registers only the new grammar.
    renderWithMantine(<CodeHighlight language="css" code=".a{}" />);
    const prism = await screen.findByTestId("prism");
    expect(prism).toHaveAttribute("data-language", "css");
    expect(registerLanguage).toHaveBeenCalledTimes(2);
    expect(registerLanguage).toHaveBeenLastCalledWith("css", {
      __grammar: "css",
    });
  });

  it("shares one runtime load across two different languages mounted together", async () => {
    const CodeHighlight = await loadComponent();
    renderWithMantine(
      <>
        <CodeHighlight language="json" code='{"a":1}' />
        <CodeHighlight language="css" code=".a{}" />
      </>,
    );
    await waitFor(() => expect(screen.getAllByTestId("prism")).toHaveLength(2));
    // Both grammars registered, but the shared runtime promise loaded once.
    expect(registerLanguage).toHaveBeenCalledTimes(2);
  });

  it("does not retry a language whose grammar previously failed", async () => {
    const CodeHighlight = await loadComponent();
    const { unmount } = renderWithMantine(
      <CodeHighlight language="md" code="# a" />,
    );
    await waitFor(() => expect(screen.getByText("# a")).toBeInTheDocument());
    unmount();
    // markdown is in failedLoads now; a second mount short-circuits and never
    // attempts the import again — still plain, still no registration.
    renderWithMantine(<CodeHighlight language="md" code="# b" />);
    await waitFor(() => expect(screen.getByText("# b")).toBeInTheDocument());
    expect(screen.queryByTestId("prism")).not.toBeInTheDocument();
    expect(registerLanguage).not.toHaveBeenCalled();
  });
});
