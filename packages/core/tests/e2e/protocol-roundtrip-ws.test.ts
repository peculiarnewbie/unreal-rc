import { expect, test } from "bun:test";
import type { CallOptions, GetPropertyOptions, SetPropertyOptions } from "../../src/index.js";
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

      const propertyOptions: GetPropertyOptions = requestOptions;
      const setPropertyOptions: SetPropertyOptions = requestOptions;
      const callOptions: CallOptions = requestOptions;

      currentStep = `reset ${contract.propertyName} over HTTP`;
      await setCounter(clients.http, contract.objectPath, contract.propertyName, contract.baselineValue, setPropertyOptions);

      currentStep = `verify ${contract.propertyName} baseline over WebSocket`;
      expect(await getCounter(clients.ws, contract.objectPath, contract.propertyName, propertyOptions)).toBe(
        contract.baselineValue
      );

      currentStep = `set ${contract.propertyName}=${contract.wsWriteValue} over WebSocket`;
      await setCounter(
        clients.ws,
        contract.objectPath,
        contract.propertyName,
        contract.wsWriteValue,
        setPropertyOptions
      );
      currentStep = `verify ${contract.propertyName}=${contract.wsWriteValue} over WebSocket`;
      expect(await getCounter(clients.ws, contract.objectPath, contract.propertyName, propertyOptions)).toBe(
        contract.wsWriteValue
      );

      const wsExpected = contract.wsWriteValue + contract.wsCallDelta;
      currentStep = `${contract.functionName}(${contract.wsCallDelta}) over WebSocket`;
      const wsCall = await clients.ws.call(
        contract.objectPath,
        contract.functionName,
        {
          [contract.functionArgumentName]: contract.wsCallDelta
        },
        callOptions
      );

      expect(wsCall.ReturnValue).toBe(wsExpected);
      currentStep = `verify ${contract.propertyName}=${wsExpected} over WebSocket`;
      expect(await getCounter(clients.ws, contract.objectPath, contract.propertyName, propertyOptions)).toBe(
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
        await setCounter(
          clients.http,
          contract.objectPath,
          contract.propertyName,
          contract.baselineValue,
          {
            timeoutMs: launchOptions.requestTimeoutMs,
            retry: false
          }
        );
      } catch {}

      clients.dispose();
      await releaseFixture();
    }
  },
  getBootTimeoutMs() + 60_000
);

const getCounter = async (
  client: { getProperty<T>(objectPath: string, propertyName: string, options?: GetPropertyOptions): Promise<T | undefined> },
  objectPath: string,
  propertyName: string,
  options: GetPropertyOptions
): Promise<number> => {
  const value = await client.getProperty<number>(objectPath, propertyName, options);

  expect(typeof value).toBe("number");
  return value as number;
};

const setCounter = async (
  client: { setProperty(objectPath: string, propertyName: string, propertyValue: unknown, options?: SetPropertyOptions): Promise<unknown> },
  objectPath: string,
  propertyName: string,
  value: number,
  options: SetPropertyOptions
): Promise<void> => {
  await client.setProperty(objectPath, propertyName, value, options);
};
