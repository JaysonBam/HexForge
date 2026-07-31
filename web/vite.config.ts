import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          if (id.includes('@tiptap') || id.includes('prosemirror')) return 'editor';
          if (id.includes('@supabase')) return 'supabase';
          if (id.includes('pdf-lib') || id.includes('jszip')) return 'documents';
          if (id.includes('lucide-react')) return 'icons';

          return 'vendor';
        }
      }
    }
  }
})
