import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Vendor splits
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) return 'vendor-react';
          if (id.includes('node_modules/framer-motion/')) return 'vendor-motion';
          if (id.includes('node_modules/zustand/')) return 'vendor-zustand';
          if (id.includes('node_modules/@supabase/')) return 'vendor-supabase';
          if (id.includes('node_modules/lottie-web/')) return 'vendor-lottie';
          if (id.includes('node_modules/lucide-react/')) return 'vendor-icons';
          // App splits: brain + scouts (heavy init code)
          if (id.includes('/brain/') || id.includes('/scouts/')) return 'app-brain';
          // Stores: let Vite handle naturally (manual chunking causes circular init crash)
        },
      },
    },
  },
})
