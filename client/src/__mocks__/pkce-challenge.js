// Mock implementation of pkce-challenge for tests
module.exports = {
  default: () => ({
    code_challenge: "mock-code-challenge",
    code_verifier: "mock-code-verifier",
  }),
};
