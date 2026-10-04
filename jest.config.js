/** Jest para los specs TypeScript. Los *.test.ts existentes siguen con node:test. */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.ts", "**/?(*.)+(spec|test).ts"],
  roots: ["<rootDir>/src", "<rootDir>/tests"],

};
