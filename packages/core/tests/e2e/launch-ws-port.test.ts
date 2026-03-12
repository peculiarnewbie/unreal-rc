import { expect, test } from "bun:test";
import {
  acquireFixture,
  releaseFixture,
  getBootTimeoutMs,
  waitForRemoteControlHttp,
  waitForRemoteControlWs
} from "./setup.js";

const launchWsPortTest = process.env.UNREAL_E2E === "1" ? test : test.skip;

launchWsPortTest(
  "launches the fixture project and exposes the Remote Control WebSocket endpoint",
  async () => {
    const handle = await acquireFixture();

    try {
      await waitForRemoteControlHttp(handle);
      const wsStatus = await waitForRemoteControlWs(handle);

      expect(wsStatus.portReachable).toBe(true);
      expect(wsStatus.endpointUrl).toStartWith("ws://");
    } finally {
      await releaseFixture();
    }
  },
  getBootTimeoutMs() + 30_000
);
