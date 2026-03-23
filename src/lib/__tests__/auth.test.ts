// @vitest-environment node
import { test, expect, vi, beforeEach } from "vitest";
import { jwtVerify } from "jose";

// The auth module imports "server-only" which explodes outside Next.js — defuse it
vi.mock("server-only", () => ({}));

// Track what gets shoved into the cookie jar
const cookieJar = new Map<string, { value: string; options: Record<string, unknown> }>();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    set: (name: string, value: string, options: Record<string, unknown>) => {
      cookieJar.set(name, { value, options });
    },
    get: (name: string) => cookieJar.get(name),
    delete: (name: string) => cookieJar.delete(name),
  })),
}));

beforeEach(() => {
  cookieJar.clear();
});

const JWT_SECRET = new TextEncoder().encode("development-secret-key");

test("createSession sets an auth-token cookie", async () => {
  const { createSession } = await import("@/lib/auth");

  await createSession("user-123", "hi@example.com");

  expect(cookieJar.has("auth-token")).toBe(true);
});

test("createSession signs a JWT containing userId and email", async () => {
  const { createSession } = await import("@/lib/auth");

  await createSession("user-42", "genius@dev.io");

  const { value: token } = cookieJar.get("auth-token")!;
  const { payload } = await jwtVerify(token, JWT_SECRET);

  expect(payload.userId).toBe("user-42");
  expect(payload.email).toBe("genius@dev.io");
});

test("createSession sets cookie expiry ~7 days from now", async () => {
  const { createSession } = await import("@/lib/auth");
  const before = Date.now();

  await createSession("user-1", "mortal@time.com");

  const { options } = cookieJar.get("auth-token")!;
  const expires = options.expires as Date;
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  expect(expires.getTime()).toBeGreaterThanOrEqual(before + sevenDaysMs - 1000);
  expect(expires.getTime()).toBeLessThanOrEqual(Date.now() + sevenDaysMs + 1000);
});

test("createSession marks the cookie httpOnly with path /", async () => {
  const { createSession } = await import("@/lib/auth");

  await createSession("user-99", "secretagent@spy.com");

  const { options } = cookieJar.get("auth-token")!;
  expect(options.httpOnly).toBe(true);
  expect(options.path).toBe("/");
  expect(options.sameSite).toBe("lax");
});

test("createSession produces a different token each call", async () => {
  const { createSession } = await import("@/lib/auth");

  await createSession("user-1", "a@a.com");
  const first = cookieJar.get("auth-token")!.value;

  await createSession("user-2", "b@b.com");
  const second = cookieJar.get("auth-token")!.value;

  expect(first).not.toBe(second);
});

// ─── getSession ───────────────────────────────────────────────────────────────

test("getSession returns null when no cookie exists", async () => {
  const { getSession } = await import("@/lib/auth");

  const session = await getSession();

  expect(session).toBeNull();
});

test("getSession returns the session payload from a valid token", async () => {
  const { createSession, getSession } = await import("@/lib/auth");

  await createSession("user-777", "lucky@gamble.io");
  const session = await getSession();

  expect(session).not.toBeNull();
  expect(session!.userId).toBe("user-777");
  expect(session!.email).toBe("lucky@gamble.io");
});

test("getSession returns null for a tampered token", async () => {
  const { getSession } = await import("@/lib/auth");

  // Stuff a garbage JWT into the cookie jar directly
  cookieJar.set("auth-token", { value: "this.is.garbage", options: {} });

  const session = await getSession();

  expect(session).toBeNull();
});

// ─── deleteSession ────────────────────────────────────────────────────────────

test("deleteSession removes the auth-token cookie", async () => {
  const { createSession, deleteSession } = await import("@/lib/auth");

  await createSession("user-doomed", "rip@delete.me");
  expect(cookieJar.has("auth-token")).toBe(true);

  await deleteSession();

  expect(cookieJar.has("auth-token")).toBe(false);
});

// ─── verifySession ────────────────────────────────────────────────────────────

test("verifySession returns null when request has no auth-token cookie", async () => {
  const { verifySession } = await import("@/lib/auth");

  const req = { cookies: { get: () => undefined } } as never;

  expect(await verifySession(req)).toBeNull();
});

test("verifySession returns the session payload for a valid request cookie", async () => {
  const { createSession, verifySession } = await import("@/lib/auth");

  await createSession("user-req", "request@rider.dev");
  const { value: token } = cookieJar.get("auth-token")!;

  const req = { cookies: { get: (name: string) => (name === "auth-token" ? { value: token } : undefined) } } as never;

  const session = await verifySession(req);

  expect(session).not.toBeNull();
  expect(session!.userId).toBe("user-req");
  expect(session!.email).toBe("request@rider.dev");
});

test("verifySession returns null for a forged token in the request", async () => {
  const { verifySession } = await import("@/lib/auth");

  const req = { cookies: { get: () => ({ value: "forged.jwt.payload" }) } } as never;

  expect(await verifySession(req)).toBeNull();
});
