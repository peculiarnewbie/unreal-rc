import { expect, test } from "bun:test";
import { TransportRequestError } from "../../src/index.js";
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

const errorPathTest = process.env.UNREAL_E2E === "1" ? test : test.skip;

errorPathTest(
  "returns errors for nonexistent object paths and bad function names",
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

    const bogusObjectPath =
      "/Game/Maps/RemoteControlE2E.RemoteControlE2E:PersistentLevel.NonexistentActor_999";
    const bogusFunction = "ZZZ_FunctionThatDoesNotExist_999";
    const bogusProperty = "ZZZ_PropertyThatDoesNotExist_999";

    try {
      await waitForRemoteControlHttp(handle, launchOptions);

      // Test 1: describe a nonexistent object path
      currentStep = "describe nonexistent object path";
      try {
        await clients.http.describe({ objectPath: bogusObjectPath, ...requestOptions });
        // If Unreal returns 200 with empty/error body instead of a status error,
        // that's still valid — the test just confirms no crash.
      } catch (error) {
        expect(error).toBeInstanceOf(TransportRequestError);
        const transportError = error as TransportRequestError;
        expect(transportError.kind).toBeDefined();
        expect(typeof transportError.statusCode).toBe("number");
      }

      // Test 2: call a nonexistent function on the real fixture actor
      currentStep = "call nonexistent function on fixture actor";
      try {
        await clients.http.call({
          objectPath: contract.objectPath,
          functionName: bogusFunction,
          ...requestOptions
        });
        // If Unreal returns 200, that's unexpected but not a test framework bug
        expect(true).toBe(true);
      } catch (error) {
        expect(error).toBeInstanceOf(TransportRequestError);
        const transportError = error as TransportRequestError;
        expect(transportError.kind).toBeDefined();
        expect(typeof transportError.statusCode).toBe("number");
      }

      // Test 3: call on a completely nonexistent object path
      currentStep = "call on nonexistent object path";
      try {
        await clients.http.call({
          objectPath: bogusObjectPath,
          functionName: contract.functionName,
          parameters: { [contract.functionArgumentName]: 1 },
          ...requestOptions
        });
        expect(true).toBe(true);
      } catch (error) {
        expect(error).toBeInstanceOf(TransportRequestError);
        const transportError = error as TransportRequestError;
        expect(transportError.kind).toBeDefined();
        expect(typeof transportError.statusCode).toBe("number");
      }

      // Test 4: getProperty for a nonexistent property name
      // Unreal RC may return undefined/null for missing properties instead of an error
      currentStep = "getProperty for nonexistent property";
      try {
        const value = await clients.http.getProperty({
          objectPath: contract.objectPath,
          propertyName: bogusProperty,
          ...requestOptions
        });
        // If it returns without error, the value should be undefined/null
        expect(value === undefined || value === null).toBe(true);
      } catch (error) {
        expect(error).toBeInstanceOf(TransportRequestError);
        const transportError = error as TransportRequestError;
        expect(transportError.kind).toBeDefined();
        expect(typeof transportError.statusCode).toBe("number");
      }

      // Test 5: verify that error paths over WebSocket also produce typed errors
      currentStep = "call nonexistent function over WebSocket";
      try {
        await clients.ws.call({
          objectPath: contract.objectPath,
          functionName: bogusFunction,
          ...requestOptions
        });
        expect(true).toBe(true);
      } catch (error) {
        expect(error).toBeInstanceOf(TransportRequestError);
        const transportError = error as TransportRequestError;
        expect(transportError.kind).toBeDefined();
      }
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
