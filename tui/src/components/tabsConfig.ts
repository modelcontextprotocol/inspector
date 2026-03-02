export type TabType =
  | "info"
  | "auth"
  | "resources"
  | "prompts"
  | "tools"
  | "messages"
  | "requests"
  | "logging";

export const tabs: { id: TabType; label: string; accelerator: string }[] = [
  { id: "info", label: "Info", accelerator: "i" },
  { id: "auth", label: "Auth", accelerator: "a" },
  { id: "resources", label: "Resources", accelerator: "r" },
  { id: "prompts", label: "Prompts", accelerator: "p" },
  { id: "tools", label: "Tools", accelerator: "t" },
  { id: "messages", label: "Messages", accelerator: "m" },
  { id: "requests", label: "HTTP Requests", accelerator: "h" },
  { id: "logging", label: "Logging", accelerator: "l" },
];
