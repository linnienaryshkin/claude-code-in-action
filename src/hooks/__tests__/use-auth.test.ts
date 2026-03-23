import { renderHook, act } from "@testing-library/react";
import { test, expect, vi, beforeEach, describe } from "vitest";

// ─── Next.js router — we just want to spy on push() ──────────────────────────
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// ─── Server actions — keep the network out of unit tests ─────────────────────
const mockSignInAction = vi.fn();
const mockSignUpAction = vi.fn();
vi.mock("@/actions", () => ({
  signIn: mockSignInAction,
  signUp: mockSignUpAction,
}));

// ─── Anonymous work tracker ───────────────────────────────────────────────────
const mockGetAnonWorkData = vi.fn();
const mockClearAnonWork = vi.fn();
vi.mock("@/lib/anon-work-tracker", () => ({
  getAnonWorkData: mockGetAnonWorkData,
  clearAnonWork: mockClearAnonWork,
}));

// ─── Project actions ──────────────────────────────────────────────────────────
const mockGetProjects = vi.fn();
const mockCreateProject = vi.fn();
vi.mock("@/actions/get-projects", () => ({ getProjects: mockGetProjects }));
vi.mock("@/actions/create-project", () => ({ createProject: mockCreateProject }));

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults — override per test as needed
  mockGetAnonWorkData.mockReturnValue(null);
  mockGetProjects.mockResolvedValue([]);
  mockCreateProject.mockResolvedValue({ id: "new-project-id" });
});

// ─── Import hook after mocks are wired up ────────────────────────────────────
const { useAuth } = await import("@/hooks/use-auth");

// ══════════════════════════════════════════════════════════════════════════════
// Initial state
// ══════════════════════════════════════════════════════════════════════════════

test("isLoading starts false", () => {
  const { result } = renderHook(() => useAuth());
  expect(result.current.isLoading).toBe(false);
});

test("hook exposes signIn, signUp, and isLoading", () => {
  const { result } = renderHook(() => useAuth());
  expect(typeof result.current.signIn).toBe("function");
  expect(typeof result.current.signUp).toBe("function");
  expect(typeof result.current.isLoading).toBe("boolean");
});

// ══════════════════════════════════════════════════════════════════════════════
// signIn — loading state
// ══════════════════════════════════════════════════════════════════════════════

describe("signIn loading state", () => {
  test("sets isLoading true while in flight then resets to false", async () => {
    mockSignInAction.mockResolvedValue({ success: false, error: "bad creds" });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn("user@example.com", "password");
    });

    expect(result.current.isLoading).toBe(false);
  });

  test("resets isLoading to false even when signInAction throws", async () => {
    mockSignInAction.mockRejectedValue(new Error("network meltdown 💀"));

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn("user@example.com", "password").catch(() => {});
    });

    expect(result.current.isLoading).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// signIn — failure path
// ══════════════════════════════════════════════════════════════════════════════

describe("signIn — failure", () => {
  test("returns the error result without redirecting", async () => {
    const failResult = { success: false, error: "Invalid credentials" };
    mockSignInAction.mockResolvedValue(failResult);

    const { result } = renderHook(() => useAuth());
    let returnValue: unknown;

    await act(async () => {
      returnValue = await result.current.signIn("ghost@nobody.com", "wrongpass");
    });

    expect(returnValue).toEqual(failResult);
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockGetAnonWorkData).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// signIn — success paths (handlePostSignIn branches)
// ══════════════════════════════════════════════════════════════════════════════

describe("signIn — success with anon work", () => {
  test("creates a project from anon work, clears it, and navigates there", async () => {
    mockSignInAction.mockResolvedValue({ success: true });
    mockGetAnonWorkData.mockReturnValue({
      messages: [{ role: "user", content: "make me a button" }],
      fileSystemData: { "/": {}, "/Button.tsx": "<button/>" },
    });
    mockCreateProject.mockResolvedValue({ id: "anon-project-42" });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn("user@example.com", "password123");
    });

    expect(mockCreateProject).toHaveBeenCalledWith(
      expect.objectContaining({ messages: expect.any(Array) })
    );
    expect(mockClearAnonWork).toHaveBeenCalledOnce();
    expect(mockPush).toHaveBeenCalledWith("/anon-project-42");
    expect(mockGetProjects).not.toHaveBeenCalled();
  });

  test("does NOT migrate anon work when messages array is empty", async () => {
    mockSignInAction.mockResolvedValue({ success: true });
    mockGetAnonWorkData.mockReturnValue({ messages: [], fileSystemData: {} });
    mockGetProjects.mockResolvedValue([{ id: "existing-proj" }]);

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn("user@example.com", "password123");
    });

    expect(mockCreateProject).not.toHaveBeenCalled();
    expect(mockClearAnonWork).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith("/existing-proj");
  });
});

