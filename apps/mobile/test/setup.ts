import { jest } from "@jest/globals";

// Native modules imported by src/platform/native.ts. Tests never call them (they install a
// fake runtime), but importing the real packages in Node would fail.
jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("@react-native-community/netinfo", () =>
  jest.requireActual("@react-native-community/netinfo/jest/netinfo-mock.js"),
);
jest.mock("react-native-permissions", () => jest.requireActual("react-native-permissions/mock"));
