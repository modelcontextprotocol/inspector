/**
 * A linear-time matcher for JSON Schema `pattern` / `patternProperties`
 * regular expressions.
 *
 * Why this exists: a tool's `outputSchema` comes from the server, so its
 * `pattern`s are attacker-chosen input. JavaScript's native `RegExp` is a
 * backtracking engine, and a pattern such as `^(a+)+$` evaluated against a
 * near-match string takes exponential time — enough to freeze the Inspector on
 * the thread that runs validation. Even an innocuous-looking unanchored `a*b`
 * is quadratic on a long run of `a`s. No pattern a server sends can be trusted
 * to run in bounded time on the native engine.
 *
 * This module evaluates the regular subset of ECMAScript regex syntax with a
 * Thompson-NFA simulation (a "Pike VM"): every input position is visited once
 * and every program instruction at most once per position, so the cost is
 * `O(input length × program size)` whatever the pattern's shape, and the
 * caller can bound that product BEFORE running. Matching only answers "is
 * there a match", which is all a `pattern` keyword asks, so greedy/lazy and
 * capture semantics do not matter.
 *
 * Fidelity: each single-character atom (a literal, an escape such as `\d` or
 * `\p{L}`, a class such as `[^a-z]`, or `.`) is decided by the native engine
 * against ONE code point, wrapped as `^(?:atom)$`. That wrapper has no
 * quantifier, so it cannot backtrack, and it gives exact ECMAScript semantics
 * for every character-level construct without re-implementing them here.
 *
 * What is NOT supported — lookaround, backreferences, group modifiers — cannot
 * be evaluated by an automaton, so {@link compileLinearRegExp} reports it as
 * unsupported and the caller decides what to report. It never falls back to
 * the native engine, because that fallback is exactly the hang this module
 * exists to prevent.
 */

/** A single-character matcher, decided natively against one code point. */
class CharMatcher {
  private readonly re: RegExp;
  /** Memo for ASCII code points: 0 = unknown, 1 = match, 2 = no match. */
  private readonly ascii = new Uint8Array(128);

  constructor(source: string, unicode: boolean) {
    // Throws on a source this parser sliced wrongly; the caller treats that
    // as "unsupported" rather than guessing.
    this.re = new RegExp(`^(?:${source})$`, unicode ? "u" : "");
  }

  matches(cp: number, unicode: boolean): boolean {
    if (cp < 128) {
      const memo = this.ascii[cp];
      if (memo !== 0) return memo === 1;
      const result = this.re.test(String.fromCharCode(cp));
      this.ascii[cp] = result ? 1 : 2;
      return result;
    }
    return this.re.test(
      unicode ? String.fromCodePoint(cp) : String.fromCharCode(cp),
    );
  }
}

type Assertion = "start" | "end" | "wordBoundary" | "notWordBoundary";

type Node =
  | { kind: "char"; source: string }
  | { kind: "assert"; assertion: Assertion }
  | { kind: "seq"; items: Node[] }
  | { kind: "alt"; options: Node[] }
  | { kind: "repeat"; body: Node; min: number; max: number };

type Inst =
  | { op: "char"; matcher: CharMatcher }
  | { op: "split"; a: number; b: number }
  | { op: "jmp"; to: number }
  | { op: "assert"; assertion: Assertion }
  | { op: "match" };

/** Thrown inside the parser/compiler; never escapes this module. */
class Unsupported extends Error {}

/** Deepest group nesting accepted; deeper is reported as unsupported. */
const MAX_GROUP_DEPTH = 64;

/**
 * Largest compiled program accepted. Counted repeats (`a{1,500}`) are expanded
 * into copies, so this caps the per-position cost of a match.
 */
export const MAX_PROGRAM_SIZE = 10_000;

/**
 * Most AST node visits compilation may make. A counted repeat re-compiles its
 * body once per copy, and a body can cost visits without emitting anything
 * (`(?:(){0}x){9999}`), so {@link MAX_PROGRAM_SIZE} alone does not bound the
 * work compilation does before the evaluation budget applies.
 */
