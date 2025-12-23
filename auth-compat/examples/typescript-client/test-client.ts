#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { OAuthClientMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InMemoryOAuthClientProvider } from './oauth-provider.js';

async function main(): Promise<void> {
  const serverUrl = process.argv[2];

  if (!serverUrl) {
    console.error('Usage: test-client <server-url>');
    process.exit(1);
  }

  console.log(`Connecting to MCP server at: ${serverUrl}`);

  const CALLBACK_URL = `http://localhost:8090/callback`;

  try {
    // Set up OAuth provider
    const clientMetadata: OAuthClientMetadata = {
      client_name: 'Test Client',
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

    const client = new Client({
      name: 'test-client',
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

    // Try to connect - handle OAuth if needed
    try {
      await client.connect(transport);
      console.log('✅ Successfully connected to MCP server');
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        console.log('🔐 OAuth required - handling authorization...');

        // The provider will automatically fetch the auth code
        const authCode = await oauthProvider.getAuthCode();

        // Complete the auth flow
        await transport.finishAuth(authCode);
        
        // Close the old transport
        await transport.close();
        
        // Create a new transport with the authenticated provider
        transport = new StreamableHTTPClientTransport(
          new URL(serverUrl),
          {
            authProvider: oauthProvider
          }
        );
        
        // Connect with the new transport
        await client.connect(transport);
        console.log('✅ Successfully connected with authentication');
      } else {
        throw error;
      }
    }

    await client.listTools();
    console.log('✅ Successfully listed tools')


    await transport.close();
    console.log('✅ Connection closed successfully');

    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to connect to MCP server:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
