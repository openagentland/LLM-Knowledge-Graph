import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    reporters: ["verbose"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/main.ts"],
    },
    projects: [
      {
        test: {
          name: "unit",
          pool: "forks",
          include: ["src/**/*.unit.test.ts"],
          testTimeout: 5000,
          hookTimeout: 5000,
        },
      },
      {
        test: {
          name: "integration",
          pool: "forks",
          include: ["tests/integration/**/*.integration.test.ts"],
          testTimeout: 120_000,
          hookTimeout: 120_000,
          sequence: {
            concurrent: false,
          },
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "e2e",
          pool: "forks",
          include: ["tests/e2e/**/*.e2e.test.ts"],
          testTimeout: 120_000,
          hookTimeout: 120_000,
          sequence: {
            concurrent: false,
          },
          fileParallelism: false,
        },
      },
    ],
  },
});
