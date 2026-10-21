import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

/** Dev server port for the Smurf desktop UI (see orchestrator/docs/SMURF.md). */
const DEV_PORT = 47823;

export default defineConfig(({ command }) => {
  const isDevServer = command === 'serve';
  return {
    // Dev (tauri dev + vite) must use absolute paths; production bundle needs relative assets.
    base: isDevServer ? '/' : './',
    plugins: [react(), tailwindcss()],
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
      },
    },
    // No dev proxy: the app talks to the configured smurf-server URL directly
    // (default http://127.0.0.1:47821; the server allows CORS).
    server: {
      port: DEV_PORT,
      strictPort: true,
      host: '127.0.0.1',
      hmr: process.env.DISABLE_HMR !== 'true',
      watch:
        process.env.DISABLE_HMR === 'true'
          ? null
          : {
              ignored: ['**/src-tauri/**'],
            },
    },
    preview: {
      port: DEV_PORT,
      strictPort: true,
      host: '127.0.0.1',
    },
  };
});
