#!/usr/bin/env node
import { OAuthStateMachine, oauthTransitions } from "../client/src/lib/oauth-state-machine.js";
import { EMPTY_DEBUGGER_STATE, AuthDebuggerState, OAuthStep } from "../client/src/lib/auth-types.js";
import { DebugInspectorOAuthClientProvider, StorageInterface } from "../client/src/lib/auth.js";
import http from "node:http";
import https from "node:https";
import readline from "node:readline";

// Configuration for logging
type LogLevel = 'info' | 'success' | 'error' | 'debug';
interface LogOptions {
  verbose: boolean;
  redactSensitiveData: boolean;
}

// Default options
const DEFAULT_LOG_OPTIONS: LogOptions = {
  verbose: false,
  redactSensitiveData: true,
};

/**
 * Helper function to redact sensitive information in logs
 *
 * @param data The data object or string to redact sensitive info from
 * @param redact Whether to redact sensitive information
 * @returns Redacted data object or string
 */
function redactSensitiveData(data: any, redact: boolean = true): any {
  if (!redact || !data) return data;

  // For strings that look like tokens
  if (typeof data === 'string') {
    if (data.length > 8 && data.includes('-')) {
      return data.substring(0, 4) + '...' + data.substring(data.length - 4);
    }
    return data;
  }

  // For objects containing sensitive keys
  if (typeof data === 'object' && data !== null) {
    const sensitiveKeys = [
      'access_token', 'refresh_token', 'id_token', 'token',
      'client_secret', 'code', 'authorization_code'
    ];

    const result = Array.isArray(data) ? [...data] : { ...data };

    for (const key in result) {
      if (sensitiveKeys.includes(key)) {
        if (typeof result[key] === 'string' && result[key].length > 0) {
          result[key] = result[key].substring(0, 4) + '...' + result[key].substring(result[key].length - 4);
        }
      } else if (typeof result[key] === 'object' && result[key] !== null) {
        result[key] = redactSensitiveData(result[key], redact);
      }
    }

    return result;
  }

  return data;
}

// Simple in-memory storage implementation for CLI usage
class MemoryStorage implements StorageInterface {
  private storage: Map<string, string>;

  constructor() {
    this.storage = new Map();
  }

  getItem(key: string): string | null {
    return this.storage.get(key) || null;
  }

  setItem(key: string, value: string): void {
    this.storage.set(key, value);
  }

  removeItem(key: string): void {
    this.storage.delete(key);
  }
}

class CLIAuthFlowTester {
  serverUrl: string;
  state: AuthDebuggerState;
  storage: MemoryStorage;
  stateMachine: OAuthStateMachine;
  autoRedirect: boolean;
  logOptions: LogOptions;
  stepsCompleted: string[] = [];

  constructor(serverUrl: string, options: { autoRedirect?: boolean; verbose?: boolean; noRedact?: boolean } = {}) {
    this.serverUrl = serverUrl;
    this.state = { ...EMPTY_DEBUGGER_STATE };
    this.storage = new MemoryStorage();
    this.stateMachine = new OAuthStateMachine(serverUrl, this.updateState.bind(this));
    this.autoRedirect = options.autoRedirect || false;
    this.logOptions = {
      verbose: options.verbose || DEFAULT_LOG_OPTIONS.verbose,
      redactSensitiveData: !options.noRedact,
    };
  }

  updateState(updates: Partial<AuthDebuggerState>) {
    this.state = { ...this.state, ...updates };
  }

  log(level: LogLevel, step: string, message: string, data: any = null) {
    // Only show debug logs in verbose mode
    if (level === 'debug' && !this.logOptions.verbose) return;

    const timestamp = this.logOptions.verbose ? `[${new Date().toISOString()}] ` : '';
    const processedData = data ? redactSensitiveData(data, this.logOptions.redactSensitiveData) : null;

    switch (level) {
      case 'info':
        console.log(`${timestamp}${step}: ${message}`);
        break;
      case 'success':
        const icon = step ? '✅ ' : '';
        console.log(`${timestamp}${icon}${step ? step + ': ' : ''}${message}`);
        break;
      case 'error':
        console.error(`${timestamp}❌ ${step}: ${message}`);
        break;
      case 'debug':
        console.log(`${timestamp}🔍 ${step}: ${message}`);
        break;
    }

    if (processedData && (this.logOptions.verbose || level === 'error')) {
      console.log(`  └─ ${level === 'error' ? 'Error' : 'Data'}:`,
        typeof processedData === 'string'
          ? processedData
          : JSON.stringify(processedData, null, 2)
      );
    }
  }

