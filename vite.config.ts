import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' keeps asset paths relative so the same build works on Cloudflare/GitHub
// Pages, inside a Capacitor Android wrapper, and as an installable desktop PWA.
export default defineConfig({
  plugins: [react()],
  base: './',
});
