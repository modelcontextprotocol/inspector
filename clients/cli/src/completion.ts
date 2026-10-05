/**
 * Shell completion for `mcp-inspector --cli` (#2434).
 *
 * `mcp-inspector --cli --completion <bash|zsh|fish>` prints a completion
 * script on stdout and exits without connecting to anything. The flag list in
 * that script is read from the live commander `program` that `parseArgs`
 * builds, not from a second hand-maintained list, so a flag added to (or
 * removed from) the CLI shows up in (or drops out of) the completions with no
 * edit here. The same goes for which flags take a value and which take a path:
 * both come from each option's commander `flags` string (`<value>`, `<path>`).
 *
 * The one thing commander cannot tell us is the finite set of values a flag
 * accepts, because the CLI validates those in custom argument parsers rather
 * than with commander `choices`. `VALUE_CHOICES` below states those sets; the
 * method list reuses `ONE_SHOT_METHODS`, the same list `parseArgs` validates
 * `--method` against, and the tests assert every other choice is accepted by
 * the option's own parser so a stale value fails loudly.
 *
 * The scripts complete the published `mcp-inspector` bin: the first word
 * offers the launcher's mode flags, and CLI flags are offered only once that
 * first word is `--cli` (web and TUI flags are out of scope and fall back to
 * the shell's default file completion).
 */
import type { Command, Option } from "commander";
import { LoggingLevelSchema } from "@modelcontextprotocol/core";
import { ONE_SHOT_METHODS } from "./handlers/method-types.js";
import { awaitableLog } from "./utils/awaitable-log.js";

export const COMPLETION_SHELLS = ["bash", "zsh", "fish"] as const;
export type CompletionShell = (typeof COMPLETION_SHELLS)[number];

/** The bin the scripts register for (the root package's only `bin`). */
export const COMPLETION_COMMAND = "mcp-inspector";

/** Launcher mode flags, offered as the first word. */
const MODE_FLAGS: readonly CompletionFlag[] = [
  { long: "--cli", takesValue: false, description: "Run the CLI" },
  { long: "--web", takesValue: false, description: "Run the web UI" },
  { long: "--tui", takesValue: false, description: "Run the terminal UI" },
];

/** Catalog-only methods `parseArgs` accepts alongside `ONE_SHOT_METHODS`. */
export const CATALOG_METHODS = ["servers/list", "servers/show"] as const;

/**
 * Finite value sets for flags whose values the CLI validates in a custom
 * parser. Keyed by the option's long name.
 */
export const VALUE_CHOICES: Readonly<Record<string, readonly string[]>> = {
  "--method": [...ONE_SHOT_METHODS, ...CATALOG_METHODS],
  "--transport": ["stdio", "sse", "http"],
  "--log-level": Object.values(LoggingLevelSchema.enum),
  "--format": ["text", "json"],
  "--protocol-era": ["legacy", "auto", "modern"],
  "--completion": COMPLETION_SHELLS,
};

export interface CompletionFlag {
  /** `--name`, when the option has a long form. */
  long?: string;
  /** `-e`, when the option has a short form. */
  short?: string;
  takesValue: boolean;
  /** Value completes as a file/directory path. */
  path?: boolean;
  /** Finite set of accepted values. */
  choices?: readonly string[];
  description: string;
}

export function isCompletionShell(value: string): value is CompletionShell {
  return (COMPLETION_SHELLS as readonly string[]).includes(value);
}

/** commander argument parser for `--completion <shell>`. */
export function parseCompletionShell(value: string): CompletionShell {
  if (!isCompletionShell(value)) {
    throw new Error(
      `Invalid shell: ${value}. Supported shells are: ${COMPLETION_SHELLS.join(", ")}`,
    );
  }
  return value;
}

/** Shortest sentence-boundary prefix that reads as a summary. */
const MIN_SUMMARY_LENGTH = 20;

/**
 * Summarize a help string for a completion menu: the first sentence, or the
 * first few when the first alone is too terse to say what the flag does
 * (`--no-revoke`'s starts "Requires --relogin."), with no trailing period.
 */
function summarize(description: string): string {
  const sentences = description.split(/(?<=\.)\s+(?=[A-Z])/);
  let summary = "";
  for (const sentence of sentences) {
    summary = summary ? `${summary} ${sentence}` : sentence;
    if (summary.length >= MIN_SUMMARY_LENGTH) break;
  }
  return summary.trim().replace(/\.$/, "");
}

