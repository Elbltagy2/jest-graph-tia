/** Dogfood config: tests for core + cli live in packages/x/test, run via ts-jest ESM. */
export default {
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true, tsconfig: "tsconfig.test.json" }],
  },
  testMatch: ["<rootDir>/packages/*/test/**/*.test.ts"],
  // fixture repo has its own jest tests — never pick them up from the root runner
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/fixtures/"],
};
