import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import { App } from "./app/App";
import { AuthProvider } from "./state/auth";
import { ActiveSaccoProvider } from "./state/activeSacco";

const qc = new QueryClient();

const base = import.meta.env.VITE_APP_BASE || "/";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <ActiveSaccoProvider>
          <BrowserRouter basename={base}>
            <App />
          </BrowserRouter>
        </ActiveSaccoProvider>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
