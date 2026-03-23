// @vitest-environment node
import { test, expect, vi, beforeEach } from "vitest";

// Defuse Next.js server-only guard before anything else loads
vi.mock("server-only", () => ({}));

// ─── Mock cookie jar (shared with auth internals) ─────────────────────────────
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

// ─── Next.js plumbing we don't care about ─────────────────────────────────────
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// redirect() throws a special NEXT_REDIRECT error in production — just track calls
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

// ─── Prisma — we're not touching a real DB in unit tests ─────────────────────
const mockFindUnique = vi.fn();
const mockCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mockFindUnique,
      create: mockCreate,
    },
  },
}));

// ─── bcrypt — hashing is irrelevant to auth logic tests ──────────────────────
const mockBcryptHash = vi.fn();
const mockBcryptCompare = vi.fn();

vi.mock("bcrypt", () => ({
  default: {
    hash: mockBcryptHash,
    compare: mockBcryptCompare,
  },
}));

// ─── Auth session helpers ─────────────────────────────────────────────────────
const mockCreateSession = vi.fn();
const mockDeleteSession = vi.fn();
const mockGetSession = vi.fn();

vi.mock("@/lib/auth", () => ({
  createSession: mockCreateSession,
  deleteSession: mockDeleteSession,
  getSession: mockGetSession,
}));

