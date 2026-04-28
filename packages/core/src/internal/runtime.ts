import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { Transport, type TransportRequest, type TransportResponse } from "./transport.js";
import type { TransportError } from "./errors.js";
import { HttpTransportLive, type HttpTransportOptions } from "./http.js";
import { WebSocketTransportLive, type DisconnectInfo, type WebSocketTransportOptions } from "./ws.js";
import { RuntimeConfigSchema } from "./config-schemas.js";

export interface RuntimeConfig {
  transport?: "ws" | "http" | undefined;
  host?: string;
  port?: number;
  secure?: boolean;
  passphrase?: string;
  ws?: WebSocketTransportOptions;
  http?: HttpTransportOptions;
  onDisconnect?: ((info: DisconnectInfo) => void) | undefined;
  onReconnect?: (() => void) | undefined;
}

const DEFAULT_WS_PORT = 30020;
const DEFAULT_HTTP_PORT = 30010;

const makeTransportLayer = (config: RuntimeConfig): Layer.Layer<Transport> => {
  const transportType = config.transport ?? "ws";

  if (transportType === "http") {
    return HttpTransportLive({
      ...config.http,
      ...(config.passphrase !== undefined ? { passphrase: config.passphrase } : {}),
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
    ...(config.secure !== undefined ? { secure: config.secure } : {}),
    ...(config.onDisconnect !== undefined && config.ws?.onDisconnect === undefined
      ? { onDisconnect: config.onDisconnect } : {}),
    ...(config.onReconnect !== undefined && config.ws?.onReconnect === undefined
      ? { onReconnect: config.onReconnect } : {})
  });
};

export type FullLayer = Transport;

export const makeFullLayer = (config: RuntimeConfig): Layer.Layer<FullLayer> => {
  return makeTransportLayer(config);
};

export const makeRuntime = (config: RuntimeConfig): ManagedRuntime.ManagedRuntime<FullLayer, never> => {
  Schema.decodeUnknownSync(RuntimeConfigSchema)(config, { onExcessProperty: "ignore" });
  return ManagedRuntime.make(makeFullLayer(config));
};

export const sendRequest = (
  req: TransportRequest
): Effect.Effect<TransportResponse, TransportError, Transport> =>
  Transport.use((transport) => transport.request(req));
