import { TestSuite } from ".";



// Test suite definitions
export const basicSuite: TestSuite = {
  name: 'Basic Compliance',
  description: 'Tests basic MCP protocol compliance without authentication',
  scenarios: [
    {
      name: 'Basic MCP Connection',
      description: 'Client can connect and list tools without auth',
      serverConfig: {
        authRequired: false
      },
      expectedResult: 'PASS'
    }
  ]
};

export const oauthSuite: TestSuite = {
  name: 'OAuth Compliance',
  description: 'Tests OAuth2/OIDC authorization flow',
  scenarios: [
    {
      name: 'Standard OAuth Flow',
      description: 'Client completes OAuth flow with default settings',
      serverConfig: {
        authRequired: true
      },
      expectedResult: 'PASS'
    }
  ]
};

export const metadataLocationSuite: TestSuite = {
  name: 'Metadata Location Tests',
  description: 'Tests different OAuth protected resource metadata locations',
  scenarios: [
    {
      name: 'Standard location with WWW-Authenticate',
      serverConfig: {
        authRequired: true,
        metadataLocation: '/.well-known/oauth-protected-resource',
        includeWwwAuthenticate: true
      },
      expectedResult: 'PASS'
    },
    {
      name: 'Non-standard location with WWW-Authenticate',
      description: 'Custom metadata path advertised via WWW-Authenticate header',
      serverConfig: {
        authRequired: true,
        metadataLocation: '/custom/oauth/metadata',
        includeWwwAuthenticate: true
      },
      expectedResult: 'PASS'
    },
    {
      name: 'Nested well-known path with WWW-Authenticate',
      serverConfig: {
        authRequired: true,
        metadataLocation: '/.well-known/oauth-protected-resource/mcp',
        includeWwwAuthenticate: true
      },
      expectedResult: 'PASS'
    },
    {
      name: 'Standard location without WWW-Authenticate',
      description: 'Client should find metadata at standard location',
      serverConfig: {
        authRequired: true,
        metadataLocation: '/.well-known/oauth-protected-resource',
        includeWwwAuthenticate: false
      },
      expectedResult: 'PASS'
    },
    {
      name: 'Non-standard location without WWW-Authenticate',
      description: 'Client cannot find metadata without header hint',
      serverConfig: {
        authRequired: true,
        metadataLocation: '/custom/oauth/metadata',
        includeWwwAuthenticate: false
      },
      expectedResult: 'FAIL'  // Should fail - client won't find non-standard location
    }
  ]
};

// TODO: this is busted
export const behaviorSuite: TestSuite = {
  name: 'Client Behavior Validation',
  description: 'Tests specific client behaviors',
  scenarios: [
    {
      name: 'Client requests metadata',
      serverConfig: {
        authRequired: true
      },
      expectedResult: 'PASS',
      validateBehavior: (behavior) => {
        const errors = [];
        if (!behavior.authMetadataRequested) {
          errors.push('Client did not request OAuth metadata');
        }
        if (!behavior.initialized) {
          errors.push('Client did not complete initialization');
        }
        return errors;
      }
    }
  ]
};
