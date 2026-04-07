import express, { Request, Response } from 'express';
import { Server } from 'http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';

import { ClientBehavior, TestResult, ValidationServerConfig } from '../../types.js';
import { MockAuthServer, MockTokenVerifier } from '../auth/index.js';
import { createHttpTraceMiddleware } from '../../middleware/http-trace.js';
import { z } from 'zod';

export class ValidationServer {
  private app: express.Application;
  private server: Server | null = null;
  private clientBehavior: ClientBehavior;
  private config: ValidationServerConfig;
  public authServer: MockAuthServer | null = null;
  private verbose: boolean = false;

  constructor(config: ValidationServerConfig = {}, verbose: boolean = false) {
    this.verbose = verbose;
    this.config = {
      port: config.port || 0, // 0 means random port
      authRequired: config.authRequired || false,
      metadataLocation: config.metadataLocation || '/.well-known/oauth-protected-resource',
      authServerMetadataLocation: config.authServerMetadataLocation || '/.well-known/oauth-authorization-server',
      includeWwwAuthenticate: config.includeWwwAuthenticate !== false  // Default true
    };

    // Start auth server if auth is required
    if (this.config.authRequired) {
      this.authServer = new MockAuthServer(0, this.verbose, this.config.authServerMetadataLocation);
    }

    this.app = express();
    this.app.use(express.json());

    // Initialize client behavior tracking
    this.clientBehavior = {
      connected: false,
      initialized: false,
      requestsMade: [],
      authMetadataRequested: false,
      errors: [],
      httpTrace: []
    };

    this.setupRoutes();
  }

  private log(...args: any[]): void {
    if (this.verbose) {
      console.log('[VALIDATION SERVER]', ...args);
    }
  }

  private createMCPServer(): McpServer {
    // Create a new MCP server instance for each request
    const mcpServer = new McpServer({
      name: 'validation-server',
      version: '1.0.0'
    }, {
      capabilities: {
        tools: {}
      }
    });

    // Register a test tool
    mcpServer.registerTool(
      'test-tool',
      {
        title: 'Test Tool',
        description: 'A simple test tool for validation',
        inputSchema: {
          message: z.string().describe('Test message')
        }
      },
      async ({ message }) => {
        return {
          content: [{
            type: 'text',
            text: `Test response: ${message}`
          }]
        };
      }
    );

    return mcpServer;
  }

