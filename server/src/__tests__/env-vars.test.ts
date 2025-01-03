import { jest } from '@jest/globals';
import { parseArgs } from 'node:util';

describe('Environment Variables Handling', () => {
  // Save original process.argv
  const originalArgv = process.argv;

  beforeEach(() => {
    // Reset process.argv before each test
    process.argv = [...originalArgv];
  });

  afterEach(() => {
    // Restore original process.argv after each test
    process.argv = originalArgv;
    jest.resetModules();
  });

  it('should parse single environment variable with long flag', async () => {
    process.argv = ['node', 'index.js', '--envVars', 'API_KEY=test123'];
    
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        env: { type: "string", default: "" },
        args: { type: "string", default: "" },
        envVars: { 
          type: "string", 
          multiple: true, 
          default: [], 
          short: "e" 
        },
      },
    });

    expect(values.envVars).toContain('API_KEY=test123');
  });

  it('should parse single environment variable with short flag', async () => {
    process.argv = ['node', 'index.js', '-e', 'API_KEY=test123'];
    
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        env: { type: "string", default: "" },
        args: { type: "string", default: "" },
        envVars: { 
          type: "string", 
          multiple: true, 
          default: [], 
          short: "e" 
        },
      },
    });

    expect(values.envVars).toContain('API_KEY=test123');
  });

  it('should parse multiple environment variables', async () => {
    process.argv = [
      'node', 
      'index.js', 
      '--envVars', 'API_KEY=test123',
      '--envVars', 'DEBUG=true',
      '-e', 'NODE_ENV=development'
    ];
    
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        env: { type: "string", default: "" },
        args: { type: "string", default: "" },
        envVars: { 
          type: "string", 
          multiple: true, 
          default: [], 
          short: "e" 
        },
      },
    });

    expect(values.envVars).toContain('API_KEY=test123');
    expect(values.envVars).toContain('DEBUG=true');
    expect(values.envVars).toContain('NODE_ENV=development');
  });

  it('should handle empty environment variables list', async () => {
    process.argv = ['node', 'index.js'];
    
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        env: { type: "string", default: "" },
        args: { type: "string", default: "" },
        envVars: { 
          type: "string", 
          multiple: true, 
          default: [], 
          short: "e" 
        },
      },
    });

    expect(values.envVars).toEqual([]);
  });

  it('should parse environment variables into a merged object', async () => {
    process.argv = [
      'node', 
      'index.js', 
      '--envVars', 'API_KEY=test123',
      '-e', 'DEBUG=true'
    ];
    
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        env: { type: "string", default: "" },
        args: { type: "string", default: "" },
        envVars: { 
          type: "string", 
          multiple: true, 
          default: [], 
          short: "e" 
        },
      },
    });

    const envFromArgs = values.envVars.reduce((acc: Record<string, string>, curr: string) => {
      const [key, value] = curr.split('=');
      if (key && value) {
        acc[key] = value;
      }
      return acc;
    }, {});

    expect(envFromArgs).toEqual({
      API_KEY: 'test123',
      DEBUG: 'true'
    });
  });
});