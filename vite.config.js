import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'login.html'),
        register: resolve(__dirname, 'register.html'),
        forgotPassword: resolve(__dirname, 'forgot-password.html'),
        events: resolve(__dirname, 'events.html'),
        eventDetail: resolve(__dirname, 'event-detail.html'),
        myTickets: resolve(__dirname, 'my-tickets.html'),
        checkoutSuccess: resolve(__dirname, 'checkout-success.html'),
        scanner: resolve(__dirname, 'scanner.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
        terms: resolve(__dirname, 'terms.html'),
        privacy: resolve(__dirname, 'privacy.html'),
        venueDesigner: resolve(__dirname, 'venue-designer.html'),
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});
