/**
 * Default testing profiles for sampling/elicitation
 */

import type { TestingProfile } from '@modelcontextprotocol/inspector-core';

// Default testing profiles
export const mockTestingProfiles: TestingProfile[] = [
  {
    id: 'manual',
    name: 'Manual',
    description: 'Manually respond to all sampling and elicitation requests',
    samplingProvider: 'manual',
    autoRespond: false,
    elicitationAutoRespond: false,
  },
  {
    id: 'auto-mock',
    name: 'Auto Mock',
    description: 'Automatically respond with generic mock responses',
    samplingProvider: 'mock',
    autoRespond: true,
    defaultResponse: 'This is an auto-generated mock response for testing purposes.',
    defaultModel: 'mock-model-1.0',
    defaultStopReason: 'endTurn',
    elicitationAutoRespond: true,
    elicitationDefaults: {
      confirmed: true,
    },
  },
  {
    id: 'claude-mock',
    name: 'Claude Mock',
    description: 'Mock responses styled like Claude',
    samplingProvider: 'mock',
    autoRespond: true,
    defaultResponse: "I'll analyze this request and provide a thoughtful response.",
    defaultModel: 'claude-3-sonnet-20241022',
    defaultStopReason: 'endTurn',
    modelOverrides: [
      {
        pattern: 'claude-*',
        response:
          "Based on my analysis, I can provide the following insights. Let me break this down step by step...",
      },
      {
        pattern: 'gpt-*',
        response:
          'As an AI assistant, I can help you with this task. Here is my analysis...',
      },
    ],
    elicitationAutoRespond: false,
  },
  {
    id: 'quick-approve',
    name: 'Quick Approve',
    description: 'Approve all requests immediately with minimal responses',
    samplingProvider: 'mock',
    autoRespond: true,
    defaultResponse: 'OK',
    defaultModel: 'mock-model-1.0',
    defaultStopReason: 'endTurn',
    elicitationAutoRespond: true,
    elicitationDefaults: {},
  },
];