export const MAX_COMPILE_STEPS = 10 * MAX_PROGRAM_SIZE;

/**
 * Compile work several patterns share, so a schema of many distinct patterns,
 * each under the per-pattern limits, cannot add up to unbounded work and
 * memory between them. Both counters are what REMAINS and are spent by every
 * compilation the budget is passed to; once either goes negative the budget
 * is exhausted and every further compilation charged to it is declined.
 */
export interface CompileBudget {
  /** AST node visits still allowed. */
  steps: number;
  /** Program instructions still allowed. */
  size: number;
}

/** The reason a compilation gives when its shared budget ran out. */
export const COMPILE_BUDGET_EXHAUSTED =
  "the patterns together exceed the compilation budget";

/** Whether `budget` has been spent past its end. */
export function isCompileBudgetExhausted(budget: CompileBudget): boolean {
  return budget.steps < 0 || budget.size < 0;
}

const QUANTIFIER_BRACES = /^\{(\d+)(?:(,)(\d*))?\}/;
const HEX4 = /^[0-9a-fA-F]{4}$/;
const HEX2 = /^[0-9a-fA-F]{2}$/;

class Parser {
  private pos = 0;
  private readonly src: string;
  private readonly unicode: boolean;

  constructor(src: string, unicode: boolean) {
    this.src = src;
    this.unicode = unicode;
  }

  parse(): Node {
    const node = this.parseAlternation(0);
    // A stray `)` is the only way to stop short; the native engine rejects it
    // before we get here, so this is purely defensive.
    /* v8 ignore next -- the native RegExp constructor rejects an unbalanced `)` first */
    if (this.pos !== this.src.length) throw new Unsupported("unbalanced group");
    return node;
  }

  private parseAlternation(depth: number): Node {
    const options = [this.parseSequence(depth)];
    while (this.src[this.pos] === "|") {
      this.pos++;
      options.push(this.parseSequence(depth));
    }
    return options.length === 1 ? options[0]! : { kind: "alt", options };
  }

  private parseSequence(depth: number): Node {
    const items: Node[] = [];
    while (
      this.pos < this.src.length &&
      this.src[this.pos] !== "|" &&
      this.src[this.pos] !== ")"
    ) {
      items.push(this.parseTerm(depth));
    }
    return items.length === 1 ? items[0]! : { kind: "seq", items };
  }

  private parseTerm(depth: number): Node {
    const atom = this.parseAtom(depth);
    const quantifier = this.readQuantifier();
    if (!quantifier) return atom;
    // A bare quantified assertion (`\b?`, `^*`) is a native "nothing to
    // repeat" error, so an `assert` atom here is a group around one —
    // `(\b)?`, which native accepts. Its body is zero-width, so the repeat
    // compiles like any other nullable body.
    // A trailing `?` makes the quantifier lazy, which cannot change whether a
    // match exists.
    if (this.src[this.pos] === "?") this.pos++;
    return { kind: "repeat", body: atom, ...quantifier };
  }

  private readQuantifier(): { min: number; max: number } | undefined {
    const c = this.src[this.pos];
    if (c === "*") {
      this.pos++;
      return { min: 0, max: Infinity };
    }
    if (c === "+") {
      this.pos++;
      return { min: 1, max: Infinity };
    }
    if (c === "?") {
      this.pos++;
      return { min: 0, max: 1 };
    }
    if (c === "{") {
      const m = QUANTIFIER_BRACES.exec(this.src.slice(this.pos));
      // Outside unicode mode a `{` that is not a quantifier is a literal.
      if (!m) return undefined;
      this.pos += m[0].length;
      const min = Number(m[1]);
      const max = m[2] === undefined ? min : m[3] ? Number(m[3]) : Infinity;
      return { min, max };
    }
    return undefined;
  }

