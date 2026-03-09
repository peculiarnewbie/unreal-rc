# unreal-rc

Typed client for Unreal Engine's Remote Control plugin.

## Install

```bash
npm install unreal-rc
```

## Usage

```ts
import { UnrealRC, buildCallRequest } from "unreal-rc";

const ue = new UnrealRC({
  transport: "ws",
  host: "127.0.0.1",
  port: 30020,
  retry: { maxAttempts: 3 },
  redactPayload: () => "[redacted]",
  onError: ({ transport, verb, url, statusCode, error }) => {
    console.error(transport, verb, url, statusCode, error.kind);
  }
});

await ue.call("/Game/Maps/Main.Main:PersistentLevel.MyActor", "SetActorHiddenInGame", {
  bNewHidden: false
});

const location = await ue.getProperty("/Game/Maps/Main.Main:PersistentLevel.MyActor", "RelativeLocation");

ue.dispose();
```

Protocol-level helpers are also exported for CLI or higher-level wrappers:

```ts
const requestBody = buildCallRequest(
  "/Game/Maps/Main.Main:PersistentLevel.MyActor",
  "SetActorHiddenInGame",
  { bNewHidden: false }
);
```
