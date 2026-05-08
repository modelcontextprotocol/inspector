import { describe, test, expect } from '@jest/globals';
import { runComplianceTest, printVerboseOutput } from './helpers/test-utils.js';

// Get client command from environment or use a default
const CLIENT_COMMAND = process.env.CLIENT_COMMAND || 'tsx examples/typescript-client/test-client.ts';
const VERBOSE = process.env.VERBOSE === 'true';

describe('Metadata Location Tests', () => {
  describe('Tests different OAuth protected resource metadata locations', () => {

    const testCases: Array<[string, string, boolean]> = [
      ['Non-standard location with WWW-Authenticate', '/custom/oauth/metadata', true],
      ['Standard location without WWW-Authenticate', '/.well-known/oauth-protected-resource', false],
      ['Nested well-known path with WWW-Authenticate', '/.well-known/oauth-protected-resource/mcp', false],
    ];

    test.each(testCases)(
      '%s',
      async (name, metadataLocation, includeWwwAuth) => {
        const { report, clientOutput, behavior, authServerTrace } = await runComplianceTest(
          CLIENT_COMMAND,
          {
            authRequired: true,
            metadataLocation,
            includeWwwAuthenticate: includeWwwAuth
          },
          { timeout: 30000, verbose: VERBOSE }
        );

        if (VERBOSE) {
          console.log(`\nTest: ${name}`);
          printVerboseOutput(report, behavior, authServerTrace, clientOutput);
        }

        expect(clientOutput.exitCode).toBe(0);
        expect(behavior.authMetadataRequested).toBe(true);
      }
    );
  });

  describe('OAuth Authorization Server metadata discovery at different locations', () => {

    const testCases: Array<[string, string]> = [
      ['OAuth 2.0 standard location', '/.well-known/oauth-authorization-server'],
      ['OAuth 2.0 with path component', '/.well-known/oauth-authorization-server/tenant1'],
      ['OpenID Connect standard location', '/.well-known/openid-configuration'],
      ['OpenID Connect with path component', '/.well-known/openid-configuration/tenant1'],
      ['OpenID Connect path appending', '/tenant1/.well-known/openid-configuration'],
    ];

    test.each(testCases)(
      '%s',
      async (name, authServerMetadataLocation) => {
        const { report, clientOutput, behavior, authServerTrace } = await runComplianceTest(
          CLIENT_COMMAND,
          {
            authRequired: true,
            metadataLocation: '/.well-known/oauth-protected-resource',
            authServerMetadataLocation,
            includeWwwAuthenticate: true
          },
          { timeout: 30000, verbose: VERBOSE }
        );

        if (VERBOSE) {
          console.log(`\nTest: ${name}`);
          printVerboseOutput(report, behavior, authServerTrace, clientOutput);
        }

        expect(clientOutput.exitCode).toBe(0);
        expect(behavior.authMetadataRequested).toBe(true);

        // Verify auth server metadata was requested at the expected location
        const authMetadataRequest = authServerTrace?.find((trace: any) =>
          trace.url === authServerMetadataLocation && trace.method === 'GET'
        );
        expect(authMetadataRequest).toBeDefined();
      }
    );
  });
});
