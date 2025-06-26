import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { ExpectedToolCalls } from "./types.js";

export function validateExpectedToolCalls(
  expected: ExpectedToolCalls | undefined,
  toolCallNames: string[]
): string[] {
  if (!expected) return [];
  
  return [
    ...validateRequired(expected.required, toolCallNames),
    ...validateProhibited(expected.prohibited, toolCallNames),
    ...validateAllowed(expected.allowed, expected.required, toolCallNames)
  ];
}


function validateRequired(required: string[] = [], executed: string[]): string[] {
  return required
    .filter(tool => !executed.includes(tool))
    .map(tool => `Required tool '${tool}' was not called`);
}

function validateProhibited(prohibited: string[] = [], executed: string[]): string[] {
  return prohibited
    .filter(tool => executed.includes(tool))
    .map(tool => `Prohibited tool '${tool}' was called`);
}

function validateAllowed(
  allowed: string[] = [], 
  required: string[] = [], 
  executed: string[]
): string[] {
  // If no allowed list specified, allow everything
  if (allowed.length === 0) return [];
  
  const allowedTools = new Set([...required, ...allowed]);
  
  return executed
    .filter(tool => !allowedTools.has(tool))
    .map(tool => `Unexpected tool '${tool}' was called (not in required or allowed list)`);
}