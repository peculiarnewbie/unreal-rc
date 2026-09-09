import { afterEach, expect, test, vi } from "vitest";
import { UnrealRC } from "../src/index.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("initial failures never report healthy before a successful ping", async () => {
  vi.useFakeTimers();
  const client = new UnrealRC({ transport: "http" });
  const ping = vi
    .spyOn(client, "ping")
    .mockResolvedValue({ reachable: false, latencyMs: undefined });
  const onChange = vi.fn();
  const watcher = client.watchHealth({ intervalMs: 100, unhealthyAfter: 3, onChange });
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(ping).toHaveBeenCalledTimes(1);
    expect(watcher.status()).toMatchObject({ healthy: false, consecutiveFailures: 1 });
    expect(onChange).not.toHaveBeenCalled();
    ping.mockResolvedValue({ reachable: true, latencyMs: 5 });
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledOnce();
    expect(watcher.status().healthy).toBe(true);
  } finally {
    await client.dispose();
  }
});

test("throwing health observers do not stop polling, and client disposal stops all watchers", async () => {
  vi.useFakeTimers();
  const client = new UnrealRC({ transport: "http" });
  const ping = vi.spyOn(client, "ping").mockResolvedValue({ reachable: true, latencyMs: 5 });
  client.watchHealth({
    intervalMs: 100,
    onChange: () => {
      throw new Error("observer failed");
    },
  });
  client.watchHealth({ intervalMs: 100 });
  try {
    await vi.advanceTimersByTimeAsync(100);
    expect(ping).toHaveBeenCalledTimes(4);
    await client.dispose();
    await vi.advanceTimersByTimeAsync(500);
    expect(ping).toHaveBeenCalledTimes(4);
  } finally {
    await client.dispose();
  }
});
