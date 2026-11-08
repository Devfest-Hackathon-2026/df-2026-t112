import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AccessGate } from "./access";
import { App } from "./App";
import { AuthProvider } from "./auth";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AccessGate>
      <AuthProvider>
        <App />
      </AuthProvider>
    </AccessGate>
  </StrictMode>,
);
