import { Fragment, useMemo, useState } from "react";
import { Button, Code, Flex, Stack, Text } from "@mantine/core";
import { decodeJwtPayload, isJwtFormat } from "@inspector/core/auth/ema/jwt.js";
import { CopyButton } from "../../elements/CopyButton/CopyButton";

export interface OAuthAccessTokenFieldProps {
  accessToken: string;
  onClear?: () => void;
  clearLabel?: string;
}

const CaptionRow = Flex.withProps({
  justify: "space-between",
  align: "center",
  gap: "sm",
  wrap: "nowrap",
});

const Caption = Text.withProps({ size: "sm" });

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

export function OAuthAccessTokenField({
  accessToken,
  onClear,
  clearLabel = "Clear",
}: OAuthAccessTokenFieldProps) {
  const [showDecoded, setShowDecoded] = useState(false);
  const isJwt = isJwtFormat(accessToken);
  const jwtDecoded = useMemo(
    () => (isJwt ? decodeJwtPayload(accessToken) : undefined),
    [accessToken, isJwt],
  );

  const decodedText = useMemo(() => {
    if (!jwtDecoded) return undefined;
    return JSON.stringify(
      { header: jwtDecoded.header, payload: jwtDecoded.payload },
      null,
      2,
    );
  }, [jwtDecoded]);

  const copyValue = showDecoded && decodedText ? decodedText : accessToken;

  return (
    <Stack gap="xs">
      <CaptionRow>
        <Caption>Access Token</Caption>
        <Toolbar>
          {jwtDecoded && (
            <ToolbarButton
              onClick={() => setShowDecoded((open) => !open)}
              aria-pressed={showDecoded}
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
              <JwtTokenText token={accessToken} />
            ) : (
              accessToken
            )}
          </TokenCode>
        </TokenColumn>
        <CopyButton value={copyValue} flush />
      </TokenRow>
    </Stack>
  );
}
