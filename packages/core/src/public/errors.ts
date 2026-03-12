import type {
  ConnectError,
  DecodeError,
  DisconnectError,
  HttpStatusError,
  RemoteStatusError,
  TimeoutError,
  TransportError
} from "../internal/errors.js";
import type { HttpVerb, TransportRequestErrorKind, TransportRequestId } from "./types.js";

export class TransportRequestError extends Error {
  readonly kind: TransportRequestErrorKind;
  readonly statusCode: number | undefined;
  readonly details?: unknown;
  readonly verb: HttpVerb | undefined;
  readonly url: string | undefined;
  readonly transport: string | undefined;
  readonly requestId: TransportRequestId | undefined;

  constructor(
    message: string,
    options?: {
      kind?: TransportRequestErrorKind | undefined;
      statusCode?: number | undefined;
      details?: unknown;
      verb?: HttpVerb | undefined;
      url?: string | undefined;
      transport?: string | undefined;
      requestId?: TransportRequestId | undefined;
      cause?: unknown;
    }
  ) {
    super(message, { cause: options?.cause });
    this.name = "TransportRequestError";
    this.kind = options?.kind ?? "unknown";
    this.statusCode = options?.statusCode;
    this.details = options?.details;
    this.verb = options?.verb;
    this.url = options?.url;
    this.transport = options?.transport;
    this.requestId = options?.requestId;
  }
}

const tagToKind: Record<TransportError["_tag"], TransportRequestErrorKind> = {
  TimeoutError: "timeout",
  ConnectError: "connect",
  DisconnectError: "disconnect",
  HttpStatusError: "http_status",
  RemoteStatusError: "remote_status",
  DecodeError: "decode"
};

export const toPublicError = (error: TransportError): TransportRequestError => {
  const kind = tagToKind[error._tag];

  const statusCode = hasStatusCode(error) ? error.statusCode : undefined;
  const details = hasDetails(error) ? error.details : undefined;
  const verb = hasVerb(error) ? (error.verb as HttpVerb | undefined) : undefined;
  const url = hasUrl(error) ? error.url : undefined;
  const requestId = hasRequestId(error) ? error.requestId : undefined;
  const transport = hasTransport(error) ? error.transport : undefined;
  const cause = hasCause(error) ? error.cause : undefined;

  return new TransportRequestError(error.message, {
    kind,
    statusCode,
    details,
    verb,
    url,
    transport,
    requestId,
    cause
  });
};

export const toTransportRequestError = (
  error: unknown,
  fallback: {
    message?: string | undefined;
    kind?: TransportRequestErrorKind | undefined;
    statusCode?: number | undefined;
    details?: unknown;
    verb?: HttpVerb | undefined;
    url?: string | undefined;
    transport?: string | undefined;
    requestId?: TransportRequestId | undefined;
  } = {}
): TransportRequestError => {
  if (error instanceof TransportRequestError) {
    return new TransportRequestError(error.message, {
      cause: error.cause,
      kind: error.kind ?? fallback.kind,
      statusCode: error.statusCode ?? fallback.statusCode,
      details: error.details ?? fallback.details,
      verb: error.verb ?? fallback.verb,
      url: error.url ?? fallback.url,
      transport: error.transport ?? fallback.transport,
      requestId: error.requestId ?? fallback.requestId
    });
  }

  return new TransportRequestError(
    fallback.message ?? (error instanceof Error ? error.message : "Transport request failed"),
    {
      cause: error,
      kind: fallback.kind,
      statusCode: fallback.statusCode,
      details: fallback.details,
      verb: fallback.verb,
      url: fallback.url,
      transport: fallback.transport,
      requestId: fallback.requestId
    }
  );
};

// ── Type guards for optional fields across tagged error variants ────────

const hasStatusCode = (e: TransportError): e is HttpStatusError | RemoteStatusError =>
  "statusCode" in e;

const hasDetails = (
  e: TransportError
): e is HttpStatusError | RemoteStatusError | DecodeError => "details" in e;

const hasVerb = (
  e: TransportError
): e is TimeoutError | HttpStatusError | RemoteStatusError | DecodeError => "verb" in e;

const hasUrl = (
  e: TransportError
): e is TimeoutError | HttpStatusError | RemoteStatusError | DecodeError => "url" in e;

const hasRequestId = (
  e: TransportError
): e is TimeoutError | HttpStatusError | RemoteStatusError | DecodeError => "requestId" in e;

const hasTransport = (e: TransportError): e is TransportError => "transport" in e;

const hasCause = (
  e: TransportError
): e is ConnectError | DisconnectError | DecodeError => "cause" in e;
