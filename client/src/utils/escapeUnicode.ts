// Utility function to escape Unicode characters
export function escapeUnicode(obj: unknown): string {
  return JSON.stringify(
    obj,
    (_key: string, value) => {
      if (typeof value === "string") {
        // Replace non-ASCII characters with their Unicode escape sequences
        return value.replace(/[^\0-\x7F]/g, (char) => {
          return "\\u" + ("0000" + char.charCodeAt(0).toString(16)).slice(-4);
        });
      }
      return value;
    },
    2,
  );
}