  private setupRoutes(): void {
    // Capture all HTTP requests and responses
    this.app.use(createHttpTraceMiddleware(this.clientBehavior));

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok' });
    });

    // OAuth Protected Resource metadata endpoint (if auth is required)
    if (this.config.authRequired) {
      this.app.get(this.config.metadataLocation!, (req, res) => {
        this.clientBehavior.authMetadataRequested = true;

        // Get the actual port at request time
        const serverPort = this.getPort();
        const authServerUrl = this.authServer ? this.authServer.getUrl() : '';

        // Add issuer path if needed
        const issuerPath = this.authServer ? this.authServer.issuerPath : '';
        const fullAuthServerUrl = authServerUrl + issuerPath;

        // Serve OAuth Protected Resource Metadata (RFC 9728)
        res.json({
          resource: `http://localhost:${serverPort}`,
          authorization_servers: fullAuthServerUrl ? [fullAuthServerUrl] : []
        });
      });
    }

    // Create bearer auth middleware if auth is required
    let bearerMiddleware = async (req: Request, res: Response, next: any) => next();
    if (this.config.authRequired) {
      const tokenVerifier = new MockTokenVerifier();
      // We'll set the full URL dynamically in the middleware
      bearerMiddleware = async (req: Request, res: Response, next: any) => {
        const serverPort = this.getPort();
        const resourceMetadataUrl = this.config.includeWwwAuthenticate
          ? `http://localhost:${serverPort}${this.config.metadataLocation}`
          : undefined;
        const middleware = requireBearerAuth({
          verifier: tokenVerifier,
          requiredScopes: [],
          resourceMetadataUrl: resourceMetadataUrl
        });
        return middleware(req, res, next);
      };
    }

    // MCP POST endpoint - stateless mode
    this.app.post('/mcp', bearerMiddleware, async (req: Request, res: Response) => {
      // Track the incoming message
      if (req.body) {
        const message = req.body;
        if (message.method === 'initialize') {
          this.clientBehavior.connected = true;
          this.clientBehavior.initialized = true;
          this.clientBehavior.protocolVersion = message.params?.protocolVersion;
          this.clientBehavior.clientInfo = message.params?.clientInfo;
          this.clientBehavior.requestsMade.push('initialize');
        } else if (message.method === 'tools/list') {
          this.clientBehavior.requestsMade.push('tools/list');
        } else if (message.method === 'tools/call') {
          const toolName = message.params?.name;
          this.clientBehavior.requestsMade.push(`tools/call:${toolName}`);
        } else if (message.method) {
          this.clientBehavior.requestsMade.push(message.method);
        }
      }

      // In stateless mode, create a new instance of transport and server for each request
      // to ensure complete isolation
      try {
        const mcpServer = this.createMCPServer();

        // Configure transport based on auth requirements
        const transportConfig: any = {
          sessionIdGenerator: undefined, // No sessions in stateless mode
        };

        // If auth is required, set the protected resource metadata URL
        if (this.config.authRequired) {
          const serverPort = this.getPort();
          transportConfig.resourceMetadataUrl = `http://localhost:${serverPort}${this.config.metadataLocation}`;
        }

        const transport = new StreamableHTTPServerTransport(transportConfig);

        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);

        res.on('close', () => {
          transport.close();
          mcpServer.close();
        });
      } catch (error) {
        this.clientBehavior.errors.push(`Request error: ${error}`);
        this.log('Error handling MCP request:', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: null,
          });
        }
      }
    });

    // MCP GET endpoint - not supported in stateless mode
    this.app.get('/mcp', async (req: Request, res: Response) => {
      res.writeHead(405).end(JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed in stateless mode"
        },
        id: null
      }));
    });

    // MCP DELETE endpoint - not supported in stateless mode
    this.app.delete('/mcp', async (req: Request, res: Response) => {
      console.log('Received DELETE MCP request (not supported in stateless mode)');
      res.writeHead(405).end(JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed in stateless mode"
        },
        id: null
      }));
    });

    // Endpoint to retrieve client behavior for reporting
    this.app.get('/validation/report', (req, res) => {
      res.json(this.getValidationResults());
    });
  }

  async start(): Promise<number> {
    // Start auth server first if needed
    if (this.authServer) {
      await this.authServer.start();
      this.log(`Auth server started at ${this.authServer.getUrl()}`);
    }

    return new Promise((resolve) => {
      this.server = this.app.listen(this.config.port, () => {
        const port = this.getPort();
        this.log(`Started on port ${port} (stateless mode)`);
        resolve(port);
      });
    });
  }

  async stop(): Promise<void> {
    // Stop auth server if running
    if (this.authServer) {
      await this.authServer.stop();
    }

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.log('Stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getPort(): number {
    if (!this.server) {
      throw new Error('Server not started');
    }
    const address = this.server.address();
    if (typeof address === 'object' && address !== null) {
      return address.port;
    }
    throw new Error('Unable to get server port');
  }

  getValidationResults(): TestResult[] {
    const results: TestResult[] = [];

    // Test: MCP Initialization
    results.push({
      name: 'mcp_initialization',
      result: this.clientBehavior.initialized ? 'PASS' : 'FAIL',
      details: {
        connected: this.clientBehavior.connected,
        initialized: this.clientBehavior.initialized,
        protocol_version: this.clientBehavior.protocolVersion,
        client_info: this.clientBehavior.clientInfo
      },
      errors: this.clientBehavior.initialized ? undefined : ['Client did not complete initialization']
    });

    // Test: Auth metadata discovery (if auth required)
    if (this.config.authRequired) {
      results.push({
        name: 'auth_metadata_discovery',
        result: this.clientBehavior.authMetadataRequested ? 'PASS' : 'FAIL',
        details: {
          metadata_requested: this.clientBehavior.authMetadataRequested,
          metadata_location: this.config.metadataLocation
        },
        errors: this.clientBehavior.authMetadataRequested ? undefined : ['Client did not request auth metadata']
      });
    }

    // Test: Basic functionality
    const madeRequests = this.clientBehavior.requestsMade.length > 1; // More than just initialize
    results.push({
      name: 'basic_functionality',
      result: madeRequests ? 'PASS' : 'FAIL',
      details: {
        requests_made: this.clientBehavior.requestsMade
      },
      errors: madeRequests ? undefined : ['Client did not make any requests beyond initialization']
    });

    return results;
  }

  getClientBehavior(): ClientBehavior {
    // Add auth server tracking if available
    if (this.authServer) {
      this.clientBehavior.authResourceParameter = this.authServer.authResourceParameter || undefined;
      this.clientBehavior.tokenResourceParameter = this.authServer.tokenResourceParameter || undefined;
    }

    return this.clientBehavior;
  }
}
