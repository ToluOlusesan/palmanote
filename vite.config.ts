import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths: the desktop build loads index.html over file://,
  // where a leading slash resolves to the drive root.
  base: './',
  plugins: [react()],
  server: { port: 5273 },
  build: { target: 'es2022' },
});
