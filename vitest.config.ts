import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    // Run audio pipeline tests + store-level logic tests. The rest of the
    // app has UI interaction tests that need a full test rig which isn't
    // set up; when we add those, expand this glob.
    include: [
      'src/audio/**/*.test.ts',
      'src/audio/**/*.test.tsx',
      'src/store/**/*.test.ts',
    ],
  },
});
