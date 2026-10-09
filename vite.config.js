import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        dualIsp: resolve(__dirname, 'guides/dual-isp-residential-ip.html'),
        ipFraud: resolve(__dirname, 'guides/ip-fraud-check.html'),
        crossBorder: resolve(__dirname, 'guides/cross-border-ecommerce-setup.html'),
      },
    },
  },
});
