module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  setupFilesAfterEnv: [
    '<rootDir>/src/setupTests.ts'
  ],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1"
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        jsx: "react-jsx",
        tsconfig: "tsconfig.jest.json"
      }
    ]
  },
  extensionsToTreatAsEsm: [".ts", ".tsx"],
  testRegex: "(/__tests__/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$",
  // Exclude directories and files that don't need to be tested
  testPathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    "/bin/",
    "\\.config\\.(js|ts|cjs|mjs)$"
  ],
  // Exclude the same patterns from coverage reports
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    "/bin/",
    "\\.config\\.(js|ts|cjs|mjs)$"
  ]
};
