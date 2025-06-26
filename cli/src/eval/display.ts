import type { EvalResult, EvalSummary } from "./types.js";
import { formatMessagesForDisplay, getOriginalPrompt } from "./message-parser.js";

export function displayEvalResults(summary: EvalSummary): void {
  console.log(`Running ${summary.total} eval tests...\n`);

  for (const result of summary.results) {
    if (result.passed) {
      console.log(`✅ ${result.name}: PASSED`);
    } else {
      console.log(`❌ ${result.name}: FAILED`);
      displayFailedResultDetails(result);
    }
  }

  console.log(
    `\nResults: ${summary.passed}/${summary.total} tests passed`,
  );
}

function displayFailedResultDetails(result: EvalResult): void {
  // Extract prompt from messages
  if (result.messages) {
    const prompt = getOriginalPrompt(result.messages);
    console.log(`   Prompt: "${prompt}"`);
  }

  // Display errors
  if (result.errors.length > 0) {
    console.log(`   Errors:`);
    result.errors.forEach((error, index) => {
      console.log(`     • ${error}`);
      
      // Show LLM judge rationale if available
      const scorerResult = result.scorerResults[index];
      if (scorerResult?.judgeRationale) {
        console.log(`       Rationale: ${scorerResult.judgeRationale}`);
      }
    });
  }

  // Display conversation if we have message data
  if (result.messages) {
    console.log(`   Conversation:`);
    formatMessagesForDisplay(result.messages);
  }
}