import { expect, test } from "bun:test";
import type { GetPropertyArgs, SetPropertyArgs } from "../../src/index.js";
import {
  acquireFixture,
  releaseFixture,
  createProtocolClients,
  formatE2eFailure,
  getBootTimeoutMs,
  resolveFixtureContract,
  resolveLaunchOptions,
  waitForRemoteControlHttp,
  waitForRemoteControlWs
} from "./setup.js";

const crossTransportTest = process.env.UNREAL_E2E === "1" ? test : test.skip;

crossTransportTest(
  "mutations on one transport are visible from the other",
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
      currentStep = "wait for Remote Control HTTP";
      await waitForRemoteControlHttp(handle, launchOptions);
      currentStep = "wait for Remote Control WebSocket";
      await waitForRemoteControlWs(handle, launchOptions);

      // Reset to baseline
      currentStep = "reset Counter to baseline via HTTP";
      await setCounter(clients.http, contract, contract.baselineValue, requestOptions);

      // Test 1: Write via HTTP → read via WS
      const httpWriteValue = 111;
      currentStep = `set Counter=${httpWriteValue} via HTTP`;
      await setCounter(clients.http, contract, httpWriteValue, requestOptions);

      currentStep = `read Counter via WS, expect ${httpWriteValue}`;
      expect(await getCounter(clients.ws, contract, requestOptions)).toBe(httpWriteValue);

      // Test 2: Write via WS → read via HTTP
      const wsWriteValue = 222;
      currentStep = `set Counter=${wsWriteValue} via WS`;
      await setCounter(clients.ws, contract, wsWriteValue, requestOptions);

      currentStep = `read Counter via HTTP, expect ${wsWriteValue}`;
      expect(await getCounter(clients.http, contract, requestOptions)).toBe(wsWriteValue);

      // Test 3: Call via HTTP → verify via WS
      currentStep = "reset Counter to baseline via HTTP";
      await setCounter(clients.http, contract, contract.baselineValue, requestOptions);

      currentStep = `call ${contract.functionName}(${contract.httpCallDelta}) via HTTP`;
      const httpCallResult = await clients.http.call({
        objectPath: contract.objectPath,
        functionName: contract.functionName,
        parameters: { [contract.functionArgumentName]: contract.httpCallDelta },
        ...requestOptions
      });

      const expectedAfterHttpCall = contract.baselineValue + contract.httpCallDelta;
      expect(httpCallResult.ReturnValue).toBe(expectedAfterHttpCall);

      currentStep = `read Counter via WS, expect ${expectedAfterHttpCall}`;
      expect(await getCounter(clients.ws, contract, requestOptions)).toBe(expectedAfterHttpCall);

      // Test 4: Call via WS → verify via HTTP
      currentStep = "reset Counter to baseline via HTTP";
      await setCounter(clients.http, contract, contract.baselineValue, requestOptions);

      currentStep = `call ${contract.functionName}(${contract.wsCallDelta}) via WS`;
      const wsCallResult = await clients.ws.call({
        objectPath: contract.objectPath,
        functionName: contract.functionName,
        parameters: { [contract.functionArgumentName]: contract.wsCallDelta },
        ...requestOptions
      });

      const expectedAfterWsCall = contract.baselineValue + contract.wsCallDelta;
      expect(wsCallResult.ReturnValue).toBe(expectedAfterWsCall);

      currentStep = `read Counter via HTTP, expect ${expectedAfterWsCall}`;
      expect(await getCounter(clients.http, contract, requestOptions)).toBe(expectedAfterWsCall);
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
      try {
        await setCounter(
          clients.http,
          contract,
          contract.baselineValue,
          { timeoutMs: launchOptions.requestTimeoutMs, retry: false }
        );
      } catch {}

      clients.dispose();
      await releaseFixture();
    }
  },
  getBootTimeoutMs() + 60_000
);

// ── Helpers ───────────────────────────────────────────────────────────

interface ContractRef {
  objectPath: string;
  propertyName: string;
}

const getCounter = async (
  client: { getProperty<T>(args: GetPropertyArgs): Promise<T | undefined> },
  contract: ContractRef,
  options: { timeoutMs?: number; retry?: unknown }
): Promise<number> => {
  const value = await client.getProperty<number>({
    objectPath: contract.objectPath,
    propertyName: contract.propertyName,
    ...options
  });
  expect(typeof value).toBe("number");
  return value as number;
};

const setCounter = async (
  client: { setProperty(args: SetPropertyArgs): Promise<unknown> },
  contract: ContractRef,
  value: number,
  options: { timeoutMs?: number; retry?: unknown }
): Promise<void> => {
  await client.setProperty({
    objectPath: contract.objectPath,
    propertyName: contract.propertyName,
    propertyValue: value,
    ...options
  });
};
