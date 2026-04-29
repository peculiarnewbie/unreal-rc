import { expect, test } from "bun:test";
import {
  acquireFixture,
  releaseFixture,
  createProtocolClients,
  formatE2eFailure,
  getBootTimeoutMs,
  resolveFixtureContract,
  resolveLaunchOptions,
  waitForRemoteControlHttp
} from "./setup.js";

const searchAssetsTest = process.env.UNREAL_E2E === "1" ? test : test.skip;

searchAssetsTest(
  "searches for the fixture Blueprint by name over HTTP",
  async () => {
    const handle = await acquireFixture();
    const launchOptions = resolveLaunchOptions();
    const clients = createProtocolClients(launchOptions);
    const contract = resolveFixtureContract();
    let currentStep = "wait for Remote Control HTTP";
    const requestOptions = {
      timeoutMs: launchOptions.requestTimeoutMs,
      retry: false
    } as const;

    try {
      await waitForRemoteControlHttp(handle, launchOptions);

      currentStep = "search for fixture Blueprint by name";
      const byName = await clients.http.searchAssets({ query: "E2EFixture", ...requestOptions });
      const nameResults = byName.Assets ?? byName.Results ?? [];

      expect(nameResults.length).toBeGreaterThan(0);
      expect(
        nameResults.some(
          (asset) =>
            (asset.Name?.includes("E2EFixture") ?? false) ||
            (asset.ObjectPath?.includes("E2EFixture") ?? false)
        )
      ).toBe(true);

      currentStep = "search by package path /Game/Maps";
      const byPath = await clients.http.searchAssets({
        query: "",
        packagePaths: ["/Game/Maps"],
        recursivePaths: true,
        ...requestOptions
      });
      const pathResults = byPath.Assets ?? byPath.Results ?? [];

      expect(pathResults.length).toBeGreaterThan(0);

      currentStep = "search with nonsense query returns empty results";
      const nonsense = await clients.http.searchAssets({
        query: "ZZZ_NonexistentAsset_XYZ_999",
        ...requestOptions
      });
      const nonsenseResults = nonsense.Assets ?? nonsense.Results ?? [];

      expect(nonsenseResults).toHaveLength(0);
    } catch (error) {
      throw new Error(
        formatE2eFailure({
          error,
          step: currentStep,
          handle,
          diagnostics: clients.diagnostics,
          contract,
          launchOptions
        })
      );
    } finally {
      clients.dispose();
      await releaseFixture();
    }
  },
  getBootTimeoutMs() + 60_000
);
