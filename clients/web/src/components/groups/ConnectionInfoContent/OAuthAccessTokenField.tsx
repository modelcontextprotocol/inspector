import { Fragment, useMemo, useState } from "react";
import { Button, Code, Flex, Stack, Text } from "@mantine/core";
import { decodeJwtPayload, isJwtFormat } from "@inspector/core/auth/ema/jwt.js";
import { CopyButton } from "../../elements/CopyButton/CopyButton";

export interface OAuthAccessTokenFieldProps {
  accessToken: string;
}

const DecodeButton = Button.withProps({
  variant: "subtle",
  size: "compact-xs",
});

/** Wrap JWT at segment boundaries; break long segments without orphaning `.`. */
function JwtTokenText({ token }: { token: string }) {
  const parts = token.split(".");
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && "."}
          <span style={{ wordBreak: "break-all" }}>{part}</span>
        </Fragment>
      ))}
    </>
  );
}

export function OAuthAccessTokenField({
  accessToken,
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

  return (
    <Stack gap="xs">
      <Flex justify="space-between" align="center" gap="sm" wrap="nowrap">
        <Text size="sm">Access Token</Text>
        <Flex gap={4} align="center" wrap="nowrap">
          {jwtDecoded && (
            <DecodeButton
              onClick={() => setShowDecoded((open) => !open)}
              aria-pressed={showDecoded}
            >
              {showDecoded ? "Show token" : "Decode JWT"}
            </DecodeButton>
          )}
          <CopyButton value={accessToken} />
        </Flex>
      </Flex>
      <Code block p="sm" variant="wrapping">
        {showDecoded && decodedText ? (
          decodedText
        ) : isJwt ? (
          <JwtTokenText token={accessToken} />
        ) : (
          accessToken
        )}
      </Code>
    </Stack>
  );
}
