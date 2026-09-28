/** Jest para los specs TypeScript. Los *.test.ts existentes siguen con node:test. */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.spec.ts"],
};
