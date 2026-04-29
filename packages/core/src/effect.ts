import { Effect, Layer, ServiceMap } from "effect";
import {
  UnrealRC,
  type CallArgs,
  type CallReturnArgs,
  type DescribeArgs,
  type EventOptions,
  type GetPropertiesArgs,
  type GetPropertyArgs,
  type RequestArgs,
  type RequestOptionsBase,
  type RequestRawArgs,
  type SearchAssetsArgs,
  type SetPropertyArgs,
  type ThumbnailArgs,
  type BatchOptions,
  type PingOptions,
  type UnrealRCOptions
} from "./public/client.js";
import type {
  ObjectCallResponse,
  ObjectDescribeResponse,
  ObjectEventRequest,
  ObjectEventResponse,
  ObjectPropertyResponse,
  ObjectThumbnailResponse,
  PendingRequestInfo,
  PingResult,
  SearchAssetsResponse,
  InfoResponse
} from "./public/types.js";
import type { TransportResponse } from "./internal/transport.js";
import type { Transport } from "./internal/transport.js";
import type { TransportError } from "./internal/errors.js";
import type { BatchBuilder, BatchResult } from "./internal/batch.js";

// ── Tagged errors ─────────────────────────────────────────────────────

export {
  TimeoutError,
  ConnectError,
  DisconnectError,
  HttpStatusError,
  RemoteStatusError,
  DecodeError
} from "./internal/errors.js";
export type { TransportError } from "./internal/errors.js";

// ── Effect API interface ──────────────────────────────────────────────

export interface UnrealRCEffectApi {
  call(args: CallArgs): Effect.Effect<ObjectCallResponse, TransportError, Transport>;
  getProperty<T = unknown>(args: GetPropertyArgs): Effect.Effect<T | undefined, TransportError, Transport>;
  getProperties<T = Record<string, unknown>>(args: GetPropertiesArgs): Effect.Effect<T, TransportError, Transport>;
  setProperty(args: SetPropertyArgs): Effect.Effect<ObjectPropertyResponse, TransportError, Transport>;
  describe(args: DescribeArgs): Effect.Effect<ObjectDescribeResponse, TransportError, Transport>;
  searchAssets(args: SearchAssetsArgs): Effect.Effect<SearchAssetsResponse, TransportError, Transport>;
  info(options?: RequestOptionsBase): Effect.Effect<InfoResponse, TransportError, Transport>;
  event(request: ObjectEventRequest, options?: EventOptions): Effect.Effect<ObjectEventResponse, TransportError, Transport>;
  thumbnail(args: ThumbnailArgs): Effect.Effect<ObjectThumbnailResponse, TransportError, Transport>;
  batch(
    configure: (builder: BatchBuilder) => void,
    options?: BatchOptions
  ): Effect.Effect<BatchResult[], TransportError, Transport>;
  request<T = unknown>(args: RequestArgs<T>): Effect.Effect<T, TransportError, Transport>;
  requestRaw(args: RequestRawArgs): Effect.Effect<TransportResponse, TransportError, Transport>;
  callReturn<T>(args: CallReturnArgs<T>): Effect.Effect<T, TransportError, Transport>;
}

// ── Service tag ───────────────────────────────────────────────────────

/** @effect-expect-leaking Transport */
export class UnrealRCService extends ServiceMap.Service<
  UnrealRCService,
  UnrealRCEffectApi
>()("UnrealRCService") {}

// ── Live layer ────────────────────────────────────────────────────────

export const UnrealRCLive = (options: UnrealRCOptions = {}): Layer.Layer<UnrealRCService> =>
  Layer.effect(UnrealRCService,
    Effect.acquireRelease(
      Effect.sync(() => new UnrealRC(options)),
      (client) => Effect.promise(() => client.dispose().catch(() => {}))
    ).pipe(
      Effect.map((client) => client.effect as UnrealRCEffectApi)
    )
  );

// ── Test layer ────────────────────────────────────────────────────────

const unimplemented = (method: string): Effect.Effect<never> =>
  Effect.die(new Error(`UnrealRCTest: ${method} not implemented`));

export const UnrealRCTest = Layer.succeed(
  UnrealRCService,
  {
    call: () => unimplemented("call"),
    getProperty: () => unimplemented("getProperty"),
    getProperties: () => unimplemented("getProperties"),
    setProperty: () => unimplemented("setProperty"),
    describe: () => unimplemented("describe"),
    searchAssets: () => unimplemented("searchAssets"),
    info: () => unimplemented("info"),
    event: () => unimplemented("event"),
    thumbnail: () => unimplemented("thumbnail"),
    batch: () => unimplemented("batch"),
    request: () => unimplemented("request"),
    requestRaw: () => unimplemented("requestRaw"),
    callReturn: () => unimplemented("callReturn"),
  } as UnrealRCEffectApi
);
