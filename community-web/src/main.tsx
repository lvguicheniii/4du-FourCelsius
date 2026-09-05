import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { RealtimeProvider, SessionProvider } from "./session";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SessionProvider>
      <RealtimeProvider>
        <App />
      </RealtimeProvider>
    </SessionProvider>
  </StrictMode>,
);
