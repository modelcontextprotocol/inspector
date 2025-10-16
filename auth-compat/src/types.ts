export type CheckStatus = 'SUCCESS' | 'FAILURE' | 'WARNING' | 'SKIPPED' | 'INFO';

export interface SpecReference {
  id: string;
  url?: string;
}

export interface ConformanceCheck {
  id: string;
  name: string;
  description: string;
  status: CheckStatus;
  timestamp: string;
  specReferences?: SpecReference[];
  details?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  errorMessage?: string;
  logs?: string[];
}

export interface HttpTrace {
  timestamp: string;
  method: string;
  url: string;
  headers: Record<string, any>;
  body?: any;
  response?: {
    status: number;
    headers?: Record<string, any>;
    body?: any;
  };
}

export interface ClientBehavior {
  connected: boolean;
  initialized: boolean;
  protocolVersion?: string;
  clientInfo?: Record<string, any>;
  requestsMade: string[];
  authMetadataRequested: boolean;
  authFlowCompleted?: boolean;
  authResourceParameter?: string;
  tokenResourceParameter?: string;
  errors: string[];
  httpTrace: HttpTrace[];
  conformanceChecks: ConformanceCheck[];
}

export interface ValidationServerConfig {
  port?: number;
  authRequired?: boolean;
  metadataLocation?: string;  // Location for protected resource metadata
  authServerMetadataLocation?: string;  // Location for auth server metadata (passed to mock auth server)
  includeWwwAuthenticate?: boolean;  // Whether to include resource_metadata in WWW-Authenticate header
}
