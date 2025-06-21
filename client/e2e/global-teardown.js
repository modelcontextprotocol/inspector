import { rimraf } from "rimraf";

async function globalTeardown() {
  if (!process.env.CI) {
    console.log("Cleaning up test-results directory...");
    // Add a small delay to ensure all Playwright files are written
    await new Promise((resolve) => setTimeout(resolve, 100));
    await rimraf("./e2e/test-results");
    console.log("Test-results directory cleaned up.");
  }
}

export default globalTeardown;

// Call the function when this script is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  globalTeardown().catch(console.error);
}