  private parseAtom(depth: number): Node {
    const c = this.src[this.pos]!;
    switch (c) {
      case "(":
        return this.parseGroup(depth);
      case "[":
        return this.parseClass();
      case "\\":
        return this.parseEscape();
      case ".":
        this.pos++;
        return { kind: "char", source: "." };
      case "^":
        this.pos++;
        return { kind: "assert", assertion: "start" };
      case "$":
        this.pos++;
        return { kind: "assert", assertion: "end" };
      case "*":
      case "+":
      case "?":
        /* v8 ignore next -- "nothing to repeat" is a native syntax error */
        throw new Unsupported("nothing to repeat");
      case "{":
        // Non-unicode only: a `{` that would read as a quantifier here is a
        // "nothing to repeat" error natively; any other `{` is a literal.
        if (QUANTIFIER_BRACES.test(this.src.slice(this.pos))) {
          /* v8 ignore next -- rejected by the native RegExp constructor first */
          throw new Unsupported("nothing to repeat");
        }
        this.pos++;
        return { kind: "char", source: "\\{" };
      default: {
        const width = this.codePointWidth(this.pos);
        const source = this.src.slice(this.pos, this.pos + width);
        this.pos += width;
        return { kind: "char", source };
      }
    }
  }

  /** Width in code units of the literal starting at `at`. */
  private codePointWidth(at: number): number {
    if (!this.unicode) return 1;
    const cp = this.src.codePointAt(at)!;
    return cp > 0xffff ? 2 : 1;
  }

  private parseGroup(depth: number): Node {
    if (depth >= MAX_GROUP_DEPTH)
      throw new Unsupported("groups nested too deeply");
    this.pos++; // "("
    if (this.src.startsWith("?:", this.pos)) {
      this.pos += 2;
    } else if (
      this.src.startsWith("?<", this.pos) &&
      this.src[this.pos + 2] !== "=" &&
      this.src[this.pos + 2] !== "!"
    ) {
      // Named capture group: the name has no bearing on whether it matches.
      const close = this.src.indexOf(">", this.pos);
      /* v8 ignore next -- an unterminated group name is a native syntax error */
      if (close < 0) throw new Unsupported("unterminated group name");
      this.pos = close + 1;
    } else if (this.src[this.pos] === "?") {
      throw new Unsupported("lookaround or group modifier");
    }
    const body = this.parseAlternation(depth + 1);
    /* v8 ignore next -- an unterminated group is a native syntax error */
    if (this.src[this.pos] !== ")") throw new Unsupported("unterminated group");
    this.pos++;
    return body;
  }

  private parseClass(): Node {
    const start = this.pos;
    this.pos++; // "["
    while (this.pos < this.src.length && this.src[this.pos] !== "]") {
      this.pos += this.src[this.pos] === "\\" ? 2 : 1;
    }
    /* v8 ignore next -- an unterminated class is a native syntax error */
    if (this.pos >= this.src.length)
      throw new Unsupported("unterminated class");
    this.pos++; // "]"
    return { kind: "char", source: this.src.slice(start, this.pos) };
  }

