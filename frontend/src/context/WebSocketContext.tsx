import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import type { WSMessage } from "@/types";

type Handler = (msg: WSMessage) => void;

const WebSocketContext = createContext<{
  subscribe: (handler: Handler) => () => void;
} | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const handlersRef = useRef<Set<Handler>>(new Set());

  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let alive = true;

    const connect = () => {
      if (!alive) return;
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${protocol}://${window.location.host}/ws`);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WSMessage;
          handlersRef.current.forEach((h) => h(msg));
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (alive) reconnectTimer = setTimeout(connect, 3000);
      };
    };

    // Defer the initial connection by one task so we don't attempt the WS
    // upgrade during the browser's "page loading" phase, which causes a
    // spurious connection error on every hard refresh.
    reconnectTimer = setTimeout(connect, 0);
    return () => {
      alive = false;
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  const subscribe = useCallback((handler: Handler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  return (
    <WebSocketContext.Provider value={{ subscribe }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocketMessage(handler: Handler) {
  const ctx = useContext(WebSocketContext);
  const handlerRef = useRef(handler);
  useLayoutEffect(() => { handlerRef.current = handler; });

  useEffect(() => {
    if (!ctx) return;
    return ctx.subscribe((msg) => handlerRef.current(msg));
  }, [ctx]);
}
