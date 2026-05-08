import { spawn, ChildProcess } from 'child_process';
import { ValidationServer } from '../../server/validation/index.js';
import { ValidationServerConfig, ComplianceReport, TestResult, HttpTrace } from '../../types.js';
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
  report: ComplianceReport;
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

    // Get validation results
    const results = context.server.getValidationResults();
    const behavior = context.server.getClientBehavior();
    const authServerTrace = serverConfig.authRequired && context.server.authServer
      ? context.server.authServer.getHttpTrace()
      : [];

    // Generate compliance report
    const report: ComplianceReport = {
      overall_result: results.every(r => r.result === 'PASS') &&
                     clientOutput.exitCode === 0 ? 'PASS' : 'FAIL',
      test_suite: 'jest-test',
      timestamp: new Date().toISOString(),
      client_command: clientCommand,
      tests_passed: results.filter(r => r.result === 'PASS').length,
      tests_failed: results.filter(r => r.result === 'FAIL').length,
      tests: results
    };

    return {
      report,
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
  report: ComplianceReport,
  behavior: any,
  authServerTrace: HttpTrace[],
  clientOutput: ClientExecutionResult
): void {
  const output: string[] = [];

  output.push('\n=== Test Results ===');
  output.push(`Overall Result: ${report.overall_result}`);
  output.push(`Tests Passed: ${report.tests_passed}`);
  output.push(`Tests Failed: ${report.tests_failed}`);

  if (report.tests_failed > 0) {
    output.push('\nFailed Tests:');
    report.tests.forEach(test => {
      if (test.result === 'FAIL') {
        output.push(`  - ${test.name}`);
        test.errors?.forEach(error => {
          output.push(`    ${error}`);
        });
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

  // Print everything at once to avoid Jest's per-line issues
  console.log(output.join('\n'));
}