  private parseEscape(): Node {
    const next = this.src[this.pos + 1];
    /* v8 ignore next -- a trailing backslash is a native syntax error */
    if (next === undefined) throw new Unsupported("trailing backslash");
    switch (next) {
      case "b":
        this.pos += 2;
        return { kind: "assert", assertion: "wordBoundary" };
      case "B":
        this.pos += 2;
        return { kind: "assert", assertion: "notWordBoundary" };
      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
      case "6":
      case "7":
      case "8":
      case "9":
      case "k":
        throw new Unsupported("backreference");
      case "0":
        // `\0` followed by a digit is a legacy octal escape outside unicode
        // mode; rare enough to decline rather than reproduce.
        if (/[0-9]/.test(this.src[this.pos + 2] ?? "")) {
          throw new Unsupported("octal escape");
        }
        return this.takeChar(2);
      case "c":
        // `\c` without a control letter means a literal backslash + "c"
        // (Annex B) — two characters, not one.
        if (!/[a-zA-Z]/.test(this.src[this.pos + 2] ?? "")) {
          throw new Unsupported("incomplete control escape");
        }
        return this.takeChar(3);
      case "p":
      case "P":
        if (this.unicode && this.src[this.pos + 2] === "{") {
          return this.takeThrough("}");
        }
        return this.takeChar(2);
      case "x":
        return this.takeChar(
          HEX2.test(this.src.slice(this.pos + 2, this.pos + 4)) ? 4 : 2,
        );
      case "u":
        return this.parseUnicodeEscape();
      default:
        // Identity / class escapes (`\.`, `\d`, `\s`, `\n`, …). Under the `u`
        // flag the escaped character may be astral, i.e. two code units.
        return this.takeChar(1 + this.codePointWidth(this.pos + 1));
    }
  }

  private parseUnicodeEscape(): Node {
    if (this.unicode && this.src[this.pos + 2] === "{") {
      return this.takeThrough("}");
    }
    const hex = this.src.slice(this.pos + 2, this.pos + 6);
    if (!HEX4.test(hex)) return this.takeChar(2);
    const unit = parseInt(hex, 16);
    // Under `u`, `\uHHHH\uLLLL` spelling a surrogate pair is ONE code point.
    if (
      this.unicode &&
      unit >= 0xd800 &&
      unit <= 0xdbff &&
      this.src.startsWith("\\u", this.pos + 6)
    ) {
      const low = this.src.slice(this.pos + 8, this.pos + 12);
      if (HEX4.test(low)) {
        const lowUnit = parseInt(low, 16);
        if (lowUnit >= 0xdc00 && lowUnit <= 0xdfff) return this.takeChar(12);
      }
    }
    return this.takeChar(6);
  }

  private takeChar(length: number): Node {
    const source = this.src.slice(this.pos, this.pos + length);
    this.pos += length;
    return { kind: "char", source };
  }

  private takeThrough(terminator: string): Node {
    const end = this.src.indexOf(terminator, this.pos);
    /* v8 ignore next -- an unterminated `\p{` / `\u{` is a native syntax error */
    if (end < 0) throw new Unsupported("unterminated escape");
    return this.takeChar(end + 1 - this.pos);
  }
}

class Compiler {
  readonly prog: Inst[] = [];
  private readonly matchers = new Map<string, CharMatcher>();
  private readonly unicode: boolean;
  private readonly budget: CompileBudget | undefined;
  private steps = 0;

  constructor(unicode: boolean, budget: CompileBudget | undefined) {
    this.unicode = unicode;
    this.budget = budget;
  }

  private emit(inst: Inst): number {
    if (this.prog.length >= MAX_PROGRAM_SIZE) {
      throw new Unsupported("pattern too complex");
    }
    if (this.budget && --this.budget.size < 0) {
      throw new Unsupported(COMPILE_BUDGET_EXHAUSTED);
    }
    this.prog.push(inst);
    return this.prog.length - 1;
  }

  private matcher(source: string): CharMatcher {
    let matcher = this.matchers.get(source);
    if (!matcher) {
      try {
        matcher = new CharMatcher(source, this.unicode);
      } catch {
        /* v8 ignore start -- defensive: each atom is a slice the native constructor already accepted in context */
        throw new Unsupported("unrecognized character syntax");
        /* v8 ignore stop */
      }
      this.matchers.set(source, matcher);
    }
    return matcher;
  }

  compile(node: Node): void {
    if (++this.steps > MAX_COMPILE_STEPS) {
      throw new Unsupported("pattern too complex");
    }
    if (this.budget && --this.budget.steps < 0) {
      throw new Unsupported(COMPILE_BUDGET_EXHAUSTED);
    }
    switch (node.kind) {
      case "char":
        this.emit({ op: "char", matcher: this.matcher(node.source) });
        return;
      case "assert":
        this.emit({ op: "assert", assertion: node.assertion });
        return;
      case "seq":
        for (const item of node.items) this.compile(item);
        return;
      case "alt":
        this.compileAlternation(node.options);
        return;
      case "repeat":
        this.compileRepeat(node.body, node.min, node.max);
        return;
    }
  }

