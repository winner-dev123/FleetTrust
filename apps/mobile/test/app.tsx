import { afterEach } from "@jest/globals";
import { renderRouter } from "expo-router/testing-library";

import { setRuntime } from "../src/platform/runtime";
import { FakeApi, fakeRuntime } from "./fake-api";
import { FakeDevice } from "./fake-platform";

afterEach(() => {
  setRuntime(null);
});

export interface OpenOptions {
  signedIn?: boolean;
  online?: boolean;
  device?: FakeDevice;
  api?: FakeApi;
}

/**
 * Starts the real app (every file in ./app, root layout included) at `url`, on a fake device
 * and a fake API. This is the same path a deep link or a notification tap takes.
 */
export async function openApp(url: string, options: OpenOptions = {}) {
  const device = options.device ?? new FakeDevice();
  const api = options.api ?? new FakeApi();
  if (options.signedIn !== false && !device.user) device.signIn();
  if (options.online === false) device.online = false;
  setRuntime(fakeRuntime(device, api));
  const result = await renderRouter("./app", { initialUrl: url });
  return { device, api, result };
}
