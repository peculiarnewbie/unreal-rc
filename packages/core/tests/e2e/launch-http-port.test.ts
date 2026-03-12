import { expect, test } from "bun:test";
import {
  getBootTimeoutMs,
  launchFixtureProject,
  waitForRemoteControlHttp,
  waitForRemoteControlWs
} from "./setup.js";

const launchHttpPortTest = process.env.UNREAL_E2E === "1" ? test : test.skip;

launchHttpPortTest(
  "launches the fixture project and exposes the Remote Control HTTP and WebSocket endpoints",
  async () => {
    const handle = launchFixtureProject();

    try {
      const httpStatus = await waitForRemoteControlHttp(handle);
      const wsStatus = await waitForRemoteControlWs(handle);
      const httpRoutes = httpStatus.info.HttpRoutes ?? httpStatus.info.Routes ?? [];
      const wsRoutes = wsStatus.info.HttpRoutes ?? wsStatus.info.Routes ?? [];

      expect(httpStatus.portReachable).toBe(true);
      expect(httpStatus.endpointUrl).toEndWith("/remote/info");
      expect(httpRoutes.length).toBeGreaterThan(0);
      expect(
        httpRoutes.some((route) => route.Path === "/remote/info" || route.Path === "/remote/object/call")
      ).toBe(true);

      expect(wsStatus.portReachable).toBe(true);
      expect(wsStatus.endpointUrl).toStartWith("ws://");
      expect(wsRoutes.length).toBeGreaterThan(0);
      expect(
        wsRoutes.some((route) => route.Path === "/remote/info" || route.Path === "/remote/object/property")
      ).toBe(true);
    } finally {
      await handle.stop();
    }
  },
  getBootTimeoutMs() + 30_000
);
