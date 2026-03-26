const fs = require("node:fs");
const path = require("node:path");

class FileReporter {
  constructor(globalConfig, options) {
    this._globalConfig = globalConfig;
    this._options = options || {};
  }

  onRunStart() {
    const filename = this._options.filename || "test-failures.log";
    const logPath = path.resolve(process.cwd(), filename);
    fs.writeFileSync(
      logPath,
      `TEST FAILURES LOG - ${new Date().toISOString()}\n${"=".repeat(50)}\n`,
    );
  }

  onTestResult(test, testResult) {
    const filename = this._options.filename || "test-failures.log";
    const logPath = path.resolve(process.cwd(), filename);

    if (testResult.numFailingTests > 0 || (testResult.console && testResult.console.length > 0)) {
      let output = `\nFILE: ${test.path}\n`;

      // Record console logs first
      if (testResult.console && testResult.console.length > 0) {
        output += `\n--- Console ---\n`;
        testResult.console.forEach(log => {
          output += `[${log.type}] ${log.message}\n`;
        });
      }

      // Record individual test failures from raw data
      testResult.testResults.forEach(result => {
        if (result.status === 'failed') {
          output += `\n--- FAIL: ${result.fullName} ---\n`;
          result.failureMessages.forEach(msg => {
            output += `${msg}\n`;
          });
        }
      });

      output += `${"=".repeat(50)}\n`;
      fs.appendFileSync(logPath, output);
    }
  }
}

module.exports = FileReporter;
