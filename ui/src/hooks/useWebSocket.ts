import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientMessage,
  ConnectionState,
  ServerMessage,
} from "@/types/ws";

interface UseWebSocketOptions {
  /** Called for every parsed server message. */
  onMessage: (msg: ServerMessage) => void;
  /**
   * Override the WS URL. Defaults to `${proto}//${host}/ws` so the Vite dev
   * proxy can forward it to the Node backend on :8080.
   */
  url?: string;
  /** Auto-reconnect on close. Defaults to false. */
  autoReconnect?: boolean;
  /** Per-user API key sent in the init message; falls back to server env on the backend. */
  getApiKey?: () => string | undefined;
  /** Per-user MongoDB URI sent in the init message; falls back to server env on the backend. */
  getMongoUri?: () => string | undefined;
  /** "english" | "international" — see useSettings.ts. */
  getLanguageMode?: () => "english" | "international";
}

export function useWebSocket({
  onMessage,
  url,
  autoReconnect = false,
  getApiKey,
  getMongoUri,
  getLanguageMode,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<ConnectionState>("disconnected");
  // Hold stable refs so re-renders don't tear down the socket.
  const onMessageRef = useRef(onMessage);
  const getApiKeyRef = useRef(getApiKey);
  const getMongoUriRef = useRef(getMongoUri);
  const getLanguageModeRef = useRef(getLanguageMode);
  useEffect(() => {
    onMessageRef.current = onMessage;
    getApiKeyRef.current = getApiKey;
    getMongoUriRef.current = getMongoUri;
    getLanguageModeRef.current = getLanguageMode;
  }, [onMessage, getApiKey, getMongoUri, getLanguageMode]);

  const wsUrl =
    url ??
    `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;

    setState("connecting");
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setState("connected");
      const apiKey = getApiKeyRef.current?.();
      const mongoUri = getMongoUriRef.current?.();
      const languageMode = getLanguageModeRef.current?.();
      ws.send(
        JSON.stringify({
          type: "init",
          apiKey,
          mongoUri,
          languageMode,
        } satisfies ClientMessage),
      );
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        onMessageRef.current(msg);
      } catch (err) {
        console.error("[ws] failed to parse server message:", err);
      }
    };

    ws.onerror = () => {
      setState("error");
    };

    ws.onclose = () => {
      wsRef.current = null;
      setState((prev) => (prev === "error" ? "error" : "disconnected"));
      if (autoReconnect) {
        setTimeout(() => connect(), 1500);
      }
    };
  }, [wsUrl, autoReconnect]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setState("disconnected");
  }, []);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  return { state, connect, disconnect, send };
}
