import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ImportProvider } from "./context/ImportContext";
import { WebSocketProvider } from "./context/WebSocketContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <WebSocketProvider>
          <ImportProvider>
            <TooltipProvider>
              <App />
            </TooltipProvider>
          </ImportProvider>
        </WebSocketProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
