module.exports = {
  preset: "ts-jest",
  testEnvironment: "jest-fixed-jsdom",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "\\.css$": "<rootDir>/src/__mocks__/styleMock.js",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        jsx: "react-jsx",
        tsconfig: "tsconfig.jest.json",
      },
    ],
  },
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
