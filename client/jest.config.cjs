module.exports = {
  preset: "ts-jest",
  testEnvironment: "jest-fixed-jsdom",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "\\.css$": "<rootDir>/src/__mocks__/styleMock.js",
    // Handle .js imports that should resolve to .ts files
    "^(\\.{1,2}/.*)\\.js$": "$1",
    // Mock pkce-challenge for tests
    "pkce-challenge": "<rootDir>/src/__mocks__/pkce-challenge.js",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        jsx: "react-jsx",
        tsconfig: "tsconfig.jest.json",
        useESM: true,
      },
    ],
  },
  transformIgnorePatterns: [
    "node_modules/(?!(@modelcontextprotocol/sdk|pkce-challenge)/)",
  ],
  extensionsToTreatAsEsm: [".ts", ".tsx"],
  testRegex: "(/__tests__/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$",
  // Exclude directories and files that don't need to be tested
  testPathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    "/bin/",
    "/e2e/",
    "\\.config\\.(js|ts|cjs|mjs)$",
  ],
  // Exclude the same patterns from coverage reports
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    "/bin/",
    "/e2e/",
    "\\.config\\.(js|ts|cjs|mjs)$",
  ],
  randomize: true,
};
