import type { ToolCallRules } from "./types.js";

export function validateToolCalls(
  rules: ToolCallRules | undefined,
  toolCallNames: string[]
): string[] {
  if (!rules) return [];
  
  const errors: string[] = [];
  const required = rules.required; // undefined means no requirements
  const prohibited = rules.prohibited; // undefined means no prohibitions
  const allowed = rules.allowed; // undefined means any tools allowed
  
  // Get unique tool names to avoid duplicate error messages
  const uniqueToolNames = [...new Set(toolCallNames)];
  
  // Single pass through unique tool calls
  for (const tool of uniqueToolNames) {
    // Check if tool is prohibited
    if (prohibited && prohibited.includes(tool)) {
      errors.push(`Prohibited tool '${tool}' was called`);
    } 
    // Check if tool is allowed (only if allowed array is explicitly provided)
    else if (allowed !== undefined && (!required?.includes(tool)) && !allowed.includes(tool)) {
      errors.push(`Unexpected tool '${tool}' was called (not in required or allowed list)`);
    }
  }
  
  // Check for missing required tools (only if required array is provided)
  if (required) {
    for (const tool of required) {
      if (!toolCallNames.includes(tool)) {
        errors.unshift(`Required tool '${tool}' was not called`);
      }
    }
  }
  
  return errors;
}

