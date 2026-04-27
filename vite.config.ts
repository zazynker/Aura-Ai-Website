import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // React 核心
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Supabase 单独拆分
          'vendor-supabase': ['@supabase/supabase-js'],
          // 图标库
          'vendor-icons': ['lucide-react'],
          // Sentry 单独拆分
          'vendor-sentry': ['@sentry/react'],
        },
      },
    },
    // 警告阈值提高到 500KB
    chunkSizeWarningLimit: 500,
  },
});