import { Context, Deferred, Effect, HashMap, Layer, Ref } from "effect";
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

export type PendingRequestSnapshot = Omit<PendingRequest, "deferred">;

export interface PendingRequestsService {
  readonly nextId: Effect.Effect<number>;
  readonly get: (requestId: number) => Effect.Effect<PendingRequest | undefined>;
  readonly add: (request: PendingRequest) => Effect.Effect<void>;
  readonly resolve: (requestId: number, response: TransportResponse) => Effect.Effect<void>;
  readonly reject: (requestId: number, error: TransportError) => Effect.Effect<void>;
  readonly rejectAll: (error: TransportError) => Effect.Effect<void>;
  readonly snapshot: Effect.Effect<ReadonlyArray<PendingRequestSnapshot>>;
}

export class PendingRequests extends Context.Service<PendingRequests, PendingRequestsService>()(
  "PendingRequests",
) {}

export const PendingRequestsLive: Layer.Layer<PendingRequests> = Layer.effect(PendingRequests)(
  Effect.gen(function* () {
    const counter = yield* Ref.make(1);
    const pending = yield* Ref.make(HashMap.empty<number, PendingRequest>());
    const take = (requestId: number) =>
      Ref.modify(pending, (map) => [HashMap.get(map, requestId), HashMap.remove(map, requestId)]);

    return {
      nextId: Ref.getAndUpdate(counter, (n) => n + 1),

      get: (requestId: number) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(pending);
          const entry = HashMap.get(map, requestId);
          return entry._tag === "Some" ? entry.value : undefined;
        }),

      add: (request: PendingRequest) =>
        Ref.update(pending, HashMap.set(request.requestId, request)),

      resolve: (requestId: number, response: TransportResponse) =>
        Effect.gen(function* () {
          const entry = yield* take(requestId);
          if (entry._tag === "Some") {
            yield* Deferred.succeed(entry.value.deferred, response);
          }
        }),

      reject: (requestId: number, error: TransportError) =>
        Effect.gen(function* () {
          const entry = yield* take(requestId);
          if (entry._tag === "Some") {
            yield* Deferred.fail(entry.value.deferred, error);
          }
        }),

      rejectAll: (error: TransportError) =>
        Effect.gen(function* () {
          const map = yield* Ref.getAndSet(pending, HashMap.empty());
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
            timeoutMs: entry.timeoutMs,
          });
        }
        return entries;
      }),
    };
  }),
);
