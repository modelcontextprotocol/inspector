import { Fragment, useMemo, useState } from "react";
import { Button, Code, Flex, Stack, Text } from "@mantine/core";
import { decodeJwtPayload, isJwtFormat } from "@inspector/core/auth/ema/jwt.js";
import { CopyButton } from "../../elements/CopyButton/CopyButton";

/**
 * One labelled OAuth token row: the raw value, a copy control, and — when the
 * value has the three-segment JWT shape — an in-place "Decode JWT" toggle.
 *
 * Shared by the Access Token and ID Token rows (#2019). The decode is
 * display-only (`decodeJwtPayload` does no signature verification), so this is
 * a viewer: neither token is treated as a credential here.
 */
export interface OAuthTokenFieldProps {
  /** Row caption, e.g. "Access Token" / "ID Token". */
  label: string;
  token: string;
  onClear?: () => void;
  clearLabel?: string;
}

const CaptionRow = Flex.withProps({
  justify: "space-between",
  align: "center",
  gap: "sm",
  wrap: "nowrap",
});

// Bold, matching every other field label in Connection Info (#2328) — the
// token rows sit in the same OAuth Details list as Client ID and Scopes, so a
// lighter caption here would break the column a reader scans down.
const Caption = Text.withProps({ size: "sm", fw: 600 });

const Toolbar = Flex.withProps({
  gap: 4,
  align: "center",
  wrap: "nowrap",
});

const ToolbarButton = Button.withProps({
  variant: "subtle",
  size: "compact-xs",
});

const TokenRow = Flex.withProps({
  align: "flex-start",
  gap: 4,
  wrap: "nowrap",
});

const TokenColumn = Flex.withProps({
  flex: 1,
  miw: 0,
  direction: "column",
});

const TokenCode = Code.withProps({
  block: true,
  py: "xs",
  ps: "xs",
  pe: 0,
  variant: "wrapping",
});

/** Wrap JWT at segment boundaries; break long segments without orphaning `.`. */
function JwtTokenText({ token }: { token: string }) {
  const parts = token.split(".");
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && "."}
          {part}
        </Fragment>
      ))}
    </>
  );
}

export function OAuthTokenField({
  label,
  token,
  onClear,
  clearLabel = "Clear",
}: OAuthTokenFieldProps) {
  const [showDecoded, setShowDecoded] = useState(false);
  const isJwt = isJwtFormat(token);
  const jwtDecoded = useMemo(
    () => (isJwt ? decodeJwtPayload(token) : undefined),
    [token, isJwt],
  );

  const decodedText = useMemo(() => {
    if (!jwtDecoded) return undefined;
    return JSON.stringify(
      { header: jwtDecoded.header, payload: jwtDecoded.payload },
      null,
      2,
    );
  }, [jwtDecoded]);

  const copyValue = showDecoded && decodedText ? decodedText : token;

  return (
    <Stack gap="xs">
      <CaptionRow>
        <Caption>{label}</Caption>
        <Toolbar>
          {jwtDecoded && (
            <ToolbarButton
              onClick={() => setShowDecoded((open) => !open)}
              aria-pressed={showDecoded}
              aria-label={`${showDecoded ? "Show token" : "Decode JWT"} for ${label}`}
            >
              {showDecoded ? "Show token" : "Decode JWT"}
            </ToolbarButton>
          )}
          {onClear && (
            <ToolbarButton color="red" onClick={onClear}>
              {clearLabel}
            </ToolbarButton>
          )}
        </Toolbar>
      </CaptionRow>
      <TokenRow>
        <TokenColumn>
          <TokenCode>
            {showDecoded && decodedText ? (
              decodedText
            ) : isJwt ? (
              <JwtTokenText token={token} />
            ) : (
              token
            )}
          </TokenCode>
        </TokenColumn>
        <CopyButton value={copyValue} flush label={label} />
      </TokenRow>
    </Stack>
  );
}
