import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['**/*.test.ts'],
          exclude: ['node_modules/**', '.next/**', '**/*.db.test.ts'],
        },
      },
      {
        // One file at a time: they share the test database
        extends: true,
        test: {
          name: 'db',
          include: ['**/*.db.test.ts'],
          exclude: ['node_modules/**', '.next/**'],
          globalSetup: ['test/dbGlobalSetup.ts'],
          setupFiles: ['test/dbSetup.ts'],
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
