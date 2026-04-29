import { expect, test } from "bun:test";
import type { CallArgs, DescribeArgs, GetPropertyArgs, SetPropertyArgs } from "../../src/index.js";
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

const httpRoundtripTest = process.env.UNREAL_E2E === "1" ? test : test.skip;

httpRoundtripTest(
  "reads and mutates the fixture actor over HTTP",
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

      currentStep = "describe fixture actor over HTTP";
      const description = await clients.http.describe({ objectPath: contract.objectPath, ...requestOptions });

      expect(description.Path ?? contract.objectPath).toBe(contract.objectPath);
      expect(description.Properties?.some((property) => property.Name === contract.propertyName)).toBe(true);
      expect(description.Functions?.some((fn) => fn.Name === contract.functionName)).toBe(true);

      currentStep = `reset ${contract.propertyName} over HTTP`;
      await setCounter(clients.http, { objectPath: contract.objectPath, propertyName: contract.propertyName, propertyValue: contract.baselineValue, ...requestOptions });
      currentStep = `verify ${contract.propertyName} baseline over HTTP`;
      expect(await getCounter(clients.http, { objectPath: contract.objectPath, propertyName: contract.propertyName, ...requestOptions })).toBe(
        contract.baselineValue
      );

      currentStep = `set ${contract.propertyName}=${contract.httpWriteValue} over HTTP`;
      await setCounter(clients.http, {
        objectPath: contract.objectPath,
        propertyName: contract.propertyName,
        propertyValue: contract.httpWriteValue,
        ...requestOptions
      });
      currentStep = `verify ${contract.propertyName}=${contract.httpWriteValue} over HTTP`;
      expect(await getCounter(clients.http, { objectPath: contract.objectPath, propertyName: contract.propertyName, ...requestOptions })).toBe(
        contract.httpWriteValue
      );

      const httpExpected = contract.httpWriteValue + contract.httpCallDelta;
      currentStep = `${contract.functionName}(${contract.httpCallDelta}) over HTTP`;
      const httpCall = await clients.http.call({
        objectPath: contract.objectPath,
        functionName: contract.functionName,
        parameters: {
          [contract.functionArgumentName]: contract.httpCallDelta
        },
        ...requestOptions
      });

      expect(httpCall.ReturnValue).toBe(httpExpected);
      currentStep = `verify ${contract.propertyName}=${httpExpected} over HTTP`;
      expect(await getCounter(clients.http, { objectPath: contract.objectPath, propertyName: contract.propertyName, ...requestOptions })).toBe(
        httpExpected
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
