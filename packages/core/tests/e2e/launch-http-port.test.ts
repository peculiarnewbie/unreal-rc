import { expect, test } from "bun:test";
import { getBootTimeoutMs, launchFixtureProject, waitForRemoteControlHttp } from "./setup.js";

const launchHttpPortTest = process.env.UNREAL_E2E === "1" ? test : test.skip;

launchHttpPortTest(
  "launches the fixture project and exposes the Remote Control HTTP endpoint",
  async () => {
    const handle = launchFixtureProject();

    try {
      const status = await waitForRemoteControlHttp(handle);
      const routes = status.info.HttpRoutes ?? status.info.Routes ?? [];

      expect(status.portReachable).toBe(true);
      expect(status.endpointUrl).toEndWith("/remote/info");
      expect(routes.length).toBeGreaterThan(0);
      expect(
        routes.some((route) => route.Path === "/remote/info" || route.Path === "/remote/object/call")
      ).toBe(true);
    } finally {
      await handle.stop();
    }
  },
  getBootTimeoutMs() + 30_000
);
