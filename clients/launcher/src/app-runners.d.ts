declare module "@modelcontextprotocol/inspector-web" {
  export function runWeb(argv?: string[]): Promise<number | void>;
}

declare module "@modelcontextprotocol/inspector-cli" {
  export function runCli(argv?: string[]): Promise<void>;
}

declare module "@modelcontextprotocol/inspector-tui" {
  export function runTui(argv?: string[]): Promise<void>;
}