  debug(step: string, message: string, data: any = null) {
    this.log('debug', step, message, data);
  }

  info(step: string, message: string, data: any = null) {
    this.log('info', step, message, data);
  }

  error(step: string, message: string, error: Error | null = null) {
    this.log('error', step, message, error);
  }

  success(step: string, message: string, data: any = null) {
    this.log('success', step, message, data);
    this.stepsCompleted.push(step);
  }

  async executeStep(stepName: OAuthStep) {
    this.log(stepName.toUpperCase().replace('_', ' '), `Executing ${stepName}...`);

    try {
      // Override the provider creation for CLI usage
      const originalExecuteStep = this.stateMachine.executeStep;
      this.stateMachine.executeStep = async (state: AuthDebuggerState) => {
        // Create a provider with our memory storage
        const provider = new DebugInspectorOAuthClientProvider(this.serverUrl, this.storage);

        // Override redirectToAuthorization for CLI usage
        provider.redirectToAuthorization = (url: URL) => {
          console.log(`\nPlease open this authorization URL in your browser:`);
          console.log(`\n${url}\n`);
        };

        const context = {
          state,
          serverUrl: this.serverUrl,
          provider,
          updateState: this.updateState.bind(this),
        };

        const transition = oauthTransitions[state.oauthStep];

        if (!(await transition.canTransition(context))) {
          throw new Error(`Cannot transition from ${state.oauthStep}`);
        }

        await transition.execute(context);
      };

      await this.stateMachine.executeStep(this.state);

      // Restore original method
      this.stateMachine.executeStep = originalExecuteStep;

      // Log step-specific success information
      switch (stepName) {
        case 'metadata_discovery':
          if (this.state.resourceMetadata) {
            this.success('Resource Metadata', 'OAuth Resource Metadata', this.state.resourceMetadata);
          } else {
            this.error('Resource Metadata', 'Issue fetching resource metadata', this.state.resourceMetadataError);
          }

          this.success('METADATA DISCOVERY', `OAuth metadata discovered, from: ${this.state.authServerUrl}`, this.state.oauthMetadata);
          break;

        case 'client_registration':
          this.success('CLIENT REGISTRATION', 'Client registered successfully', this.state.oauthClientInfo);
          break;

        case 'authorization_redirect':
          this.success('AUTHORIZATION PREPARE', 'Authorization URL generated', {
            url: this.state.authorizationUrl,
          });
          break;

        case 'authorization_code':
          this.success('AUTHORIZATION CODE', 'Authorization code validated');
          break;

        case 'token_request':
          this.success('TOKEN EXCHANGE', 'Tokens obtained successfully', this.state.oauthTokens);
          break;

        case 'validate_token':
          this.success('TOKEN VALIDATION', 'Token validated successfully', {
            message: this.state.statusMessage?.message || 'Access token is valid',
          });
          break;
      }

      return true;
    } catch (error) {
      this.error(stepName.toUpperCase().replace('_', ' '), `Failed to execute ${stepName}`, error);
      this.state.latestError = error;
      throw error;
    }
  }

