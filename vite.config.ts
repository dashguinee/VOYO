import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'

// Read version from public/version.json — stamped into the build at compile
// time as `__APP_VERSION__`. The UpdateButton in App.tsx polls /version.json
// every 2 minutes and compares against this constant. When they diverge, the
// user gets an "Update available" prompt. Ported from Tivi+.
const versionData = JSON.parse(fs.readFileSync('public/version.json', 'utf8')) as { version: string };

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Mirrors tsconfig.app.json "paths": lets source use `@/foo` for
    // anything under ./src. Relative imports keep working — migrate
    // opportunistically, no big-bang codemod needed.
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(versionData.version),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Vendor splits
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) return 'vendor-react';
          if (id.includes('node_modules/zustand/')) return 'vendor-zustand';
          if (id.includes('node_modules/@supabase/')) return 'vendor-supabase';
          if (id.includes('node_modules/lucide-react/')) return 'vendor-icons';
          // App splits
          //
          // Brain + scouts are NO LONGER force-chunked here. The manualChunks
          // rule pulled them into a named "app-brain" chunk that Vite then
          // preloaded via <link rel="modulepreload"> on every page load —
          // ~110 KB of eager bandwidth for a subsystem that the playback hot
          // path doesn't actually use yet (Brain is initialised via
          // requestIdleCallback in App.tsx and only feeds DJ recommendations
          // that nothing currently reads). Letting Vite split them naturally
          // through the dynamic import boundary in App.tsx means they become
          // a true on-demand chunk loaded after first paint.
          if (id.includes('/services/') && !id.includes('audioEngine')) return 'app-services';
          if (id.includes('/knowledge/')) return 'app-knowledge';
          // Stores: let Vite handle naturally (manual chunking causes circular init crash)
        },
      },
    },
  },
})
