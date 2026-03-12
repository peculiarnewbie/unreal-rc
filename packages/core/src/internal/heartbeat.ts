import { Effect, Schedule } from "effect";

export const heartbeat = (
  send: (data: string) => Effect.Effect<void>,
  intervalMs: number
): Effect.Effect<void> =>
  send("ping").pipe(
    Effect.repeat(Schedule.spaced(`${intervalMs} millis`)),
    Effect.map(() => void 0 as void)
  );