beforeEach(() => {
  cookieJar.clear();
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// signUp
// ══════════════════════════════════════════════════════════════════════════════

test("signUp rejects when email is missing", async () => {
  const { signUp } = await import("@/actions/index");

  const result = await signUp("", "password123");

  expect(result.success).toBe(false);
  expect(result.error).toMatch(/required/i);
});

test("signUp rejects when password is missing", async () => {
  const { signUp } = await import("@/actions/index");

  const result = await signUp("user@example.com", "");

  expect(result.success).toBe(false);
  expect(result.error).toMatch(/required/i);
});

test("signUp rejects passwords shorter than 8 characters", async () => {
  const { signUp } = await import("@/actions/index");

  const result = await signUp("user@example.com", "short");

  expect(result.success).toBe(false);
  expect(result.error).toMatch(/8 characters/i);
});

test("signUp rejects an already-registered email", async () => {
  const { signUp } = await import("@/actions/index");

  mockFindUnique.mockResolvedValueOnce({ id: "existing", email: "taken@example.com" });

  const result = await signUp("taken@example.com", "password123");

  expect(result.success).toBe(false);
  expect(result.error).toMatch(/already registered/i);
});

test("signUp hashes the password and creates a user on success", async () => {
  const { signUp } = await import("@/actions/index");

  mockFindUnique.mockResolvedValueOnce(null);
  mockBcryptHash.mockResolvedValueOnce("hashed-password-🔒");
  mockCreate.mockResolvedValueOnce({ id: "new-user-id", email: "fresh@user.dev" });

  const result = await signUp("fresh@user.dev", "supersecret");

  expect(result.success).toBe(true);
  expect(mockBcryptHash).toHaveBeenCalledWith("supersecret", 10);
  expect(mockCreate).toHaveBeenCalledWith({
    data: { email: "fresh@user.dev", password: "hashed-password-🔒" },
  });
  expect(mockCreateSession).toHaveBeenCalledWith("new-user-id", "fresh@user.dev");
});

test("signUp returns a generic error when something explodes internally", async () => {
  const { signUp } = await import("@/actions/index");

  mockFindUnique.mockRejectedValueOnce(new Error("DB went boom"));

  const result = await signUp("oops@crash.dev", "password123");

  expect(result.success).toBe(false);
  expect(result.error).toMatch(/error occurred/i);
});

// ══════════════════════════════════════════════════════════════════════════════
// signIn
// ══════════════════════════════════════════════════════════════════════════════

test("signIn rejects when both fields are empty", async () => {
  const { signIn } = await import("@/actions/index");

  const result = await signIn("", "");

  expect(result.success).toBe(false);
  expect(result.error).toMatch(/required/i);
});

test("signIn rejects when the user does not exist", async () => {
  const { signIn } = await import("@/actions/index");

  mockFindUnique.mockResolvedValueOnce(null);

  const result = await signIn("ghost@nobody.com", "password123");

  expect(result.success).toBe(false);
  expect(result.error).toMatch(/invalid credentials/i);
});

test("signIn rejects when the password is wrong", async () => {
  const { signIn } = await import("@/actions/index");

  mockFindUnique.mockResolvedValueOnce({ id: "user-1", email: "real@user.com", password: "hashed" });
  mockBcryptCompare.mockResolvedValueOnce(false);

  const result = await signIn("real@user.com", "wrongpassword");

  expect(result.success).toBe(false);
  expect(result.error).toMatch(/invalid credentials/i);
  // Don't leak whether the user exists vs password is wrong
  expect(result.error).not.toMatch(/user/i);
});

test("signIn creates a session on successful login", async () => {
  const { signIn } = await import("@/actions/index");

  mockFindUnique.mockResolvedValueOnce({ id: "user-1", email: "real@user.com", password: "hashed" });
  mockBcryptCompare.mockResolvedValueOnce(true);

  const result = await signIn("real@user.com", "correctpassword");

  expect(result.success).toBe(true);
  expect(mockCreateSession).toHaveBeenCalledWith("user-1", "real@user.com");
});

test("signIn returns a generic error on unexpected failure", async () => {
  const { signIn } = await import("@/actions/index");

  mockFindUnique.mockRejectedValueOnce(new Error("connection timeout 💀"));

  const result = await signIn("unlucky@timing.dev", "password123");

  expect(result.success).toBe(false);
  expect(result.error).toMatch(/error occurred/i);
});

// ══════════════════════════════════════════════════════════════════════════════
// signOut
// ══════════════════════════════════════════════════════════════════════════════

test("signOut deletes the session and redirects", async () => {
  const { signOut } = await import("@/actions/index");

  await signOut();

  expect(mockDeleteSession).toHaveBeenCalledOnce();
  expect(mockRedirect).toHaveBeenCalledWith("/");
});

// ══════════════════════════════════════════════════════════════════════════════
// getUser
// ══════════════════════════════════════════════════════════════════════════════

test("getUser returns null when there is no active session", async () => {
  const { getUser } = await import("@/actions/index");

  mockGetSession.mockResolvedValueOnce(null);

  const user = await getUser();

  expect(user).toBeNull();
  expect(mockFindUnique).not.toHaveBeenCalled();
});

test("getUser returns the user record for an authenticated session", async () => {
  const { getUser } = await import("@/actions/index");

  mockGetSession.mockResolvedValueOnce({ userId: "user-1", email: "logged@in.dev" });
  mockFindUnique.mockResolvedValueOnce({
    id: "user-1",
    email: "logged@in.dev",
    createdAt: new Date("2024-01-01"),
  });

  const user = await getUser();

  expect(user).not.toBeNull();
  expect(user!.id).toBe("user-1");
  expect(user!.email).toBe("logged@in.dev");
  expect(mockFindUnique).toHaveBeenCalledWith({
    where: { id: "user-1" },
    select: { id: true, email: true, createdAt: true },
  });
});

test("getUser returns null when the session points to a deleted user", async () => {
  const { getUser } = await import("@/actions/index");

  mockGetSession.mockResolvedValueOnce({ userId: "ghost-user", email: "gone@poof.dev" });
  mockFindUnique.mockResolvedValueOnce(null);

  const user = await getUser();

  expect(user).toBeNull();
});

test("getUser returns null and swallows errors when the DB misbehaves", async () => {
  const { getUser } = await import("@/actions/index");

  mockGetSession.mockResolvedValueOnce({ userId: "user-1", email: "survivor@chaos.dev" });
  mockFindUnique.mockRejectedValueOnce(new Error("DB is on fire 🔥"));

  const user = await getUser();

  expect(user).toBeNull();
});
