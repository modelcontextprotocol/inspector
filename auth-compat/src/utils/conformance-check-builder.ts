import { ConformanceCheck, CheckStatus } from '../types.js';

export interface CheckContext {
  id: string;
  name: string;
  description: string;
  status: CheckStatus;
  details?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  specReferences?: Array<{ id: string; url?: string }>;
  errorMessage?: string;
  logs?: string[];
}

export function createConformanceCheck(context: CheckContext): ConformanceCheck {
  return {
    id: context.id,
    name: context.name,
    description: context.description,
    status: context.status,
    timestamp: new Date().toISOString(),
    details: context.details,
    metadata: context.metadata,
    specReferences: context.specReferences,
    errorMessage: context.errorMessage,
    logs: context.logs
  };
}

export function createAuthorizationRequestCheck(
  params: Record<string, any>,
  status: CheckStatus = 'SUCCESS',
  errors?: string[]
): ConformanceCheck {
  const errorMessage = errors && errors.length > 0 ? errors[0] : undefined;
  
  return createConformanceCheck({
    id: 'oauth-authorization-request',
    name: 'OAuthAuthorizationRequest',
    description: 'OAuth2 authorization endpoint request',
    status: status,
    specReferences: [
      { id: 'RFC-6749-4.1', url: 'https://tools.ietf.org/html/rfc6749#section-4.1' }
    ],
    details: {
      response_type: params.response_type,
      client_id: params.client_id,
      redirect_uri: params.redirect_uri,
      state: params.state,
      scope: params.scope,
      code_challenge: params.code_challenge,
      code_challenge_method: params.code_challenge_method,
      resource: params.resource
    },
    metadata: {
      paramCount: Object.keys(params).length,
      allParams: params
    },
    errorMessage: errorMessage || (status === 'FAILURE' ? 'Authorization request validation failed' : undefined)
  });
}

export function createTokenRequestCheck(
  body: Record<string, any>,
  status: CheckStatus = 'SUCCESS',
  errors?: string[]
): ConformanceCheck {
  const errorMessage = errors && errors.length > 0 ? errors[0] : undefined;

  return createConformanceCheck({
    id: 'oauth-token-request',
    name: 'OAuthTokenRequest',
    description: 'OAuth2 token endpoint request',
    status: status,
    specReferences: [
      { id: 'RFC-6749-4.1.3', url: 'https://tools.ietf.org/html/rfc6749#section-4.1.3' }
    ],
    details: {
      grant_type: body.grant_type,
      code: body.code ? '[redacted]' : undefined,
      redirect_uri: body.redirect_uri,
      client_id: body.client_id,
      code_verifier: body.code_verifier ? '[redacted]' : undefined,
      refresh_token: body.refresh_token ? '[redacted]' : undefined,
      resource: body.resource,
      scope: body.scope
    },
    metadata: {
      paramCount: Object.keys(body).length,
      hasSensitiveData: !!body.code_verifier || !!body.refresh_token
    },
    errorMessage: errorMessage || (status === 'FAILURE' ? 'Token request validation failed' : undefined)
  });
}

export function createMetadataDiscoveryCheck(
  metadataLocation: string,
  status: CheckStatus = 'SUCCESS'
): ConformanceCheck {
  return createConformanceCheck({
    id: 'metadata-discovery',
    name: 'MetadataDiscovery',
    description: `OAuth metadata discovery at ${metadataLocation}`,
    status: status,
    specReferences: [
      { id: 'RFC-8414', url: 'https://tools.ietf.org/html/rfc8414' }
    ],
    details: {
      metadata_location: metadataLocation
    },
    errorMessage: status === 'FAILURE' ? 'Metadata discovery failed' : undefined
  });
}

export function createClientIdValidationCheck(
  provided: string,
  expected: string
): ConformanceCheck {
  const matches = provided === expected;
  
  return createConformanceCheck({
    id: 'client-id-validation',
    name: 'ClientIDValidation',
    description: 'Validate client_id matches expected value',
    status: matches ? 'SUCCESS' : 'FAILURE',
    specReferences: [
      { id: 'RFC-6749-2.2', url: 'https://tools.ietf.org/html/rfc6749#section-2.2' }
    ],
    details: {
      provided: provided,
      expected: expected,
      matches: matches
    },
    errorMessage: !matches ? `Client ID mismatch: expected ${expected}, got ${provided}` : undefined
  });
}

export function createTokenValidationCheck(
  token: string,
  expected: string,
  tokenType: 'access_token' | 'refresh_token' = 'access_token'
): ConformanceCheck {
  const matches = token === expected;
  
  return createConformanceCheck({
    id: `${tokenType}-validation`,
    name: tokenType === 'access_token' ? 'AccessTokenValidation' : 'RefreshTokenValidation',
    description: `Validate ${tokenType} value`,
    status: matches ? 'SUCCESS' : 'FAILURE',
    specReferences: [
      { id: 'RFC-6749-5.1', url: 'https://tools.ietf.org/html/rfc6749#section-5.1' }
    ],
    details: {
      token_type: tokenType,
      provided: token ? '[redacted]' : undefined,
      matches: matches
    },
    metadata: {
      tokenLength: token ? token.length : 0
    },
    errorMessage: !matches ? `${tokenType} validation failed` : undefined
  });
}
