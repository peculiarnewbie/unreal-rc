import { Effect, Layer, ManagedRuntime } from "effect";
import { Transport, type TransportRequest, type TransportResponse } from "./transport.js";
import type { TransportError } from "./errors.js";
import { Hooks, HooksLive, HooksNoop, type HooksService } from "./hooks.js";
import { HttpTransportLive, type HttpTransportOptions } from "./http.js";
import { WebSocketTransportLive, type WebSocketTransportOptions } from "./ws.js";

export interface RuntimeConfig {
  transport?: "ws" | "http" | undefined;
  host?: string;
  port?: number;
  secure?: boolean;
  ws?: WebSocketTransportOptions;
  http?: HttpTransportOptions;
  onRequest?: HooksService["onRequest"] extends (ctx: infer C) => Effect.Effect<void>
    ? ((ctx: C) => void | Promise<void>) | undefined
    : never;
  onResponse?: Parameters<typeof HooksLive>[0]["onResponse"];
  onError?: Parameters<typeof HooksLive>[0]["onError"];
  redactPayload?: Parameters<typeof HooksLive>[0]["redactPayload"];
}

const DEFAULT_WS_PORT = 30020;
const DEFAULT_HTTP_PORT = 30010;

const makeTransportLayer = (config: RuntimeConfig): Layer.Layer<Transport> => {
  const transportType = config.transport ?? "ws";

  if (transportType === "http") {
    return HttpTransportLive({
      ...config.http,
      ...(config.host !== undefined ? { host: config.host } : {}),
      ...(config.port !== undefined
        ? { port: config.port }
        : { port: config.http?.port ?? DEFAULT_HTTP_PORT }),
      ...(config.secure !== undefined ? { secure: config.secure } : {})
    });
  }

  return WebSocketTransportLive({
    ...config.ws,
    ...(config.host !== undefined ? { host: config.host } : {}),
    ...(config.port !== undefined
      ? { port: config.port }
      : { port: config.ws?.port ?? DEFAULT_WS_PORT }),
    ...(config.secure !== undefined ? { secure: config.secure } : {})
  });
};

const makeHooksLayer = (config: RuntimeConfig): Layer.Layer<Hooks> => {
  if (config.onRequest || config.onResponse || config.onError || config.redactPayload) {
    return HooksLive({
      onRequest: config.onRequest,
      onResponse: config.onResponse,
      onError: config.onError,
      redactPayload: config.redactPayload
    });
  }
  return HooksNoop;
};

export type FullLayer = Transport | Hooks;

export const makeFullLayer = (config: RuntimeConfig): Layer.Layer<FullLayer> => {
  return Layer.merge(makeTransportLayer(config), makeHooksLayer(config));
};

export const makeRuntime = (config: RuntimeConfig): ManagedRuntime.ManagedRuntime<FullLayer, never> => {
  return ManagedRuntime.make(makeFullLayer(config));
};

export const sendRequest = (
  req: TransportRequest
): Effect.Effect<TransportResponse, TransportError, Transport> =>
  Transport.use((transport) => transport.request(req));
