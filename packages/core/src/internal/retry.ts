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

export interface RetryConfig {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly delayMs?: ((error: TransportError, attempt: number) => number) | undefined;
  readonly shouldRetry?: ((error: TransportError, attempt: number) => boolean) | undefined;
}

export const withRetry = <A, R>(
  effect: Effect.Effect<A, TransportError, R>,
  options: RetryConfig | false,
): Effect.Effect<A, TransportError, R> => {
  if (options === false || options.maxAttempts <= 1) {
    return effect;
  }

  const check = options.shouldRetry ?? defaultShouldRetry;
  const attempts: Schedule.Schedule<number, TransportError> = Schedule.recurs(
    options.maxAttempts - 1,
  );
  const schedule = attempts.pipe(
    Schedule.while(({ input, attempt }) => Effect.sync(() => check(input, attempt))),
    Schedule.modifyDelay(({ input, attempt }) =>
      Effect.sync(() =>
        options.delayMs
          ? options.delayMs(input, attempt)
          : options.baseDelayMs * 2 ** (attempt - 1),
      ),
    ),
  );

  return Effect.retry(effect, { schedule });
};