  private compileAlternation(options: Node[]): void {
    const jumps: number[] = [];
    for (let i = 0; i < options.length - 1; i++) {
      const split = this.emit({ op: "split", a: 0, b: 0 });
      this.patchSplit(split, split + 1, -1);
      this.compile(options[i]!);
      jumps.push(this.emit({ op: "jmp", to: 0 }));
      this.patchSplit(split, -1, this.prog.length);
    }
    this.compile(options[options.length - 1]!);
    for (const jump of jumps) this.patchJump(jump, this.prog.length);
  }

  private compileRepeat(body: Node, min: number, max: number): void {
    for (let i = 0; i < min; i++) {
      const before = this.prog.length;
      this.compile(body);
      // A body that emits nothing matches only the empty string, so further
      // copies add nothing either — stop rather than loop `min` times.
      if (this.prog.length === before) return;
    }
    if (max === Infinity) {
      const split = this.emit({ op: "split", a: 0, b: 0 });
      this.compile(body);
      this.emit({ op: "jmp", to: split });
      this.patchSplit(split, split + 1, this.prog.length);
      return;
    }
    const splits: number[] = [];
    for (let i = min; i < max; i++) {
      const split = this.emit({ op: "split", a: 0, b: 0 });
      this.patchSplit(split, split + 1, -1);
      splits.push(split);
      this.compile(body);
    }
    for (const split of splits) this.patchSplit(split, -1, this.prog.length);
  }

  private patchSplit(at: number, a: number, b: number): void {
    const inst = this.prog[at] as Extract<Inst, { op: "split" }>;
    if (a >= 0) inst.a = a;
    if (b >= 0) inst.b = b;
  }

  private patchJump(at: number, to: number): void {
    (this.prog[at] as Extract<Inst, { op: "jmp" }>).to = to;
  }
}

function isWordUnit(unit: number): boolean {
  return (
    (unit >= 0x30 && unit <= 0x39) ||
    (unit >= 0x41 && unit <= 0x5a) ||
    (unit >= 0x61 && unit <= 0x7a) ||
    unit === 0x5f
  );
}

/** A compiled pattern whose {@link search} runs in bounded time. */
export class LinearRegExp {
  private readonly anchoredStart: boolean;
  private readonly prog: readonly Inst[];
  private readonly unicode: boolean;

  constructor(prog: readonly Inst[], unicode: boolean) {
    this.prog = prog;
    this.unicode = unicode;
    const first = prog[0];
    this.anchoredStart =
      first !== undefined &&
      first.op === "assert" &&
      first.assertion === "start";
  }

  /** Number of instructions; the per-position cost of a search. */
  get size(): number {
    return this.prog.length;
  }

  /**
   * The work bound {@link search} checks against its budget: one visit of
   * every instruction at every input position (plus the end of input).
   */
  cost(input: string): number {
    return (input.length + 1) * this.prog.length;
  }

