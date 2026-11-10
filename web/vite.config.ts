import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// compose.dev.yaml では Firebase Auth のエミュレータを使う。画面と同じオリジンから転送するので、
// Tailscale など別の端末から開いても、エミュレータのポートを開けずにログインできる
const authEmulator = process.env.AUTH_EMULATOR_URL;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // compose.dev.yaml では API が別コンテナになるので、転送先を API_URL で変えられるようにする
      "/api": process.env.API_URL ?? "http://localhost:8080",
      ...(authEmulator
        ? {
            "/identitytoolkit.googleapis.com": authEmulator,
            "/securetoken.googleapis.com": authEmulator,
            "/emulator": authEmulator,
          }
        : {}),
    },
  },
});
