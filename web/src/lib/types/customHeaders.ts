export interface CustomHeader {
  name: string;
  value: string;
  enabled: boolean;
}

export type CustomHeaders = CustomHeader[];

export const createEmptyHeader = (): CustomHeader => ({
  name: "",
  value: "",
  enabled: true,
});

export const createHeaderFromBearerToken = (
  bearerToken: string,
  headerName?: string,
): CustomHeader => ({
  name: headerName || "Authorization",
  value:
    headerName?.toLowerCase() === "authorization" || !headerName
      ? `Bearer ${bearerToken}`
      : bearerToken,
  enabled: true,
});

export const getEnabledHeaders = (headers: CustomHeaders): CustomHeaders => {
  return headers.filter(
    (header) => header.enabled && header.name.trim() && header.value.trim(),
  );
};

export const headersToRecord = (
  headers: CustomHeaders,
): Record<string, string> => {
  const enabledHeaders = getEnabledHeaders(headers);
  const record: Record<string, string> = {};

  enabledHeaders.forEach((header) => {
    record[header.name.trim()] = header.value.trim();
  });

  return record;
};

export const recordToHeaders = (
  record: Record<string, string>,
): CustomHeaders => {
  return Object.entries(record).map(([name, value]) => ({
    name,
    value,
    enabled: true,
  }));
};

// Migration helper for backward compatibility
export const migrateFromLegacyAuth = (
  bearerToken?: string,
  headerName?: string,
): CustomHeaders => {
  return bearerToken
    ? [createHeaderFromBearerToken(bearerToken, headerName)]
    : [];
};
