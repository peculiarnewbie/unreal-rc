import { expect, test } from "bun:test";
import type { SetPropertyOptions } from "../../src/index.js";
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

const batchRoundtripTest = process.env.UNREAL_E2E === "1" ? test : test.skip;

batchRoundtripTest(
  "executes a multi-operation batch in one round-trip over HTTP",
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

      // Reset Counter to baseline before batch operations
      currentStep = "reset Counter to baseline";
      await clients.http.setProperty(
        contract.objectPath,
        contract.propertyName,
        contract.baselineValue,
        requestOptions as SetPropertyOptions
      );

      // Batch 1: describe + getProperty + call in one round-trip
      currentStep = "batch describe + getProperty + call";
      const results = await clients.http.batch((b) => {
        b.describe(contract.objectPath);
        b.getProperty(contract.objectPath, contract.propertyName);
        b.call(contract.objectPath, contract.functionName, {
          [contract.functionArgumentName]: contract.httpCallDelta
        });
      }, requestOptions);

      expect(results).toHaveLength(3);

      // Verify describe result
      currentStep = "verify batch describe result";
      expect(results[0]?.statusCode).toBe(200);
      const describeBody = results[0]?.body as Record<string, unknown> | undefined;
      expect(describeBody).toBeDefined();

      // Verify getProperty result
      currentStep = "verify batch getProperty result";
      expect(results[1]?.statusCode).toBe(200);

      // Verify call result
      currentStep = "verify batch call result";
      expect(results[2]?.statusCode).toBe(200);

      // Verify RequestId correlation — each result should match its request index
      currentStep = "verify RequestId correlation";
      expect(results[0]?.requestId).toBe(0);
      expect(results[1]?.requestId).toBe(1);
      expect(results[2]?.requestId).toBe(2);
      expect(results[0]?.request.URL).toBe("/remote/object/describe");
      expect(results[1]?.request.URL).toBe("/remote/object/property");
      expect(results[2]?.request.URL).toBe("/remote/object/call");

      // Batch 2: setProperty + getProperty to verify write-then-read
      const writeValue = contract.httpWriteValue;
      currentStep = `batch setProperty(${writeValue}) + getProperty`;
      const writeReadResults = await clients.http.batch((b) => {
        b.setProperty(contract.objectPath, contract.propertyName, writeValue);
        b.getProperty(contract.objectPath, contract.propertyName);
      }, requestOptions);

      expect(writeReadResults).toHaveLength(2);

      currentStep = "verify batch setProperty result";
      expect(writeReadResults[0]?.statusCode).toBe(200);

      currentStep = "verify batch getProperty after set";
      expect(writeReadResults[1]?.statusCode).toBe(200);
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
        await clients.http.setProperty(
          contract.objectPath,
          contract.propertyName,
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
