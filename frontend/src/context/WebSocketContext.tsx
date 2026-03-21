/**
 * Singleton WebSocket — event-bus pattern.
 *
 * - Opens one persistent connection on first use.
 * - Reconnects with exponential back-off on disconnect.
 * - Dispatches each message to specific event listeners keyed by msg.type,
 *   so consumers subscribe to only the events they care about.
 * - Sends a ping every 30 s to keep the connection alive.
 */
import { useEffect, useRef, useState } from "react";
import type { WSMessage } from "@/types";

type MsgOfType<T extends WSMessage["type"]> = Extract<WSMessage, { type: T }>;
type Handler<T extends WSMessage["type"]> = (msg: MsgOfType<T>) => void;

// ── Singleton event bus ────────────────────────────────────────────────────────

const bus = new EventTarget();

/** Subscribe to a specific WS message type. Returns an unsubscribe function. */
export function onWsEvent<T extends WSMessage["type"]>(
  type: T,
  handler: Handler<T>
): () => void {
  const listener = (e: Event) =>
    handler((e as CustomEvent<MsgOfType<T>>).detail);
  bus.addEventListener(type, listener);
  return () => bus.removeEventListener(type, listener);
}

// ── Singleton connection ───────────────────────────────────────────────────────

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let backoff = 1000;

function getWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  ws = new WebSocket(getWsUrl());

  ws.onopen = () => {
    backoff = 1000;
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
      }
    }, 30_000);
  };

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data as string) as WSMessage;
      bus.dispatchEvent(new CustomEvent(msg.type, { detail: msg }));
    } catch {
      // ignore unparseable frames
    }
  };

  ws.onclose = () => {
    if (pingTimer) clearInterval(pingTimer);
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    backoff = Math.min(backoff * 2, 30_000);
    connect();
  }, backoff);
}

// ── Hook — starts the singleton; call once near the app root ─────────────────

let started = false;

export function useWebSocket() {
  useEffect(() => {
    if (!started) {
      started = true;
      // Defer past the "page loading" phase to avoid a spurious connection
      // error on every hard refresh.
      setTimeout(connect, 0);
    }
  }, []);
}

// ── Connection status hook ────────────────────────────────────────────────────

export function useWsStatus(): "connected" | "connecting" | "disconnected" {
  const [status, setStatus] = useState<"connected" | "connecting" | "disconnected">("disconnected");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const check = () => {
      if (!ws) { setStatus("disconnected"); return; }
      if (ws.readyState === WebSocket.OPEN) setStatus("connected");
      else if (ws.readyState === WebSocket.CONNECTING) setStatus("connecting");
      else setStatus("disconnected");
    };
    check();
    intervalRef.current = setInterval(check, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  return status;
}