  /**
   * Whether `input` contains a match (the `RegExp.prototype.test` question).
   * Returns `undefined`, WITHOUT running, when {@link cost} exceeds `budget` —
   * the caller must not read that as either answer.
   */
  search(input: string, budget: number): boolean | undefined {
    if (this.cost(input) > budget) return undefined;
    const prog = this.prog;
    const size = prog.length;
    const mark = new Int32Array(size).fill(-1);
    const stack: number[] = [];
    let clist = new Int32Array(size);
    let nlist = new Int32Array(size);

    // Follow every epsilon edge from `start` at input position `pos`, adding
    // the character-consuming threads it reaches to `list`. Each pc is entered
    // at most once per position (`mark`), which is what bounds the work and
    // also terminates the empty loops a nullable repeat creates.
    const add = (
      list: Int32Array,
      count: number,
      start: number,
      pos: number,
      generation: number,
    ): number => {
      stack.push(start);
      while (stack.length > 0) {
        const pc = stack.pop()!;
        if (mark[pc] === generation) continue;
        mark[pc] = generation;
        const inst = prog[pc]!;
        switch (inst.op) {
          case "match":
            stack.length = 0;
            return -1;
          case "jmp":
            stack.push(inst.to);
            break;
          case "split":
            stack.push(inst.b, inst.a);
            break;
          case "assert":
            if (this.holds(inst.assertion, input, pos)) stack.push(pc + 1);
            break;
          case "char":
            list[count++] = pc;
            break;
        }
      }
      return count;
    };

    let pos = 0;
    let generation = 0;
    let clen = add(clist, 0, 0, pos, generation);
    if (clen < 0) return true;
    while (pos < input.length) {
      if (this.anchoredStart && clen === 0) return false;
      const cp = this.unicode ? input.codePointAt(pos)! : input.charCodeAt(pos);
      const next = pos + (this.unicode && cp > 0xffff ? 2 : 1);
      generation++;
      let nlen = 0;
      for (let i = 0; i < clen; i++) {
        const pc = clist[i]!;
        const inst = prog[pc] as Extract<Inst, { op: "char" }>;
        if (inst.matcher.matches(cp, this.unicode)) {
          nlen = add(nlist, nlen, pc + 1, next, generation);
          if (nlen < 0) return true;
        }
      }
      // Unanchored search: a match may begin at any position.
      nlen = add(nlist, nlen, 0, next, generation);
      if (nlen < 0) return true;
      [clist, nlist] = [nlist, clist];
      clen = nlen;
      pos = next;
    }
    return false;
  }

  private holds(assertion: Assertion, input: string, pos: number): boolean {
    switch (assertion) {
      case "start":
        return pos === 0;
      case "end":
        return pos === input.length;
      case "wordBoundary":
      case "notWordBoundary": {
        const before = pos > 0 && isWordUnit(input.charCodeAt(pos - 1));
        const after = pos < input.length && isWordUnit(input.charCodeAt(pos));
        return (before !== after) === (assertion === "wordBoundary");
      }
    }
  }
}

export type LinearRegExpCompilation =
  | { ok: true; regExp: LinearRegExp }
  | { ok: false; reason: string };

/**
 * Compile `pattern` for linear-time matching.
 *
 * The pattern is first handed to the native `RegExp` constructor, which only
 * parses it — construction does not match anything, so it cannot backtrack —
 * and throws a `SyntaxError` for an invalid pattern exactly as a native
 * consumer would. That throw is deliberately NOT caught: an invalid pattern is
 * a schema compilation failure, not an "unsupported" one.
 *
 * A valid pattern that uses a construct an automaton cannot evaluate
 * (lookaround, backreferences, group modifiers) or that compiles past
 * {@link MAX_PROGRAM_SIZE} returns `{ ok: false, reason }`. So does one that
 * would overspend `budget`, when given, with {@link COMPILE_BUDGET_EXHAUSTED}.
 */
export function compileLinearRegExp(
  pattern: string,
  unicode: boolean,
  budget?: CompileBudget,
): LinearRegExpCompilation {
  new RegExp(pattern, unicode ? "u" : "");
  try {
    const ast = new Parser(pattern, unicode).parse();
    const compiler = new Compiler(unicode, budget);
    compiler.compile(ast);
    compiler.prog.push({ op: "match" });
    return { ok: true, regExp: new LinearRegExp(compiler.prog, unicode) };
  } catch (error) {
    /* v8 ignore next -- every throw inside the parser/compiler is an Unsupported */
    if (!(error instanceof Unsupported)) throw error;
    return { ok: false, reason: error.message };
  }
}
