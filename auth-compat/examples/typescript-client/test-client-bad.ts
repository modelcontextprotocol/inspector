#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { OAuthClientMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InMemoryOAuthClientProvider } from './oauth-provider.js';

async function main(): Promise<void> {
  const serverUrl = process.argv[2];

  if (!serverUrl) {
    console.error('Usage: test-client-bad <server-url>');
    process.exit(1);
  }

  console.log(`Connecting to MCP server at: ${serverUrl}`);

  const CALLBACK_URL = `http://localhost:8090/callback`;

  try {
    // Set up OAuth provider
    const clientMetadata: OAuthClientMetadata = {
      client_name: 'Bad Test Client',
      redirect_uris: [CALLBACK_URL],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'mcp'
    };

    const oauthProvider = new InMemoryOAuthClientProvider(
      CALLBACK_URL,
      clientMetadata
    );

    // Override the token endpoint to NOT include resource parameter
    const originalGetTokens = oauthProvider.getTokens.bind(oauthProvider);
    oauthProvider.getTokens = async function(this: any, tokenEndpoint, authorizationCode, codeVerifier) {
      console.log('[BAD CLIENT] Requesting tokens WITHOUT resource parameter');
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code: authorizationCode,
        redirect_uri: CALLBACK_URL,
        code_verifier: codeVerifier
      });
      // Intentionally omit resource parameter to fail conformance checks
      
      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      if (!response.ok) {
        throw new Error(`Token request failed: ${response.statusText}`);
      }

      return response.json();
    };

    const client = new Client({
      name: 'bad-test-client',
      version: '1.0.0'
    }, {
      capabilities: {}
    });

    let transport = new StreamableHTTPClientTransport(
      new URL(serverUrl),
      {
        authProvider: oauthProvider
      }
    );

    await client.connect(transport);

    console.log('Successfully initialized MCP client');

    // List tools
    const tools = await client.listTools();
    console.log(`Found ${tools.tools.length} tool(s)`);

    await client.close();
    process.exit(0);

  } catch (error) {
    if (error instanceof UnauthorizedError) {
      console.error('Authorization failed:', error.message);
      process.exit(1);
    } else {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }
}

main();
