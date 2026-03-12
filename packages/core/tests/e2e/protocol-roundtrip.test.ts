import { expect, test } from "bun:test";
import type { CallOptions, DescribeOptions, GetPropertyOptions, SetPropertyOptions } from "../../src/index.js";
import {
  createProtocolClients,
  formatE2eFailure,
  getBootTimeoutMs,
  launchFixtureProject,
  resolveFixtureContract,
  resolveLaunchOptions,
  waitForRemoteControlHttp,
  waitForRemoteControlWs
} from "./setup.js";

const protocolRoundtripTest = process.env.UNREAL_E2E === "1" ? test : test.skip;

protocolRoundtripTest(
  "reads and mutates the fixture actor over HTTP and WebSocket",
  async () => {
    const handle = launchFixtureProject();
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

      const describeOptions: DescribeOptions = requestOptions;
      const propertyOptions: GetPropertyOptions = requestOptions;
      const setPropertyOptions: SetPropertyOptions = requestOptions;
      const callOptions: CallOptions = requestOptions;

      currentStep = "describe fixture actor over HTTP";
      const description = await clients.http.describe(contract.objectPath, describeOptions);

      expect(description.Path ?? contract.objectPath).toBe(contract.objectPath);
      expect(description.Properties?.some((property) => property.Name === contract.propertyName)).toBe(true);
      expect(description.Functions?.some((fn) => fn.Name === contract.functionName)).toBe(true);

      currentStep = `reset ${contract.propertyName} over HTTP`;
      await setCounter(clients.http, contract.objectPath, contract.propertyName, contract.baselineValue, setPropertyOptions);
      currentStep = `verify ${contract.propertyName} baseline over HTTP`;
      expect(await getCounter(clients.http, contract.objectPath, contract.propertyName, propertyOptions)).toBe(
        contract.baselineValue
      );

      currentStep = `set ${contract.propertyName}=${contract.httpWriteValue} over HTTP`;
      await setCounter(
        clients.http,
        contract.objectPath,
        contract.propertyName,
        contract.httpWriteValue,
        setPropertyOptions
      );
      currentStep = `verify ${contract.propertyName}=${contract.httpWriteValue} over HTTP`;
      expect(await getCounter(clients.http, contract.objectPath, contract.propertyName, propertyOptions)).toBe(
        contract.httpWriteValue
      );

      const httpExpected = contract.httpWriteValue + contract.httpCallDelta;
      currentStep = `${contract.functionName}(${contract.httpCallDelta}) over HTTP`;
      const httpCall = await clients.http.call(
        contract.objectPath,
        contract.functionName,
        {
          [contract.functionArgumentName]: contract.httpCallDelta
        },
        callOptions
      );

      expect(httpCall.ReturnValue).toBe(httpExpected);
      currentStep = `verify ${contract.propertyName}=${httpExpected} over WebSocket`;
      expect(await getCounter(clients.ws, contract.objectPath, contract.propertyName, propertyOptions)).toBe(
        httpExpected
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
      currentStep = `verify ${contract.propertyName}=${wsExpected} over HTTP`;
      expect(await getCounter(clients.http, contract.objectPath, contract.propertyName, propertyOptions)).toBe(
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
      await handle.stop();
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
