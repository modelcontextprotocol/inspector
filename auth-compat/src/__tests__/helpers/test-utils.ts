import { spawn, ChildProcess } from 'child_process';
import { ValidationServer } from '../../server/validation/index.js';
import { ValidationServerConfig, HttpTrace, ConformanceCheck } from '../../types.js';
import { formatTraces } from '../../middleware/http-trace.js';

export interface ClientExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface TestContext {
  server: ValidationServer;
  serverUrl: string;
  serverPort: number;
}

/**
 * Sets up a validation server for testing
 */
export async function setupTestServer(
  config: ValidationServerConfig = {},
  verbose: boolean = false
): Promise<TestContext> {
  const server = new ValidationServer(config, verbose);
  const serverPort = await server.start();
  const serverUrl = `http://localhost:${serverPort}/mcp`;

  return {
    server,
    serverUrl,
    serverPort
  };
}

/**
 * Tears down a test server
 */
export async function teardownTestServer(context: TestContext): Promise<void> {
  await context.server.stop();
}

/**
 * Executes a client command with the given server URL
 */
export async function executeClient(
  clientCommand: string,
  serverUrl: string,
  timeout: number = 30000
): Promise<ClientExecutionResult> {
  const commandParts = clientCommand.split(' ');
  const executable = commandParts[0];
  const args = [...commandParts.slice(1), serverUrl];

  let stdout = '';
  let stderr = '';
  let timedOut = false;

  const clientProcess = spawn(executable, args, {
    stdio: 'pipe',
    shell: true,
    timeout
  });

  clientProcess.stdout?.on('data', (data) => {
    stdout += data.toString();
  });

  clientProcess.stderr?.on('data', (data) => {
    stderr += data.toString();
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      clientProcess.kill();
      reject(new Error(`Client execution timed out after ${timeout}ms`));
    }, timeout);

    clientProcess.on('exit', (code) => {
      clearTimeout(timeoutHandle);
      if (!timedOut) {
        resolve(code || 0);
      }
    });

    clientProcess.on('error', (error) => {
      clearTimeout(timeoutHandle);
      reject(error);
    });
  }).catch((error) => {
    if (timedOut) {
      return -1; // Return special exit code for timeout
    }
    throw error;
  });

  return {
    exitCode,
    stdout,
    stderr,
    timedOut
  };
}

/**
 * Runs a complete compliance test scenario
 */
export async function runComplianceTest(
  clientCommand: string,
  serverConfig: ValidationServerConfig,
  options: {
    timeout?: number;
    verbose?: boolean;
  } = {}
): Promise<{
  checks: ConformanceCheck[];
  clientOutput: ClientExecutionResult;
  behavior: any;
  authServerTrace: HttpTrace[];
  serverPort: number;
}> {
  const { timeout = 30000, verbose = false } = options;
  const context = await setupTestServer(serverConfig, verbose);

  try {
    // Execute the client
    const clientOutput = await executeClient(clientCommand, context.serverUrl, timeout);

    // Get conformance checks
    const checks = context.server.getConformanceChecks();
    const behavior = context.server.getClientBehavior();
    const authServerTrace = serverConfig.authRequired && context.server.authServer
      ? context.server.authServer.getHttpTrace()
      : [];

    return {
      checks,
      clientOutput,
      behavior,
      authServerTrace,
      serverPort: context.serverPort
    };
  } finally {
    await teardownTestServer(context);
  }
}

/**
 * Helper to validate client behavior
 */
export function validateClientBehavior(
  behavior: any,
  expectations: {
    authMetadataRequested?: boolean;
    initialized?: boolean;
    connected?: boolean;
  }
): string[] {
  const errors: string[] = [];

  if (expectations.authMetadataRequested !== undefined &&
      behavior.authMetadataRequested !== expectations.authMetadataRequested) {
    errors.push(`Expected authMetadataRequested to be ${expectations.authMetadataRequested}, but was ${behavior.authMetadataRequested}`);
  }

  if (expectations.initialized !== undefined &&
      behavior.initialized !== expectations.initialized) {
    errors.push(`Expected initialized to be ${expectations.initialized}, but was ${behavior.initialized}`);
  }

  if (expectations.connected !== undefined &&
      behavior.connected !== expectations.connected) {
    errors.push(`Expected connected to be ${expectations.connected}, but was ${behavior.connected}`);
  }

  return errors;
}

/**
 * Helper to print verbose test output
 */
export function printVerboseOutput(
  checks: ConformanceCheck[],
  behavior: any,
  authServerTrace: HttpTrace[],
  clientOutput: ClientExecutionResult
): void {
  const output: string[] = [];

  output.push('\n=== Conformance Checks ===');
  const passed = checks.filter(c => c.status === 'SUCCESS').length;
  const failed = checks.filter(c => c.status === 'FAILURE').length;
  output.push(`Passed: ${passed}/${checks.length}`);
  output.push(`Failed: ${failed}/${checks.length}`);

  if (failed > 0) {
    output.push('\nFailed Checks:');
    checks.forEach(check => {
      if (check.status === 'FAILURE') {
        output.push(`  - ${check.name}: ${check.description}`);
        if (check.errorMessage) {
          output.push(`    Error: ${check.errorMessage}`);
        }
      }
    });
  }

  output.push('\n=== HTTP Traces ===');
  output.push(formatTraces(behavior.httpTrace || [], authServerTrace));

  if (clientOutput.stdout || clientOutput.stderr) {
    output.push('\n=== Client Output ===');
    if (clientOutput.stdout) {
      output.push(`STDOUT: ${clientOutput.stdout}`);
    }
    if (clientOutput.stderr) {
      output.push(`STDERR: ${clientOutput.stderr}`);
    }
  }

  console.log(output.join('\n'));
}
