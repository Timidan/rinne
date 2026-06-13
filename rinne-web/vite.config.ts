import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Dev: `pnpm --filter rinne run serve` provides the API on 4517; vite proxies
// /api there. Prod: `rinne serve` serves dist/ itself, same origin.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4517",
    },
  },
});
