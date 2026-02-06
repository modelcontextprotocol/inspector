/**
 * Metadata helpers aligned with the official MCP specification.
 *
 * @see https://modelcontextprotocol.io/specification/2025-06-18/basic/index#meta
 */

const META_PREFIX_LABEL_REGEX = /^[a-z](?:[a-z\d-]*[a-z\d])?$/i;
const META_NAME_REGEX = /^[a-z\d](?:[a-z\d._-]*[a-z\d])?$/i;
const RESERVED_NAMESPACE_LABELS = ["modelcontextprotocol", "mcp"];

export const RESERVED_NAMESPACE_MESSAGE =
  'Keys using the "modelcontextprotocol.*" or "mcp.*" namespaces are reserved by MCP and cannot be used.';

export const META_NAME_RULES_MESSAGE =
  "Names must begin and end with an alphanumeric character and may only contain alphanumerics, hyphens (-), underscores (_), or dots (.) in between.";

export const META_PREFIX_RULES_MESSAGE =
  "Prefixes must be dot-separated labels that start with a letter and end with a letter or digit (e.g. example.domain/).";

/**
 * Extracts the prefix portion (before the first slash) of a metadata key, if present.
 *
 * @param key - Raw metadata key entered by the user.
 * @returns The prefix segment (without the trailing slash) or null when no prefix exists.
 * @see https://modelcontextprotocol.io/specification/2025-06-18/basic/index#meta
 */
const getPrefixSegment = (key: string): string | null => {
  const trimmedKey = key.trim();
  const slashIndex = trimmedKey.indexOf("/");
  if (slashIndex === -1) {
    return null;
  }
  return trimmedKey.slice(0, slashIndex);
};

/**
 * Normalizes a potential prefix segment by trimming whitespace, removing schemes,
 * and stripping trailing URL components so only the label portion remains.
 *
 * @param segment - The prefix segment extracted from the metadata key.
 * @returns A normalized string suitable for label parsing, or null when empty.
 * @see https://modelcontextprotocol.io/specification/2025-06-18/basic/index#meta
 */
const normalizeSegment = (segment: string): string | null => {
  if (!segment) return null;
  let normalized = segment.trim().toLowerCase();
  if (!normalized) return null;

  const schemeIndex = normalized.indexOf("://");
  if (schemeIndex !== -1) {
    normalized = normalized.slice(schemeIndex + 3);
  }

  const stopChars = ["?", "#", ":"];
  let endIndex = normalized.length;
  stopChars.forEach((char) => {
    const idx = normalized.indexOf(char);
    if (idx !== -1 && idx < endIndex) {
      endIndex = idx;
    }
  });

  return normalized.slice(0, endIndex) || null;
};

/**
 * Splits a normalized prefix into dot-separated labels and validates each label
 * against the MCP prefix rules (start with letter, end with letter/digit, interior alphanumerics or hyphens).
 *
 * @param segment - Normalized prefix string.
 * @returns Array of labels if valid, otherwise null.
 * @see https://modelcontextprotocol.io/specification/2025-06-18/basic/index#meta
 */
const splitLabels = (segment: string): string[] | null => {
  const normalized = normalizeSegment(segment);
  if (!normalized) return null;

  const labels = normalized.split(".");
  if (
    labels.length === 0 ||
    labels.some((label) => !label || !META_PREFIX_LABEL_REGEX.test(label))
  ) {
    return null;
  }

  return labels;
};

/**
 * Determines whether a metadata key is within the MCP-reserved namespace.
 *
 * @param key - Full metadata key entered by the user.
 * @returns True if the key's prefix belongs to a reserved namespace.
 * @see https://modelcontextprotocol.io/specification/2025-06-18/basic/index#meta
 */
export const isReservedMetaKey = (key: string): boolean => {
  const trimmedKey = key.trim();
  if (!trimmedKey) {
    return false;
  }

  const candidateSegment = getPrefixSegment(trimmedKey) ?? trimmedKey;
  const labels = splitLabels(candidateSegment);
  if (!labels || labels.length < 2) {
    return false;
  }

  for (let i = 0; i < labels.length - 1; i += 1) {
    const current = labels[i];
    const next = labels[i + 1];
    if (
      RESERVED_NAMESPACE_LABELS.includes(current) &&
      META_PREFIX_LABEL_REGEX.test(next)
    ) {
      return true;
    }
  }

  return false;
};

/**
 * Validates the optional prefix portion of a metadata key.
 *
 * @param key - Full metadata key entered by the user.
 * @returns True when the prefix is absent or satisfies the MCP label requirements.
 * @see https://modelcontextprotocol.io/specification/2025-06-18/basic/index#meta
 */
export const hasValidMetaPrefix = (key: string): boolean => {
  const prefixSegment = getPrefixSegment(key);
  if (prefixSegment === null) {
    return true;
  }

  return splitLabels(prefixSegment) !== null;
};

const extractMetaName = (key: string): string => {
  const trimmedKey = key.trim();
  if (!trimmedKey) return "";

  const slashIndex = trimmedKey.lastIndexOf("/");
  if (slashIndex === -1) {
    return trimmedKey;
  }

  return trimmedKey.slice(slashIndex + 1);
};

/**
 * Validates the "name" portion of a metadata key, regardless of whether a prefix exists.
 *
 * @param key - Full metadata key entered by the user.
 * @returns True if the name portion is valid per the MCP spec.
 * @see https://modelcontextprotocol.io/specification/2025-06-18/basic/index#meta
 */
export const hasValidMetaName = (key: string): boolean => {
  const name = extractMetaName(key);
  if (!name) return false;

  return META_NAME_REGEX.test(name);
};
