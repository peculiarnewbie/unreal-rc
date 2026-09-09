# Changelog

All notable changes to `unreal-rc` are documented here.

## [Unreleased]

## [0.5.4] - 2026-09-09

### Fixed

- HTTP requests now abort cleanly when their Effect is interrupted or the runtime is disposed, and request-construction failures are reported as transport errors.
- WebSocket queue overflow is rejected immediately, expired queued requests release capacity, and queued or in-flight requests settle on disconnect and disposal.
- WebSocket response frames are validated before correlation, malformed status values produce decode errors, and JSON `null` response bodies remain `null`.
- WebSocket connection listeners and sockets are cleaned up when connection attempts are interrupted or the transport is disposed.
- Retry predicates and delay callbacks now receive the actual failed request, status, and attempt number. Numeric retry delays retain exponential backoff.
- Health watchers remain unhealthy until a ping succeeds, tolerate observer exceptions, and stop when the client is disposed.
- Caller-provided HTTP `Content-Type` headers are preserved regardless of casing.

### Testing and maintenance

- Added transport lifecycle, cancellation, correlation, retry, and health regression coverage.
- Added an audit report covering the core transport implementation and remaining follow-up work.
- Fixed unsupported assertions in the Unreal-backed smoke tests.

