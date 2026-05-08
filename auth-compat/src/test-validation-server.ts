#!/usr/bin/env node

import { ValidationServer } from './server/validation/index.js';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testValidationServer() {
  console.log('🚀 Starting validation server test...\n');

  // Start validation server
  const server = new ValidationServer({
    authRequired: false // Start with no auth for basic testing
  });

  const port = await server.start();
  const serverUrl = `http://localhost:${port}/mcp`;
  
  console.log(`✅ Validation server started at: ${serverUrl}\n`);

  // Path to the example client
  const clientPath = path.join(__dirname, '..', 'examples', 'typescript-client', 'test-client.ts');
  
  console.log('🔧 Running test client...\n');

  // Run the test client
  const clientProcess = spawn('npx', ['tsx', clientPath, serverUrl], {
    cwd: path.join(__dirname, '..', 'examples', 'typescript-client'),
    stdio: 'inherit'
  });

  // Wait for client to finish
  const clientExitCode = await new Promise<number>((resolve) => {
    clientProcess.on('exit', (code) => {
      resolve(code || 0);
    });
  });

  console.log(`\n📊 Client exit code: ${clientExitCode}`);

  // Get validation results
  const results = server.getValidationResults();
  const behavior = server.getClientBehavior();

  console.log('\n📋 Validation Results:');
  console.log('====================');
  
  results.forEach(result => {
    const icon = result.result === 'PASS' ? '✅' : '❌';
    console.log(`\n${icon} ${result.name}: ${result.result}`);
    console.log('   Details:', JSON.stringify(result.details, null, 2));
    if (result.errors) {
      console.log('   Errors:', result.errors);
    }
  });

  console.log('\n🔍 Client Behavior:');
  console.log('==================');
  console.log(JSON.stringify(behavior, null, 2));

  // Calculate overall result
  const passed = results.filter(r => r.result === 'PASS').length;
  const failed = results.filter(r => r.result === 'FAIL').length;
  const overallResult = failed === 0 ? 'PASS' : 'FAIL';

  console.log('\n📊 Summary:');
  console.log('==========');
  console.log(`Tests Passed: ${passed}`);
  console.log(`Tests Failed: ${failed}`);
  console.log(`Overall Result: ${overallResult}`);
  console.log(`Client Exit Code: ${clientExitCode}`);

  // Stop server
  await server.stop();

  // Exit with appropriate code
  process.exit(overallResult === 'PASS' && clientExitCode === 0 ? 0 : 1);
}

testValidationServer().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});