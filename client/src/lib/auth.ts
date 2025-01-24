import pkceChallenge from 'pkce-challenge';

export interface OAuthMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
}

export async function discoverOAuthMetadata(serverUrl: string): Promise<OAuthMetadata> {
  try {
    const url = new URL('/.well-known/oauth-authorization-server', serverUrl);
    const response = await fetch(url.toString());
    
    if (response.ok) {
      const metadata = await response.json();
      return {
        authorization_endpoint: metadata.authorization_endpoint,
        token_endpoint: metadata.token_endpoint
      };
    }
  } catch (error) {
    console.warn('OAuth metadata discovery failed:', error);
  }

  // Fall back to default endpoints
  const baseUrl = new URL(serverUrl);
  return {
    authorization_endpoint: new URL('/authorize', baseUrl).toString(),
    token_endpoint: new URL('/token', baseUrl).toString()
  };
}

export async function startOAuthFlow(serverUrl: string): Promise<string> {
  // Generate PKCE challenge
  const challenge = await pkceChallenge();
  const codeVerifier = challenge.code_verifier;
  const codeChallenge = challenge.code_challenge;
  
  // Store code verifier for later use
  sessionStorage.setItem('mcp_code_verifier', codeVerifier);
  
  // Discover OAuth endpoints
  const metadata = await discoverOAuthMetadata(serverUrl);
  
  // Build authorization URL
  const authUrl = new URL(metadata.authorization_endpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('redirect_uri', window.location.origin + '/oauth/callback');
  
  return authUrl.toString();
}
