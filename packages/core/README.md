# unreal-rc

Typed client for Unreal Engine's Remote Control plugin.

## Install

```bash
npm install unreal-rc
```

## Usage

```ts
import { UnrealRC } from "unreal-rc";

const ue = new UnrealRC({ transport: "ws", host: "127.0.0.1", port: 30020 });

await ue.call("/Game/Maps/Main.Main:PersistentLevel.MyActor", "SetActorHiddenInGame", {
  bNewHidden: false
});

const location = await ue.getProperty("/Game/Maps/Main.Main:PersistentLevel.MyActor", "RelativeLocation");

ue.dispose();
```
