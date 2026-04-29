import { expect, test } from "bun:test";
import type { CallArgs, GetPropertyArgs, SetPropertyArgs } from "../../src/index.js";
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

const wsRoundtripTest = process.env.UNREAL_E2E === "1" ? test : test.skip;

wsRoundtripTest(
  "reads and mutates the fixture actor over WebSocket",
  async () => {
    const handle = await acquireFixture();
    const launchOptions = resolveLaunchOptions();
    const clients = createProtocolClients(launchOptions);
    const contract = resolveFixtureContract();
    let currentStep = "launch fixture project";
    const requestOptions = {
      timeoutMs: launchOptions.requestTimeoutMs,
      retry: false
    } as const;

    try {
      currentStep = "wait for Remote Control HTTP";
      await waitForRemoteControlHttp(handle, launchOptions);
      currentStep = "wait for Remote Control WebSocket";
      await waitForRemoteControlWs(handle, launchOptions);

      currentStep = `reset ${contract.propertyName} over HTTP`;
      await setCounter(clients.http, { objectPath: contract.objectPath, propertyName: contract.propertyName, propertyValue: contract.baselineValue, ...requestOptions });

      currentStep = `verify ${contract.propertyName} baseline over WebSocket`;
      expect(await getCounter(clients.ws, { objectPath: contract.objectPath, propertyName: contract.propertyName, ...requestOptions })).toBe(
        contract.baselineValue
      );

      currentStep = `set ${contract.propertyName}=${contract.wsWriteValue} over WebSocket`;
      await setCounter(clients.ws, {
        objectPath: contract.objectPath,
        propertyName: contract.propertyName,
        propertyValue: contract.wsWriteValue,
        ...requestOptions
      });
      currentStep = `verify ${contract.propertyName}=${contract.wsWriteValue} over WebSocket`;
      expect(await getCounter(clients.ws, { objectPath: contract.objectPath, propertyName: contract.propertyName, ...requestOptions })).toBe(
        contract.wsWriteValue
      );

      const wsExpected = contract.wsWriteValue + contract.wsCallDelta;
      currentStep = `${contract.functionName}(${contract.wsCallDelta}) over WebSocket`;
      const wsCall = await clients.ws.call({
        objectPath: contract.objectPath,
        functionName: contract.functionName,
        parameters: {
          [contract.functionArgumentName]: contract.wsCallDelta
        },
        ...requestOptions
      });

      expect(wsCall.ReturnValue).toBe(wsExpected);
      currentStep = `verify ${contract.propertyName}=${wsExpected} over WebSocket`;
      expect(await getCounter(clients.ws, { objectPath: contract.objectPath, propertyName: contract.propertyName, ...requestOptions })).toBe(
        wsExpected
      );
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
        await setCounter(clients.http, {
          objectPath: contract.objectPath,
          propertyName: contract.propertyName,
          propertyValue: contract.baselineValue,
          timeoutMs: launchOptions.requestTimeoutMs,
          retry: false
        });
      } catch {}

      clients.dispose();
      await releaseFixture();
    }
  },
  getBootTimeoutMs() + 60_000
);

const getCounter = async (
  client: { getProperty<T>(args: GetPropertyArgs): Promise<T | undefined> },
  args: GetPropertyArgs
): Promise<number> => {
  const value = await client.getProperty<number>(args);

  expect(typeof value).toBe("number");
  return value as number;
};

const setCounter = async (
  client: { setProperty(args: SetPropertyArgs): Promise<unknown> },
  args: SetPropertyArgs
): Promise<void> => {
  await client.setProperty(args);
};
