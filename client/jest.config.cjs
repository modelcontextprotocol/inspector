module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^../components/DynamicJsonForm$":
      "<rootDir>/src/utils/__mocks__/DynamicJsonForm.ts",
    "^../../components/DynamicJsonForm$":
      "<rootDir>/src/utils/__mocks__/DynamicJsonForm.ts",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
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
    "\\.config\\.(js|ts|cjs|mjs)$",
  ],
  // Exclude the same patterns from coverage reports
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    "/bin/",
    "\\.config\\.(js|ts|cjs|mjs)$",
  ],
};
