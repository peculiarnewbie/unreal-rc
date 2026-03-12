import { Effect, Schedule } from "effect";
import type { TransportError } from "./errors.js";

const RETRYABLE_HTTP_STATUS_CODES = new Set([502, 503, 504]);

export const defaultShouldRetry = (error: TransportError): boolean => {
  switch (error._tag) {
    case "TimeoutError":
    case "ConnectError":
    case "DisconnectError":
      return true;
    case "HttpStatusError":
      return RETRYABLE_HTTP_STATUS_CODES.has(error.statusCode);
    case "RemoteStatusError":
    case "DecodeError":
      return false;
  }
};

export const withRetry = <A, R>(
  effect: Effect.Effect<A, TransportError, R>,
  options: {
    maxAttempts: number;
    baseDelayMs: number;
    shouldRetry?: ((error: TransportError) => boolean) | undefined;
  } | false
): Effect.Effect<A, TransportError, R> => {
  if (options === false || options.maxAttempts <= 1) {
    return effect;
  }

  const check = options.shouldRetry ?? defaultShouldRetry;
  const schedule = Schedule.exponential(`${options.baseDelayMs} millis`, 2).pipe(
    Schedule.take(options.maxAttempts - 1)
  );

  return Effect.retry(effect, {
    schedule,
    while: check
  });
};