function toCompletionFlag(option: Option): CompletionFlag {
  const takesValue = option.required || option.optional;
  const flag: CompletionFlag = {
    takesValue,
    description: summarize(option.description),
  };
  if (option.long) flag.long = option.long;
  if (option.short) flag.short = option.short;
  if (takesValue && /<path>|\[path\]/.test(option.flags)) flag.path = true;
  const choices =
    option.argChoices ?? (option.long && VALUE_CHOICES[option.long]);
  if (takesValue && choices) flag.choices = choices;
  return flag;
}

/** Every visible option on `program`, plus commander's implicit `--help`. */
export function collectCompletionFlags(program: Command): CompletionFlag[] {
  const flags = program.options
    .filter((option) => !option.hidden)
    .map(toCompletionFlag);
  flags.push({
    long: "--help",
    short: "-h",
    takesValue: false,
    description: "Display help for command",
  });
  return flags;
}

function names(flag: CompletionFlag): string[] {
  return [flag.long, flag.short].filter((n): n is string => Boolean(n));
}

/** Quote for a POSIX/zsh single-quoted string. */
function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Quote for a fish single-quoted string. */
function fishQuote(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

const FUNCTION_NAME = "_mcp_inspector";

function header(shell: CompletionShell): string {
  return `# ${shell} completion for ${COMPLETION_COMMAND} --cli (generated by \`${COMPLETION_COMMAND} --cli --completion ${shell}\`).`;
}

export function renderBash(flags: readonly CompletionFlag[]): string {
  const allNames = flags.flatMap(names).join(" ");
  const modeNames = MODE_FLAGS.flatMap(names).join(" ");
  const choiceCases = flags
    .filter((f) => f.choices)
    .map(
      (f) =>
        `    ${names(f).join("|")})\n      COMPREPLY=( $(compgen -W ${shQuote(f.choices!.join(" "))} -- "$cur") )\n      return 0 ;;`,
    );
  // A path or a free-form value: complete nothing, so `-o default` falls back
  // to file names rather than offering flags as the value.
  const freeValueNames = flags
    .filter((f) => f.takesValue && !f.choices)
    .flatMap(names);
  const cases = [
    ...choiceCases,
    `    ${freeValueNames.join("|")})\n      return 0 ;;`,
  ].join("\n");
  return `${header("bash")}
# Load it with:  source <(${COMPLETION_COMMAND} --cli --completion bash)
${FUNCTION_NAME}() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local prev="\${COMP_WORDS[COMP_CWORD-1]}"
  COMPREPLY=()
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W ${shQuote(modeNames)} -- "$cur") )
    return 0
  fi
  [ "\${COMP_WORDS[1]}" = "--cli" ] || return 0
  # \`--opt=value\`: "=" is in COMP_WORDBREAKS, so bash splits it into
  # \`--opt\`, \`=\`, \`value\`. Readline only replaces the text after the "=",
  # so complete the bare value against the option before it.
  if [ "$cur" = "=" ]; then
    cur=""
  elif [ "$prev" = "=" ] && [ "$COMP_CWORD" -ge 3 ]; then
    prev="\${COMP_WORDS[COMP_CWORD-2]}"
  fi
  case "$prev" in
${cases}
  esac
  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W ${shQuote(allNames)} -- "$cur") )
  fi
  return 0
}
complete -o default -F ${FUNCTION_NAME} ${COMPLETION_COMMAND}
`;
}

/** `name:description` for zsh `_describe`; colons in the name are escaped. */
function zshDescribeEntry(name: string, description: string): string {
  return shQuote(`${name.replace(/:/g, "\\:")}:${description}`);
}

export function renderZsh(flags: readonly CompletionFlag[]): string {
  const optionEntries = flags
    .flatMap((f) => names(f).map((n) => zshDescribeEntry(n, f.description)))
    .map((entry) => `    ${entry}`)
    .join("\n");
  const modeEntries = MODE_FLAGS.flatMap((f) =>
    names(f).map((n) => zshDescribeEntry(n, f.description)),
  ).join(" ");
  const cases = flags
    .filter((f) => f.takesValue)
    .map((f) => {
      const pattern = names(f).join("|");
      if (f.choices) {
        const values = f.choices.map(shQuote).join(" ");
        return `    ${pattern})\n      compadd -- ${values}\n      return ;;`;
      }
      if (f.path) return `    ${pattern})\n      _files\n      return ;;`;
      return `    ${pattern})\n      _message 'value'\n      return ;;`;
    })
    .join("\n");
  return `#compdef ${COMPLETION_COMMAND}
${header("zsh")}
# Load it with:  source <(${COMPLETION_COMMAND} --cli --completion zsh)
# or save it as _${COMPLETION_COMMAND} in a directory on your $fpath.
${FUNCTION_NAME}() {
  local cur=\${words[CURRENT]} prev=\${words[CURRENT-1]}
  if (( CURRENT == 2 )); then
    local -a modes
    modes=(${modeEntries})
    _describe -t modes 'mode' modes
    return
  fi
  if [[ \${words[2]} != --cli ]]; then
    _files
    return
  fi
  # \`--opt=value\` stays one word: split it, and move \`--opt=\` into IPREFIX
  # so only the value is replaced.
  local inline=0
  if [[ $cur == --*=* ]]; then
    prev=\${cur%%=*}
    compset -P '*='
    cur=\${cur#*=}
    inline=1
  fi
  case $prev in
${cases}
  esac
  (( inline )) && return
  if [[ $cur == -* ]]; then
    local -a opts
    opts=(
${optionEntries}
    )
    _describe -t options 'option' opts
  else
    _files
  fi
}
if [[ \${funcstack[1]} == _${COMPLETION_COMMAND} ]]; then
  ${FUNCTION_NAME} "$@"
else
  compdef ${FUNCTION_NAME} ${COMPLETION_COMMAND}
fi
`;
}

export function renderFish(flags: readonly CompletionFlag[]): string {
  const cmd = COMPLETION_COMMAND;
  const lines = flags.map((f) => {
    const parts = [`complete -c ${cmd} -n __mcp_inspector_cli_mode`];
    if (f.long) parts.push(`-l ${f.long.slice(2)}`);
    if (f.short) parts.push(`-s ${f.short.slice(1)}`);
    if (f.choices) {
      parts.push(`-x -a ${fishQuote(f.choices.join(" "))}`);
    } else if (f.path) {
      parts.push("-r -F");
    } else if (f.takesValue) {
      parts.push("-x");
    }
    parts.push(`-d ${fishQuote(f.description)}`);
    return parts.join(" ");
  });
  const modeLines = MODE_FLAGS.map(
    (f) =>
      `complete -c ${cmd} -n __mcp_inspector_first_arg -l ${f.long!.slice(2)} -d ${fishQuote(f.description)}`,
  );
  return `${header("fish")}
# Load it with:  ${cmd} --cli --completion fish | source
# or save it as ~/.config/fish/completions/${cmd}.fish
function __mcp_inspector_first_arg
    test (count (commandline -opc)) -eq 1
end
function __mcp_inspector_cli_mode
    set -l tokens (commandline -opc)
    test (count $tokens) -ge 2; and test "$tokens[2]" = --cli
end
${modeLines.join("\n")}
${lines.join("\n")}
`;
}

export function renderCompletion(
  shell: CompletionShell,
  flags: readonly CompletionFlag[],
): string {
  switch (shell) {
    case "bash":
      return renderBash(flags);
    case "zsh":
      return renderZsh(flags);
    case "fish":
      return renderFish(flags);
  }
}

/**
 * Register `--completion <shell>` on `program`. Called before
 * `program.parse` so the flag is accepted and listed in `--help`.
 */
export function registerCompletionOption(program: Command): void {
  program.option(
    "--completion <shell>",
    `Print a shell completion script (${COMPLETION_SHELLS.join(", ")}) on stdout and exit. No server connection is made.`,
    parseCompletionShell,
  );
}

/**
 * After `program.parse`: when `--completion` was given, write the script for
 * that shell and return true so the caller can short-circuit.
 */
export async function emitCompletionIfRequested(
  program: Command,
): Promise<boolean> {
  const shell = program.opts<{ completion?: CompletionShell }>().completion;
  if (!shell) return false;
  await awaitableLog(renderCompletion(shell, collectCompletionFlags(program)));
  return true;
}
