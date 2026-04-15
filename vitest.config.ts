import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    // Run only the audio pipeline tests — the rest of the app has UI
    // interaction tests that need a full test rig which isn't set up.
    include: ['src/audio/**/*.test.ts', 'src/audio/**/*.test.tsx'],
  },
});
