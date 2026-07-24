import { spawn, ChildProcess } from 'child_process';
import { ValidationServer } from '../server/validation/index.js';
import { ValidationServerConfig, ComplianceReport, TestResult, HttpTrace } from '../types.js';
import { displayTraces } from '../middleware/http-trace.js';

export interface TestScenario {
  name: string;
  description?: string;
  serverConfig: ValidationServerConfig;
  expectedResult: 'PASS' | 'FAIL';
  validateBehavior?: (behavior: any) => string[];  // Returns array of error messages
  timeout?: number;
}

export interface TestSuite {
  name: string;
  description?: string;
  scenarios: TestScenario[];
}

export class ComplianceTestRunner {
  private verbose: boolean;
  private json: boolean;
  private clientCommand: string;

  constructor(clientCommand: string, options: { verbose?: boolean; json?: boolean } = {}) {
    this.clientCommand = clientCommand;
    this.verbose = options.verbose || false;
    this.json = options.json || false;
  }

  private log(...args: any[]): void {
    if (!this.json) {
      console.log(...args);
    }
  }

  private logVerbose(...args: any[]): void {
    if (this.verbose && !this.json) {
      console.log(...args);
    }
  }

  async runScenario(scenario: TestScenario): Promise<{ passed: boolean; report?: ComplianceReport; error?: string }> {
    const server = new ValidationServer(scenario.serverConfig, this.verbose);
    const timeout = scenario.timeout || 30000;

    try {
      const serverPort = await server.start();
      const serverUrl = `http://localhost:${serverPort}/mcp`;

      this.logVerbose(`  Server started at: ${serverUrl}`);
      if (scenario.serverConfig.metadataLocation) {
        this.logVerbose(`  Metadata URL: http://localhost:${serverPort}${scenario.serverConfig.metadataLocation}`);
      }

      // Parse and run the client command
      const commandParts = this.clientCommand.split(' ');
      const executable = commandParts[0];
      const args = [...commandParts.slice(1), serverUrl];

      // Capture client output
      let clientStdout = '';
      let clientStderr = '';

      const clientProcess = spawn(executable, args, {
        stdio: 'pipe',
        shell: true,
        timeout
      });

      clientProcess.stdout?.on('data', (data) => {
        clientStdout += data.toString();
      });
      clientProcess.stderr?.on('data', (data) => {
        clientStderr += data.toString();
      });

      // Wait for client to finish
      const clientExitCode = await new Promise<number>((resolve, reject) => {
        let timedOut = false;

        const timeoutHandle = setTimeout(() => {
          timedOut = true;
          clientProcess.kill();
          reject(new Error(`Timeout (${timeout}ms)`));
        }, timeout);

        clientProcess.on('exit', (code) => {
          console.log(`EXIT CODE: ${code}`);
          clearTimeout(timeoutHandle);
          if (!timedOut) {
            resolve(code || 0);
          }
        });

        clientProcess.on('error', (error) => {
          clearTimeout(timeoutHandle);
          reject(error);
        });
      });

      // Get validation results
      const results = server.getValidationResults();
      const behavior = server.getClientBehavior();
      const authServerTrace = scenario.serverConfig.authRequired && server.authServer
        ? server.authServer.getHttpTrace()
        : [];

      // Validate behavior if custom validator provided
      let behaviorErrors: string[] = [];
      if (scenario.validateBehavior) {
        behaviorErrors = scenario.validateBehavior(behavior);
      }

      // Generate report
      console.log(`EXIT CODE: ${clientExitCode}`);

      const report: ComplianceReport = {
        overall_result: results.every(r => r.result === 'PASS') &&
                       clientExitCode === 0 &&
                       behaviorErrors.length === 0 ? 'PASS' : 'FAIL',
        test_suite: scenario.name,
        timestamp: new Date().toISOString(),
        client_command: this.clientCommand,
        tests_passed: results.filter(r => r.result === 'PASS').length,
        tests_failed: results.filter(r => r.result === 'FAIL').length + behaviorErrors.length,
        tests: [
          ...results,
          ...behaviorErrors.map(error => ({
            name: 'behavior_validation',
            result: 'FAIL' as const,
            details: {},
            errors: [error]
          }))
        ]
      };

      await server.stop();

      const passed = report.overall_result === scenario.expectedResult;

      if (this.verbose && !this.json) {
        this.printDetailedReport(report, behavior, authServerTrace, {
          stdout: clientStdout,
          stderr: clientStderr
        });
      }

      return { passed, report };

    } catch (error: any) {
      await server.stop().catch(() => {});
      return {
        passed: false,
        error: error.message || error
      };
    }
  }

  async runSuite(suite: TestSuite): Promise<boolean> {
    this.log(`\nRunning test suite: ${suite.name}`);
    if (suite.description) {
      this.log(`Description: ${suite.description}`);
    }
    this.log('='.repeat(60));

    const results: Array<{ scenario: TestScenario; passed: boolean; error?: string }> = [];

    for (const scenario of suite.scenarios) {
      this.log(`\n▶ ${scenario.name}`);
      if (scenario.description) {
        this.logVerbose(`  ${scenario.description}`);
      }

      const result = await this.runScenario(scenario);
      results.push({ scenario, passed: result.passed, error: result.error });

      if (result.passed) {
        this.log(`  ✅ PASS`);
      } else {
        this.log(`  ❌ FAIL${result.error ? `: ${result.error}` : ''}`);
      }
    }

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    this.log('\n' + '='.repeat(60));
    this.log(`Suite Summary: ${suite.name}`);
    this.log(`  Passed: ${passed}/${results.length}`);

    return failed === 0;
  }

  async runSuites(suites: TestSuite[]): Promise<void> {
    const allResults: boolean[] = [];

    for (const suite of suites) {
      const passed = await this.runSuite(suite);
      allResults.push(passed);
    }

    const totalSuitesPassed = allResults.filter(r => r).length;
    const totalSuitesFailed = allResults.filter(r => !r).length;

    this.log('\n' + '='.repeat(60));
    this.log('OVERALL SUMMARY');
    this.log('='.repeat(60));
    this.log(`Total Suites Passed: ${totalSuitesPassed}/${allResults.length}`);

    if (totalSuitesFailed === 0) {
      this.log('\n✅ All test suites passed!');
      process.exit(0);
    } else {
      this.log('\n❌ Some test suites failed');
      process.exit(1);
    }
  }

  private printDetailedReport(
    report: ComplianceReport,
    behavior: any,
    authServerTrace: HttpTrace[],
    clientOutput: { stdout: string; stderr: string }
  ): void {
    // This is similar to the CLI's printCompactReport but can be customized
    const passed = report.overall_result === 'PASS';
    const icon = passed ? '✅' : '❌';

    this.log(`  ${icon} Result: ${report.overall_result}`);

    if (!passed) {
      report.tests.forEach(test => {
        if (test.result === 'FAIL') {
          this.log(`     ❌ ${test.name}`);
          if (test.errors && test.errors.length > 0) {
            test.errors.forEach(error => {
              this.log(`        - ${error}`);
            });
          }
        }
      });
    }

    // Show traces and outputs in verbose mode
    if (this.verbose) {
      displayTraces(behavior.httpTrace || [], authServerTrace)

      if (clientOutput.stdout || clientOutput.stderr) {
        this.log('\n  [Client Output]');
        if (clientOutput.stdout) {
          this.log('  STDOUT:', clientOutput.stdout);
        }
        if (clientOutput.stderr) {
          this.log('  STDERR:', clientOutput.stderr);
        }
      }
    }
  }
}