describe("signIn — success, no anon work, existing projects", () => {
  test("navigates to the most recent project", async () => {
    mockSignInAction.mockResolvedValue({ success: true });
    mockGetAnonWorkData.mockReturnValue(null);
    mockGetProjects.mockResolvedValue([
      { id: "proj-newest" },
      { id: "proj-older" },
    ]);

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn("user@example.com", "password123");
    });

    expect(mockPush).toHaveBeenCalledWith("/proj-newest");
    expect(mockCreateProject).not.toHaveBeenCalled();
  });
});

describe("signIn — success, no anon work, no existing projects", () => {
  test("creates a brand new project and navigates to it", async () => {
    mockSignInAction.mockResolvedValue({ success: true });
    mockGetAnonWorkData.mockReturnValue(null);
    mockGetProjects.mockResolvedValue([]);
    mockCreateProject.mockResolvedValue({ id: "fresh-canvas" });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn("newbie@example.com", "password123");
    });

    expect(mockCreateProject).toHaveBeenCalledWith(
      expect.objectContaining({ messages: [], data: {} })
    );
    expect(mockPush).toHaveBeenCalledWith("/fresh-canvas");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// signUp — mirrors signIn behaviour
// ══════════════════════════════════════════════════════════════════════════════

describe("signUp loading state", () => {
  test("resets isLoading to false after success", async () => {
    mockSignUpAction.mockResolvedValue({ success: true });
    mockGetProjects.mockResolvedValue([{ id: "proj-1" }]);

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signUp("new@user.dev", "password123");
    });

    expect(result.current.isLoading).toBe(false);
  });

  test("resets isLoading to false even when signUpAction throws", async () => {
    mockSignUpAction.mockRejectedValue(new Error("registration exploded 🧨"));

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signUp("new@user.dev", "password123").catch(() => {});
    });

    expect(result.current.isLoading).toBe(false);
  });
});

describe("signUp — failure", () => {
  test("returns the error result without side effects", async () => {
    const failResult = { success: false, error: "Email already registered" };
    mockSignUpAction.mockResolvedValue(failResult);

    const { result } = renderHook(() => useAuth());
    let returnValue: unknown;

    await act(async () => {
      returnValue = await result.current.signUp("taken@user.dev", "password123");
    });

    expect(returnValue).toEqual(failResult);
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockGetAnonWorkData).not.toHaveBeenCalled();
  });
});

describe("signUp — success with anon work", () => {
  test("migrates anon work into a new project and navigates there", async () => {
    mockSignUpAction.mockResolvedValue({ success: true });
    mockGetAnonWorkData.mockReturnValue({
      messages: [{ role: "user", content: "make me a navbar" }],
      fileSystemData: { "/": {}, "/Navbar.tsx": "<nav/>" },
    });
    mockCreateProject.mockResolvedValue({ id: "migrated-proj" });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signUp("brand@new.dev", "password123");
    });

    expect(mockCreateProject).toHaveBeenCalledOnce();
    expect(mockClearAnonWork).toHaveBeenCalledOnce();
    expect(mockPush).toHaveBeenCalledWith("/migrated-proj");
  });
});

describe("signUp — success, no anon work, no projects", () => {
  test("creates a blank project for the new user", async () => {
    mockSignUpAction.mockResolvedValue({ success: true });
    mockGetAnonWorkData.mockReturnValue(null);
    mockGetProjects.mockResolvedValue([]);
    mockCreateProject.mockResolvedValue({ id: "virgin-project" });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signUp("pristine@signup.dev", "password123");
    });

    expect(mockCreateProject).toHaveBeenCalledWith(
      expect.objectContaining({ messages: [], data: {} })
    );
    expect(mockPush).toHaveBeenCalledWith("/virgin-project");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Edge cases
// ══════════════════════════════════════════════════════════════════════════════

describe("edge cases", () => {
  test("signIn passes credentials verbatim to the action", async () => {
    mockSignInAction.mockResolvedValue({ success: false });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn("  spaces@email.com  ", "p@$$w0rd!");
    });

    expect(mockSignInAction).toHaveBeenCalledWith(
      "  spaces@email.com  ",
      "p@$$w0rd!"
    );
  });

  test("signUp passes credentials verbatim to the action", async () => {
    mockSignUpAction.mockResolvedValue({ success: false });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signUp("UPPER@CASE.COM", "MyP@ssword1");
    });

    expect(mockSignUpAction).toHaveBeenCalledWith("UPPER@CASE.COM", "MyP@ssword1");
  });

  test("concurrent signIn calls do not cross-contaminate state", async () => {
    mockSignInAction.mockResolvedValue({ success: false });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await Promise.all([
        result.current.signIn("a@a.com", "pass1"),
        result.current.signIn("b@b.com", "pass2"),
      ]);
    });

    expect(result.current.isLoading).toBe(false);
    expect(mockSignInAction).toHaveBeenCalledTimes(2);
  });
});
