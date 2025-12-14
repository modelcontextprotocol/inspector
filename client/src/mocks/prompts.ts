export interface Prompt {
  name: string;
  description: string;
}

export const mockPrompts: Prompt[] = [
  { name: 'greeting_prompt', description: 'Generate a greeting' },
  { name: 'summarize', description: 'Summarize text' },
];
