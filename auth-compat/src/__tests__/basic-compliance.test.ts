import { describe, test, expect, beforeAll } from '@jest/globals';
import { runComplianceTest, printVerboseOutput } from './helpers/test-utils.js';

// Get client command from environment or use a default
const CLIENT_COMMAND = process.env.CLIENT_COMMAND || 'tsx examples/typescript-client/test-client.ts';
const VERBOSE = process.env.VERBOSE === 'true';

describe('Basic Compliance', () => {
  describe('Tests basic MCP protocol compliance without authentication', () => {
    test('Basic MCP Connection - Client can connect and list tools without auth', async () => {
      const { report, clientOutput, behavior, authServerTrace } = await runComplianceTest(
        CLIENT_COMMAND,
        {
          authRequired: false
        },
        {
          timeout: 30000,
          verbose: VERBOSE
        }
      );

      // Print verbose output if requested
      if (VERBOSE) {
        printVerboseOutput(report, behavior, authServerTrace, clientOutput);
      }

      // Assertions
      expect(clientOutput.exitCode).toBe(0);
      expect(clientOutput.timedOut).toBe(false);
      expect(behavior.connected).toBe(true);
      expect(behavior.initialized).toBe(true);
    });
  });

  describe('Tests OAuth2/OIDC authorization flow', () => {
    test('Standard OAuth Flow - Client completes OAuth flow with default settings', async () => {
      const { report, clientOutput, behavior, authServerTrace, serverPort } = await runComplianceTest(
        CLIENT_COMMAND,
        {
          authRequired: true
        },
        {
          timeout: 30000,
          verbose: VERBOSE
        }
      );

      // Print verbose output if requested
      if (VERBOSE) {
        printVerboseOutput(report, behavior, authServerTrace, clientOutput);
      }

      // Assertions
      expect(clientOutput.exitCode).toBe(0);
      expect(clientOutput.timedOut).toBe(false);
      expect(behavior.connected).toBe(true);
      expect(behavior.initialized).toBe(true);
      expect(behavior.authMetadataRequested).toBe(true);

      // Verify auth server was contacted
      expect(authServerTrace.length).toBeGreaterThan(0);

      // Verify resource parameter matches PRM exactly
      // The PRM always returns http://localhost:{port} as the resource
      const expectedResource = `http://localhost:${serverPort}/`;
      expect(behavior.authResourceParameter).toBe(expectedResource);
      expect(behavior.tokenResourceParameter).toBe(expectedResource);
    });
  });
});
