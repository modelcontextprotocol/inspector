// OAuth State
export interface OAuthState {
  authorizationUrl?: string;
  authorizationCode?: string;
  state?: string;
  stateVerified?: boolean;
  tokenEndpoint?: string;
  accessToken?: string;
  tokenType?: string;
  expiresIn?: number;
  expiresAt?: Date;
  refreshToken?: string;
  scopes?: string[];
  decodedToken?: {
    header: Record<string, unknown>;
    payload: Record<string, unknown>;
  };
}

export const mockOAuthState: OAuthState = {
  authorizationUrl: 'https://auth.example.com/authorize?client_id=my-client-id&redirect_uri=http://localhost:5173/callback&response_type=code&scope=read%20write&state=abc123xyz',
  authorizationCode: 'xyz789def456abc123',
  state: 'abc123xyz',
  stateVerified: true,
  tokenEndpoint: 'https://auth.example.com/token',
  accessToken: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMTIzIiwiYXVkIjoibXktY2xpZW50LWlkIiwic2NvcGUiOiJyZWFkIHdyaXRlIiwiZXhwIjoxNzM1MzAwMDAwLCJpYXQiOjE3MzUyOTY0MDB9.signature',
  tokenType: 'Bearer',
  expiresIn: 3600,
  expiresAt: new Date(Date.now() + 3600 * 1000),
  refreshToken: 'def456ghi789jkl012mno345',
  scopes: ['read', 'write'],
  decodedToken: {
    header: { alg: 'RS256', typ: 'JWT' },
    payload: {
      sub: 'user123',
      aud: 'my-client-id',
      scope: 'read write',
      exp: 1735300000,
      iat: 1735296400,
    },
  },
};

// Sampling types
export interface SamplingMessage {
  role: 'user' | 'assistant';
  content:
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string };
}

export interface ModelPreferences {
  hints?: string[];
  costPriority?: number;
  speedPriority?: number;
  intelligencePriority?: number;
}

export interface SamplingRequest {
  messages: SamplingMessage[];
  modelPreferences?: ModelPreferences;
  maxTokens: number;
  stopSequences?: string[];
  temperature?: number;
  includeContext?: 'none' | 'thisServer' | 'allServers';
}

export const mockSamplingRequest: SamplingRequest = {
  messages: [
    {
      role: 'user',
      content: {
        type: 'text',
        text: 'Analyze this data and provide insights about the trends. Focus on quarter-over-quarter growth and user engagement patterns.',
      },
    },
    {
      role: 'user',
      content: {
        type: 'image',
        data: 'base64-encoded-image-data',
        mimeType: 'image/png',
      },
    },
  ],
  modelPreferences: {
    hints: ['claude-3-sonnet', 'gpt-4'],
    costPriority: 0.2,
    speedPriority: 0.5,
    intelligencePriority: 0.8,
  },
  maxTokens: 1000,
  stopSequences: ['\\n\\n', 'END'],
  temperature: undefined,
  includeContext: 'thisServer',
};

// Elicitation types
export interface ElicitationFormField {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description?: string;
  required?: boolean;
  enum?: string[];
  default?: string | number | boolean;
}

export interface ElicitationFormRequest {
  mode: 'form';
  message: string;
  schema: {
    properties: Record<string, ElicitationFormField>;
    required?: string[];
  };
  serverName: string;
}

export interface ElicitationUrlRequest {
  mode: 'url';
  message: string;
  url: string;
  elicitationId: string;
  serverName: string;
}

export type ElicitationRequest = ElicitationFormRequest | ElicitationUrlRequest;

export const mockFormRequest: ElicitationFormRequest = {
  mode: 'form',
  message: 'Please provide your database connection details to proceed.',
  schema: {
    properties: {
      host: {
        name: 'host',
        type: 'string',
        description: 'Database hostname',
        required: true,
        default: 'localhost',
      },
      port: {
        name: 'port',
        type: 'number',
        description: 'Database port number',
        required: true,
        default: 5432,
      },
      database: {
        name: 'database',
        type: 'string',
        description: 'Database name',
      },
      sslMode: {
        name: 'sslMode',
        type: 'string',
        description: 'SSL connection mode',
        enum: ['disable', 'require', 'verify-ca', 'verify-full'],
        default: 'require',
      },
    },
    required: ['host', 'port'],
  },
  serverName: 'database-connector',
};

export const mockUrlRequest: ElicitationUrlRequest = {
  mode: 'url',
  message: 'Please complete the OAuth authorization in your browser.',
  url: 'https://auth.example.com/oauth/authorize?client_id=abc123&redirect_uri=http://localhost:3000/callback&state=xyz789&scope=read+write',
  elicitationId: 'elicit-abc123-def456',
  serverName: 'oauth-server',
};

// Roots types
export interface Root {
  name: string;
  uri: string;
}

export const initialRoots: Root[] = [
  { name: 'Project', uri: 'file:///home/user/myproject' },
  { name: 'Documents', uri: 'file:///home/user/Documents' },
  { name: 'Config', uri: 'file:///etc/myapp' },
];
