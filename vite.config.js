import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Vite serves the camera workspace from the root. Deploy behind HTTPS in production.
export default defineConfig({
  plugins: [vue()],
  server: { host: '0.0.0.0' },
});
