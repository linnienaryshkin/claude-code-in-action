import { test, expect, beforeEach, vi } from "vitest";
import { getHasAnonWork } from "@/lib/anon-work-tracker";

const STORAGE_KEY = "uigen_has_anon_work";

beforeEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

test("returns false when nothing has been stashed in sessionStorage", () => {
  expect(getHasAnonWork()).toBe(false);
});

test("returns true when the flag is set to 'true'", () => {
  sessionStorage.setItem(STORAGE_KEY, "true");
  expect(getHasAnonWork()).toBe(true);
});

test("returns false when the flag is some truthy-but-wrong value", () => {
  sessionStorage.setItem(STORAGE_KEY, "yes");
  expect(getHasAnonWork()).toBe(false);
});

test("returns false when the flag is 'false'", () => {
  sessionStorage.setItem(STORAGE_KEY, "false");
  expect(getHasAnonWork()).toBe(false);
});

test("returns false in an SSR context where window is undefined", () => {
  vi.stubGlobal("window", undefined);
  expect(getHasAnonWork()).toBe(false);
});
