import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // compose.dev.yaml では API が別コンテナになるので、転送先を API_URL で変えられるようにする
    proxy: { "/api": process.env.API_URL ?? "http://localhost:8080" },
  },
});
