import { Data } from "effect";

export class TimeoutError extends Data.TaggedError("TimeoutError")<{
  readonly message: string;
  readonly transport?: string | undefined;
  readonly verb?: string | undefined;
  readonly url?: string | undefined;
  readonly requestId?: number | string | undefined;
}> {}

export class ConnectError extends Data.TaggedError("ConnectError")<{
  readonly message: string;
  readonly transport?: string | undefined;
  readonly cause?: unknown;
}> {}

export class DisconnectError extends Data.TaggedError("DisconnectError")<{
  readonly message: string;
  readonly transport?: string | undefined;
  readonly cause?: unknown;
}> {}

export class HttpStatusError extends Data.TaggedError("HttpStatusError")<{
  readonly message: string;
  readonly statusCode: number;
  readonly transport?: string | undefined;
  readonly verb?: string | undefined;
  readonly url?: string | undefined;
  readonly requestId?: number | string | undefined;
  readonly details?: unknown;
}> {}

export class RemoteStatusError extends Data.TaggedError("RemoteStatusError")<{
  readonly message: string;
  readonly statusCode: number;
  readonly transport?: string | undefined;
  readonly verb?: string | undefined;
  readonly url?: string | undefined;
  readonly requestId?: number | string | undefined;
  readonly details?: unknown;
}> {}

export class DecodeError extends Data.TaggedError("DecodeError")<{
  readonly message: string;
  readonly transport?: string | undefined;
  readonly verb?: string | undefined;
  readonly url?: string | undefined;
  readonly requestId?: number | string | undefined;
  readonly details?: unknown;
  readonly cause?: unknown;
}> {}

export type TransportError =
  | TimeoutError
  | ConnectError
  | DisconnectError
  | HttpStatusError
  | RemoteStatusError
  | DecodeError;
