import { ValidationServer } from './src/server/validation/index.js';

async function debugConformanceChecks() {
  const server = new ValidationServer({ authRequired: true }, true);
  const port = await server.start();
  
  console.log(`\n✅ Validation server started on port ${port}`);
  console.log(`Auth server URL: ${server.authServer?.getUrl()}\n`);

  // Simulate a client making requests
  try {
    // Make initialize request without auth
    const initResponse = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'Debug Client', version: '1.0.0' }
        }
      })
    });

    console.log(`Initialize response status: ${initResponse.status}`);

    // Simulate auth flow - get metadata
    const metadataResponse = await fetch(`http://localhost:${port}/.well-known/oauth-protected-resource`);
    const metadata = await metadataResponse.json();
    console.log(`Metadata auth servers:`, metadata.authorization_servers);

    // Get auth server and make authorization request
    if (server.authServer) {
      const authServerUrl = server.authServer.getUrl();
      const authorizeUrl = new URL(`${authServerUrl}/authorize`);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('client_id', 'test-client');
      authorizeUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
      authorizeUrl.searchParams.set('state', 'random-state-123');
      authorizeUrl.searchParams.set('code_challenge', 'E9Mrozoa2owUednArgument9Argument9Argument9Argument9Argument9Arg');
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');
      authorizeUrl.searchParams.set('resource', `http://localhost:${port}/`);

      const authResponse = await fetch(authorizeUrl.toString());
      console.log(`\nAuthorization request status: ${authResponse.status}`);

      // Get conformance checks from auth server
      console.log(`\n📋 Auth Server Conformance Checks (${server.authServer.getConformanceChecks().length} total):`);
      server.authServer.getConformanceChecks().forEach(check => {
        console.log(`\n  ✓ ${check.id}`);
        console.log(`    Name: ${check.name}`);
        console.log(`    Status: ${check.status}`);
        console.log(`    Description: ${check.description}`);
        if (check.details) {
          console.log(`    Details:`, JSON.stringify(check.details, null, 6).split('\n').slice(0, 10).join('\n'));
        }
      });
    }

    // Get validation server checks
    const behavior = server.getClientBehavior();
    console.log(`\n📋 Validation Server Conformance Checks (${behavior.conformanceChecks?.length || 0} total):`);
    behavior.conformanceChecks?.forEach(check => {
      console.log(`\n  ✓ ${check.id}`);
      console.log(`    Name: ${check.name}`);
      console.log(`    Status: ${check.status}`);
      console.log(`    Description: ${check.description}`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await server.stop();
    console.log('\n✅ Server stopped\n');
  }
}

debugConformanceChecks();
