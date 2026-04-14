import { ServiceMap, Deferred, Effect, HashMap, Layer, Ref } from "effect";
import type { TransportResponse } from "./transport.js";
import type { TransportError } from "./errors.js";

export interface PendingRequest {
  readonly requestId: number;
  readonly deferred: Deferred.Deferred<TransportResponse, TransportError>;
  readonly verb: string;
  readonly url: string;
  readonly startedAt: number;
  readonly timeoutMs: number | undefined;
}

export interface PendingRequestSnapshot {
  readonly requestId: number;
  readonly verb: string;
  readonly url: string;
  readonly startedAt: number;
  readonly timeoutMs: number | undefined;
}

export interface PendingRequestsService {
  readonly nextId: Effect.Effect<number>;
  readonly get: (requestId: number) => Effect.Effect<PendingRequest | undefined>;
  readonly add: (
    requestId: number,
    verb: string,
    url: string,
    startedAt: number,
    timeoutMs: number | undefined
  ) => Effect.Effect<Deferred.Deferred<TransportResponse, TransportError>>;
  readonly resolve: (requestId: number, response: TransportResponse) => Effect.Effect<void>;
  readonly reject: (requestId: number, error: TransportError) => Effect.Effect<void>;
  readonly rejectAll: (error: TransportError) => Effect.Effect<void>;
  readonly snapshot: Effect.Effect<ReadonlyArray<PendingRequestSnapshot>>;
}

export class PendingRequests extends ServiceMap.Service<
  PendingRequests,
  PendingRequestsService
>()("PendingRequests") {}

export const PendingRequestsLive: Layer.Layer<PendingRequests> = Layer.effect(PendingRequests)(
  Effect.gen(function* () {
    const counter = yield* Ref.make(1);
    const pending = yield* Ref.make(HashMap.empty<number, PendingRequest>());

    return {
      nextId: Ref.getAndUpdate(counter, (n) => n + 1),

      get: (requestId: number) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(pending);
          const entry = HashMap.get(map, requestId);
          return entry._tag === "Some" ? entry.value : undefined;
        }),

      add: (requestId: number, verb: string, url: string, startedAt: number, timeoutMs: number | undefined) =>
        Effect.gen(function* () {
          const deferred = yield* Deferred.make<TransportResponse, TransportError>();
          yield* Ref.update(pending, HashMap.set(requestId, { requestId, deferred, verb, url, startedAt, timeoutMs }));
          return deferred;
        }),

      resolve: (requestId: number, response: TransportResponse) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(pending);
          const entry = HashMap.get(map, requestId);
          if (entry._tag === "Some") {
            yield* Ref.update(pending, HashMap.remove(requestId));
            yield* Deferred.succeed(entry.value.deferred, response);
          }
        }),

      reject: (requestId: number, error: TransportError) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(pending);
          const entry = HashMap.get(map, requestId);
          if (entry._tag === "Some") {
            yield* Ref.update(pending, HashMap.remove(requestId));
            yield* Deferred.fail(entry.value.deferred, error);
          }
        }),

      rejectAll: (error: TransportError) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(pending);
          yield* Ref.set(pending, HashMap.empty());
          for (const [, entry] of map) {
            yield* Deferred.fail(entry.deferred, error);
          }
        }),

      snapshot: Effect.gen(function* () {
        const map = yield* Ref.get(pending);
        const entries: PendingRequestSnapshot[] = [];
        for (const [, entry] of map) {
          entries.push({
            requestId: entry.requestId,
            verb: entry.verb,
            url: entry.url,
            startedAt: entry.startedAt,
            timeoutMs: entry.timeoutMs
          });
        }
        return entries;
      })
    };
  })
);
