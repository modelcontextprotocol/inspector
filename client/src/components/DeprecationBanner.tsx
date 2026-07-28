import { useState } from "react";
import { X } from "lucide-react";

const DISMISSED_KEY = "mcp-inspector-v1-deprecation-dismissed";

/**
 * v1 deprecation notice shown at the top of the app.
 *
 * Dismissal is persisted in localStorage so it stays hidden across reloads.
 * A storage failure (Safari private mode, disabled storage) must not break the
 * app, so both reads and writes are guarded — the banner simply reappears.
 */
const DeprecationBanner = () => {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === "true";
    } catch {
      return false;
    }
  });

  if (dismissed) {
    return null;
  }

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // Ignore: dismissal just won't persist across reloads.
    }
    setDismissed(true);
  };

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-4 px-4 py-2 bg-yellow-100 text-yellow-900 border-b border-yellow-300 dark:bg-yellow-900/40 dark:text-yellow-100 dark:border-yellow-700"
    >
      <p className="text-sm">
        <span className="font-semibold">
          ⚠️ MCP Inspector v1 is deprecated.
        </span>{" "}
        Upgrade with{" "}
        <code className="px-1 py-0.5 rounded bg-yellow-200 dark:bg-yellow-800">
          npx @modelcontextprotocol/inspector@latest
        </code>
        . v1 receives security fixes only.
      </p>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss deprecation notice"
        className="shrink-0 p-1 rounded hover:bg-yellow-200 dark:hover:bg-yellow-800"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export default DeprecationBanner;
