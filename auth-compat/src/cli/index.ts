#!/usr/bin/env node

import { Command } from 'commander';
import { ComplianceTestRunner, TestSuite } from '../test-framework/index.js';
import { basicSuite, behaviorSuite, metadataLocationSuite, oauthSuite } from '../test-framework/suites.js';

const program = new Command();

program
  .name('mcp-auth-test')
  .description('MCP Authorization Compliance Test Runner')
  .version('1.0.0');

program
  .requiredOption('--command <command>', 'Command to run the client (should accept server URL as argument)')
  .option('--suite <name>', 'Run specific test suite (basic, oauth, metadata, behavior, all)', 'all')
  .option('--test <name>', 'Run specific test by name (partial match supported)')
  .option('--list', 'List all available tests', false)
  .option('--timeout <ms>', 'Timeout for client execution in milliseconds', '30000')
  .option('--json', 'Output results as JSON', false)
  .option('--verbose', 'Verbose output', false)
  .action(async (options) => {
    await runTests(options);
  });


async function runTests(options: any) {
  const allSuites = [basicSuite, oauthSuite, metadataLocationSuite, behaviorSuite];
  
  // List mode - show all available tests
  if (options.list) {
    console.log('Available test suites and scenarios:\n');
    allSuites.forEach(suite => {
      console.log(`Suite: ${suite.name}`);
      if (suite.description) {
        console.log(`  ${suite.description}`);
      }
      suite.scenarios.forEach((scenario, index) => {
        console.log(`  ${index + 1}. ${scenario.name}`);
        if (scenario.description) {
          console.log(`     ${scenario.description}`);
        }
      });
      console.log();
    });
    process.exit(0);
  }

  const verbose = options.verbose;
  const runner = new ComplianceTestRunner(options.command, { verbose, json: options.json });

  console.log('Running MCP compliance tests...');

  // If specific test is requested, filter to just that test
  if (options.test) {
    const testName = options.test.toLowerCase();
    let foundScenarios: TestSuite[] = [];
    
    allSuites.forEach(suite => {
      const matchingScenarios = suite.scenarios.filter(scenario => 
        scenario.name.toLowerCase().includes(testName)
      );
      
      if (matchingScenarios.length > 0) {
        foundScenarios.push({
          ...suite,
          scenarios: matchingScenarios
        });
      }
    });
    
    if (foundScenarios.length === 0) {
      console.error(`No test found matching: ${options.test}`);
      console.log('\nUse --list to see all available tests');
      process.exit(1);
    }
    
    console.log(`Found ${foundScenarios.reduce((acc, s) => acc + s.scenarios.length, 0)} test(s) matching "${options.test}"\n`);
    await runner.runSuites(foundScenarios);
    return;
  }

  // Select which suites to run
  let suitesToRun: TestSuite[] = [];

  const suiteMap: Record<string, TestSuite> = {
    'basic': basicSuite,
    'oauth': oauthSuite,
    'metadata': metadataLocationSuite,
    'behavior': behaviorSuite
  };

  if (options.suite === 'all') {
    suitesToRun = allSuites;
  } else if (suiteMap[options.suite]) {
    suitesToRun = [suiteMap[options.suite]];
  } else {
    console.error(`Unknown suite: ${options.suite}`);
    console.error(`Available suites: ${Object.keys(suiteMap).join(', ')}, all`);
    process.exit(1);
  }

  await runner.runSuites(suitesToRun);
}

program.parse();
