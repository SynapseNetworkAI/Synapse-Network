import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearAdminCsrfToken,
  readAdminCsrfTokenFromStorage,
  saveAdminCsrfToken,
} from "./admin-csrf-token";

type SessionStorageMock = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function createSessionStorageMock(): SessionStorageMock {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

describe("admin-csrf-token", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: createSessionStorageMock(),
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "sessionStorage");
  });

  it("persists and reads the admin csrf token across module memory resets", () => {
    saveAdminCsrfToken("csrf-demo-token");

    expect(readAdminCsrfTokenFromStorage()).toBe("csrf-demo-token");
  });

  it("clears stored csrf tokens when the session is reset", () => {
    saveAdminCsrfToken("csrf-demo-token");
    clearAdminCsrfToken();

    expect(readAdminCsrfTokenFromStorage()).toBeNull();
  });
});