  async promptForAuthCode(): Promise<string> {
    if (this.autoRedirect) {
      return this.fetchAuthCodeFromRedirect(this.state.authorizationUrl!);
    }

    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      rl.question('Enter the authorization code: ', (code: string) => {
        rl.close();
        resolve(code.trim());
      });
    });
  }

  async fetchAuthCodeFromRedirect(authUrl: string): Promise<string> {
    console.log(`🔄 AUTO-REDIRECT: Fetching authorization URL...`);

    try {
      const url = new URL(authUrl);

      return new Promise((resolve, reject) => {
        const protocol = url.protocol === 'https:' ? https : http;

        const req = protocol.get(authUrl, {
          headers: { 'User-Agent': 'MCP-Inspector/1.0' }
        }, (res) => {
          // Check if we got a redirect
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, authUrl);
            console.log(`🔄 Found redirect to: ${redirectUrl}`);

            // Check if the redirect URL has a code
            const code = redirectUrl.searchParams.get('code');
            if (code) {
              console.log(`✅ Successfully extracted authorization code from redirect`);
              resolve(code);
              return;
            }

            reject(new Error('No authorization code found in the redirect URL'));
          } else {
            reject(new Error(`Expected redirect, got status code ${res.statusCode}`));
          }
        });

        req.on('error', (error) => {
          reject(error);
        });

        req.end();
      });
    } catch (error) {
      console.error(`❌ Error fetching authorization URL: ${error.message}`);

      // Fallback to manual entry if auto-redirect fails
      console.log("\n⚠️ Auto-redirect failed. Please manually authorize and enter the code.");
      console.log(`Please open this URL in your browser: ${authUrl}\n`);

      return new Promise((resolve) => {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });

        rl.question('Enter the authorization code: ', (code: string) => {
          rl.close();
          resolve(code.trim());
        });
      });
    }
  }

  async runFullFlow(): Promise<boolean> {
    console.log(`\n🚀 Starting MCP Server Authorization Flow Test`);
    console.log(`📡 Server URL: ${this.serverUrl}`);
    if (this.autoRedirect) {
      console.log(`🤖 Auto-redirect mode: Enabled\n`);
    } else {
      console.log(`👤 Manual authorization mode\n`);
    }

    try {
      // Step 1: Metadata Discovery
      await this.executeStep('metadata_discovery');
      console.log("");

      // Step 2: Client Registration
      await this.executeStep('client_registration');
      console.log("");

      // Step 3: Authorization Redirect Preparation
      await this.executeStep('authorization_redirect');
      console.log("");

      // Step 4: Authorization step (automatic or manual)
      if (this.autoRedirect) {
        console.log("🔐 AUTO-AUTHORIZATION");
        console.log("Automatically following the authorization URL and extracting the code...\n");
      } else {
        console.log("🔐 MANUAL AUTHORIZATION REQUIRED");
        console.log("Please open the following URL in your browser:");
        console.log(`\n${this.state.authorizationUrl}\n`);
        console.log("After authorizing, you will be redirected to a callback URL.");
        console.log("Copy the authorization code from the callback URL parameters.\n");
      }

      const authCode = await this.promptForAuthCode();
      this.state.authorizationCode = authCode;
      console.log("");

      // Step 5: Validate Authorization Code
      await this.executeStep('authorization_code');
      console.log("");

      // Step 6: Exchange Code for Tokens
      await this.executeStep('token_request');
      console.log("");

      // Step 7: Validate the token by calling tools/list
      await this.executeStep('validate_token');
      console.log("");

      // Final summary
      console.log("🎉 AUTHORIZATION FLOW COMPLETED SUCCESSFULLY!");
      console.log("✅ All steps completed without errors");
      console.log("🔑 Access token obtained and ready for use");

      return true;
    } catch (error) {
      console.log("\n❌ AUTHORIZATION FLOW FAILED!");
      console.error("💥 Error:", error.message);

      if (this.state.validationError) {
        console.error("🔍 Validation Error:", this.state.validationError);
      }

      return false;
    }
  }
}

// Main execution
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.error("Usage: npx tsx test-auth-flow.ts <server-url> [OPTIONS]");
    console.error("Example: npx tsx test-auth-flow.ts https://example.com/mcp");
    console.error("\nOptions:");
    console.error("  --auto-redirect     Enable automatic redirect handling without user interaction");
    console.error("  --verbose           Enable verbose output with timestamps and detailed data");
    console.error("  --no-redact         Show tokens and sensitive data in full (not recommended)");
    console.error("  --help, -h          Show this help message");
    process.exit(args[0] === "--help" || args[0] === "-h" ? 0 : 1);
  }

  // Extract the server URL (the first non-flag argument)
  let serverUrl = "";
  for (const arg of args) {
    if (!arg.startsWith("--") && !arg.startsWith("-")) {
      serverUrl = arg;
      break;
    }
  }
  
  if (!serverUrl) {
    console.error("❌ Server URL is required");
    console.error("Usage: npx tsx test-auth-flow.ts <server-url> [OPTIONS]");
    process.exit(1);
  }

  // Parse flags
  const autoRedirect = args.includes('--auto-redirect');
  const verbose = args.includes('--verbose');
  const noRedact = args.includes('--no-redact');

  // Validate URL
  try {
    new URL(serverUrl);
  } catch (error) {
    console.error("❌ Invalid server URL:", serverUrl);
    process.exit(1);
  }

  const tester = new CLIAuthFlowTester(serverUrl, {
    autoRedirect,
    verbose,
    noRedact
  });
  
  const success = await tester.runFullFlow();

  process.exit(success ? 0 : 1);
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Direct execution check for ESM
// When run with tsx, just call main directly
main();
