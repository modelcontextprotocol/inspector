import { describe, test, expect } from '@jest/globals';
import { runComplianceTest, collectAllConformanceChecks, printVerboseOutput } from './helpers/test-utils.js';

const CLIENT_COMMAND = process.env.CLIENT_COMMAND || 'tsx examples/typescript-client/test-client.ts';
const VERBOSE = process.env.VERBOSE === 'true';

describe('Basic Compliance', () => {
  describe('Basic MCP Connection without authentication', () => {
    test('Client can connect and list tools without auth', async () => {
      const { checks, clientOutput, behavior, authServerTrace } = await runComplianceTest(
        CLIENT_COMMAND,
        { authRequired: false },
        { timeout: 30000, verbose: VERBOSE }
      );

      if (VERBOSE) {
        printVerboseOutput(checks, behavior, authServerTrace, clientOutput);
      }

      expect(clientOutput.exitCode).toBe(0);
      expect(clientOutput.timedOut).toBe(false);
      expect(behavior.connected).toBe(true);
      expect(behavior.initialized).toBe(true);

      // Test each conformance check
      const allChecks = collectAllConformanceChecks(checks, behavior);
      allChecks.forEach(check => {
        expect(`${check.id}: ${check.status}`).toBe(`${check.id}: SUCCESS`);
      });
    });
  });

  describe('Standard OAuth2/OIDC authorization flow', () => {
    test('Client completes OAuth flow with default settings', async () => {
      const { checks, clientOutput, behavior, authServerTrace, serverPort } = await runComplianceTest(
        CLIENT_COMMAND,
        { authRequired: true },
        { timeout: 30000, verbose: VERBOSE }
      );

      if (VERBOSE) {
        printVerboseOutput(checks, behavior, authServerTrace, clientOutput);
      }

      // Client behavior
      expect(clientOutput.exitCode).toBe(0);
      expect(clientOutput.timedOut).toBe(false);
      expect(behavior.connected).toBe(true);
      expect(behavior.initialized).toBe(true);
      expect(behavior.authMetadataRequested).toBe(true);
      expect(authServerTrace.length).toBeGreaterThan(0);

      // Resource parameter validation
      const expectedResource = `http://localhost:${serverPort}/`;
      expect(behavior.authResourceParameter).toBe(expectedResource);
      expect(behavior.tokenResourceParameter).toBe(expectedResource);

      // Test each conformance check
      const allChecks = collectAllConformanceChecks(checks, behavior);
      allChecks.forEach(check => {
        expect(`${check.id}: ${check.status}`).toBe(`${check.id}: SUCCESS`);
      });
    });
  });
});
