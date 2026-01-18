/**
 * Testing Profiles for Sampling/Elicitation Response Strategies
 */

export type SamplingProviderType = 'manual' | 'mock';

export interface ModelOverride {
  pattern: string; // e.g., "claude-*", "gpt-*"
  response: string;
}

export interface TestingProfile {
  id: string;
  name: string;
  description?: string;
  samplingProvider: SamplingProviderType;
  autoRespond: boolean;
  defaultResponse?: string;
  defaultModel?: string;
  defaultStopReason?: 'endTurn' | 'stopSequence' | 'maxTokens' | 'toolUse';
  modelOverrides?: ModelOverride[];
  elicitationAutoRespond?: boolean;
  elicitationDefaults?: Record<string, unknown>;
}

/**
 * Helper to get response for a model hint based on profile overrides
 */
export function getResponseForModelHint(
  profile: TestingProfile,
  modelHints?: string[]
): string {
  if (!profile.modelOverrides || !modelHints || modelHints.length === 0) {
    return profile.defaultResponse || '';
  }

  // Check each hint against patterns
  for (const hint of modelHints) {
    for (const override of profile.modelOverrides) {
      const pattern = override.pattern.replace('*', '.*');
      if (new RegExp(`^${pattern}$`).test(hint)) {
        return override.response;
      }
    }
  }

  return profile.defaultResponse || '';
}
