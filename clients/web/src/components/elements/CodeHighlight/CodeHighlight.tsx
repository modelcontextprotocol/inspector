import { Code } from "@mantine/core";
import { useEffect, useState } from "react";
import type { ComponentType } from "react";

/**
 * Lazy syntax-highlighting code block. The `react-syntax-highlighter`
 * prism-light runtime, its theme chunk, and each language grammar are
 * dynamic-imported on first use so a session that never opens a highlightable
 * resource never pays for them. While a grammar is still loading (or the
 * language is unknown) the raw code is shown in a plain Mantine `Code` block so
 * users never see a flash of unstyled tokens.
 */
export interface CodeHighlightProps {
  /** Highlight.js / Prism language tag (or an alias — see {@link LANGUAGE_ALIASES}). */
  language: string;
  /** The source text to render. */
  code: string;
}

/** A Prism grammar object; opaque to us — registered with the runtime as-is. */
type Grammar = unknown;

/** The prism-light runtime component plus its `registerLanguage` static. */
type PrismRuntime = ComponentType<{
  language: string;
  style: Record<string, unknown>;
  customStyle?: Record<string, unknown>;
  wrapLongLines?: boolean;
  children: string;
}> & { registerLanguage: (name: string, grammar: Grammar) => void };

/**
 * Static per-language import thunks. Each is a separate dynamic import so Vite
 * emits one lazily-loaded chunk per grammar. Add an entry here (and an alias
 * below if the canonical Prism name differs) as the type matrix grows.
 */
const LANGUAGE_LOADERS: Record<string, () => Promise<{ default: Grammar }>> = {
  json: () => import("react-syntax-highlighter/dist/esm/languages/prism/json"),
  markup: () =>
    import("react-syntax-highlighter/dist/esm/languages/prism/markup"),
  css: () => import("react-syntax-highlighter/dist/esm/languages/prism/css"),
  yaml: () => import("react-syntax-highlighter/dist/esm/languages/prism/yaml"),
  markdown: () =>
    import("react-syntax-highlighter/dist/esm/languages/prism/markdown"),
};

/** Friendly language tags → the canonical Prism grammar name they resolve to. */
const LANGUAGE_ALIASES: Record<string, string> = {
  xml: "markup",
  html: "markup",
  htm: "markup",
  svg: "markup",
  yml: "yaml",
  md: "markdown",
};

/** Grammars successfully loaded + registered this session. */
const registeredLanguages = new Set<string>();
/** Grammars whose import rejected / are unknown — never retried. */
const failedLoads = new Set<string>();
/** In-flight grammar loads, so concurrent mounts share one async call. */
const loadingPromises = new Map<string, Promise<void>>();

/** The shared prism-light runtime component + theme. */
interface Runtime {
  Prism: PrismRuntime;
  style: Record<string, unknown>;
}

/** The shared prism-light runtime + theme, loaded once. */
let runtime: Runtime | null = null;
let runtimePromise: Promise<Runtime> | null = null;

/** Resolve an alias to its canonical Prism grammar name. */
function resolveLanguage(language: string): string {
  return LANGUAGE_ALIASES[language] ?? language;
}

/** Load (and cache) the prism-light runtime component and the `tomorrow` theme. */
async function ensureRuntime(): Promise<Runtime> {
  if (runtime) return runtime;
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const [prismMod, styleMod] = await Promise.all([
        import("react-syntax-highlighter/dist/esm/prism-light"),
        import("react-syntax-highlighter/dist/esm/styles/prism/tomorrow"),
      ]);
      runtime = {
        Prism: prismMod.default as PrismRuntime,
        style: styleMod.default,
      };
      return runtime;
    })();
  }
  return runtimePromise;
}

/**
 * Ensure the grammar for `language` is loaded and registered. Resolves once the
 * language is ready, a prior load failed, or the language is unknown — callers
 * re-check {@link isLanguageReady} afterward rather than relying on this throwing.
 */
async function ensureLanguage(language: string): Promise<void> {
  const name = resolveLanguage(language);
  if (registeredLanguages.has(name) || failedLoads.has(name)) return;
  const inFlight = loadingPromises.get(name);
  if (inFlight) return inFlight;

  const loader = LANGUAGE_LOADERS[name];
  if (!loader) {
    failedLoads.add(name);
    return;
  }

  const load = (async () => {
    try {
      const rt = await ensureRuntime();
      const { default: grammar } = await loader();
      rt.Prism.registerLanguage(name, grammar);
      registeredLanguages.add(name);
    } catch {
      failedLoads.add(name);
    } finally {
      loadingPromises.delete(name);
    }
  })();
  loadingPromises.set(name, load);
  return load;
}

const PlainCode = Code.withProps({ block: true });

export function CodeHighlight({ language, code }: CodeHighlightProps) {
  // Readiness is derived from the module-level caches during render (so a
  // language already loaded this session highlights on first paint, including
  // after the `language` prop changes). The effect only bumps a tick when an
  // async load finishes, forcing a re-render that re-reads the caches.
  const [, bumpTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void ensureLanguage(language).then(() => {
      if (!cancelled) bumpTick((t) => t + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  const resolved = resolveLanguage(language);
  const rt = runtime;
  // Plain block until the runtime has loaded and this grammar is registered.
  if (!rt || !registeredLanguages.has(resolved)) {
    return <PlainCode>{code}</PlainCode>;
  }

  const { Prism, style } = rt;
  return (
    <Prism
      language={resolved}
      style={style}
      customStyle={{ margin: 0 }}
      wrapLongLines
    >
      {code}
    </Prism>
  );
}
