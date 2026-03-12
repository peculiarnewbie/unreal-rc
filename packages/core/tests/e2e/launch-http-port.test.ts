import { expect, test } from "bun:test";
import {
  acquireFixture,
  releaseFixture,
  getBootTimeoutMs,
  waitForRemoteControlHttp
} from "./setup.js";

const launchHttpPortTest = process.env.UNREAL_E2E === "1" ? test : test.skip;

launchHttpPortTest(
  "launches the fixture project and exposes the Remote Control HTTP endpoint",
  async () => {
    const handle = await acquireFixture();

    try {
      const httpStatus = await waitForRemoteControlHttp(handle);
      const httpRoutes = httpStatus.info.HttpRoutes ?? httpStatus.info.Routes ?? [];

      expect(httpStatus.portReachable).toBe(true);
      expect(httpStatus.endpointUrl).toEndWith("/remote/info");
      expect(httpRoutes.length).toBeGreaterThan(0);
      expect(
        httpRoutes.some((route) => route.Path === "/remote/info" || route.Path === "/remote/object/call")
      ).toBe(true);
    } finally {
      await releaseFixture();
    }
  },
  getBootTimeoutMs() + 30_000
);
