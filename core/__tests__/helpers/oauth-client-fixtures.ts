/**
 * OAuth client test fixtures for InspectorClient OAuth tests.
 * These produce InspectorClient OAuth configuration and simulate OAuth flows.
 */

import type {
  OAuthNavigation,
  RedirectUrlProvider,
} from "../../auth/providers.js";
import type { OAuthStorage } from "../../auth/storage.js";
import { ConsoleNavigation } from "../../auth/providers.js";
import { NodeOAuthStorage } from "../../auth/node/storage-node.js";

/** Creates a static RedirectUrlProvider for tests. Single URL for both modes. */
function createStaticRedirectUrlProvider(
  redirectUrl: string,
): RedirectUrlProvider {
  return {
    getRedirectUrl: () => redirectUrl,
  };
}

/**
 * Creates OAuth configuration for InspectorClient tests
 */
export function createOAuthClientConfig(options: {
  mode: "static" | "dcr" | "cimd";
  clientId?: string;
  clientSecret?: string;
  clientMetadataUrl?: string;
  redirectUrl: string;
  scope?: string;
}): {
  clientId?: string;
  clientSecret?: string;
  clientMetadataUrl?: string;
  redirectUrlProvider: RedirectUrlProvider;
  scope?: string;
  storage: OAuthStorage;
  navigation: OAuthNavigation;
} {
  const config: {
    clientId?: string;
    clientSecret?: string;
    clientMetadataUrl?: string;
    redirectUrlProvider: RedirectUrlProvider;
    scope?: string;
    storage: OAuthStorage;
    navigation: OAuthNavigation;
  } = {
    redirectUrlProvider: createStaticRedirectUrlProvider(options.redirectUrl),
    storage: new NodeOAuthStorage(),
    navigation: new ConsoleNavigation(),
  };

  if (options.mode === "static") {
    if (!options.clientId) {
      throw new Error("clientId is required for static mode");
    }
    config.clientId = options.clientId;
    if (options.clientSecret) {
      config.clientSecret = options.clientSecret;
    }
  } else if (options.mode === "dcr") {
    // DCR mode - no clientId needed, will be registered
    if (options.clientId) {
      config.clientId = options.clientId;
    }
  } else if (options.mode === "cimd") {
    if (!options.clientMetadataUrl) {
      throw new Error("clientMetadataUrl is required for CIMD mode");
    }
    config.clientMetadataUrl = options.clientMetadataUrl;
  }

  if (options.scope) {
    config.scope = options.scope;
  }

  return config;
}

/**
 * Client metadata document for CIMD testing
 */
export interface ClientMetadataDocument {
  redirect_uris: string[];
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  client_name?: string;
  client_uri?: string;
  scope?: string;
}

/**
 * Creates an Express server that serves a client metadata document for CIMD testing
 * The server runs on a different port and serves the metadata at the root path
 *
 * @param metadata - The client metadata document to serve
 * @returns Object with server URL and cleanup function
 */
export async function createClientMetadataServer(
  metadata: ClientMetadataDocument,
): Promise<{ url: string; stop: () => Promise<void> }> {
  const express = await import("express");
  const app = express.default();

  app.get("/", (req, res) => {
    res.json(metadata);
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to get server address"));
        return;
      }
      const port = address.port;
      const url = `http://localhost:${port}`;

      resolve({
        url,
        stop: async () => {
          return new Promise<void>((resolveStop) => {
            server.close(() => {
              resolveStop();
            });
          });
        },
      });
    });

    server.on("error", reject);
  });
}

/**
 * Helper function to programmatically complete OAuth authorization
 * Makes HTTP GET request to authorization URL and extracts authorization code
 * The test server's authorization endpoint auto-approves and redirects with code
 *
 * @param authorizationUrl - The authorization URL from oauthAuthorizationRequired event
 * @returns Authorization code extracted from redirect URL
 */
export async function completeOAuthAuthorization(
  authorizationUrl: URL,
): Promise<string> {
  const response = await fetch(authorizationUrl.toString(), {
    redirect: "manual",
  });

  if (response.status !== 302 && response.status !== 301) {
    throw new Error(
      `Expected redirect (302/301), got ${response.status}: ${await response.text()}`,
    );
  }

  const redirectUrl = response.headers.get("location");
  if (!redirectUrl) {
    throw new Error("No Location header in redirect response");
  }

  const redirectUrlObj = new URL(redirectUrl);
  const code = redirectUrlObj.searchParams.get("code");
  if (!code) {
    throw new Error(`No authorization code in redirect URL: ${redirectUrl}`);
  }

  return code;
}
