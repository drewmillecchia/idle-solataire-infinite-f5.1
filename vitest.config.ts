import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      $engine: fileURLToPath(new URL('./src/engine', import.meta.url)),
      $rules: fileURLToPath(new URL('./src/rules', import.meta.url)),
      $content: fileURLToPath(new URL('./src/content', import.meta.url))
    }
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' }
});
