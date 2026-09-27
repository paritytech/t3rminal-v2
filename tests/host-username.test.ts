import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const inHost = vi.fn(() => true);
const getUserId = vi.fn();

vi.mock("@/lib/host/detect", () => ({ isInHost: () => inHost() }));
vi.mock("@/lib/host/connection", () => ({
  getAccountsProvider: () => ({ getUserId: getUserId.mock.calls ? getUserId : undefined }),
}));

const { getHostUsername, resetHostUsernameCache } = await import("@/lib/host/username");

/** The wrapper hands back a neverthrow ResultAsync; only `.match` is used. */
const ok = (primaryUsername: string) => ({
  match: async <T>(onOk: (v: { primaryUsername: string }) => T) => onOk({ primaryUsername }),
});
const err = (error: unknown) => ({
  match: async <T>(_onOk: unknown, onErr: (e: unknown) => T) => onErr(error),
});

beforeEach(() => {
  resetHostUsernameCache();
  inHost.mockReturnValue(true);
  getUserId.mockReset();
});
afterEach(() => resetHostUsernameCache());

describe("getHostUsername", () => {
  it("returns the alias the host reports, trimmed", async () => {
    getUserId.mockReturnValue(ok("  todor.001  "));
    await expect(getHostUsername()).resolves.toEqual({ status: "ready", username: "todor.001" });
  });

  it("treats an empty answer as no alias set", async () => {
    getUserId.mockReturnValue(ok("   "));
    await expect(getHostUsername()).resolves.toEqual({ status: "none" });
  });

  it("separates 'no username set' from 'the person declined'", async () => {
    getUserId.mockReturnValue(err({ name: "GetUserIdErr::NotConnected" }));
    await expect(getHostUsername()).resolves.toEqual({ status: "none" });

    resetHostUsernameCache();
    getUserId.mockReturnValue(err({ name: "GetUserIdErr::PermissionDenied" }));
    await expect(getHostUsername()).resolves.toEqual({ status: "denied" });
  });

  it("reads a generic refusal as 'not shared', however the host spells it", async () => {
    // The e2e test host answers Unknown + "call denied by host" rather than
    // the typed PermissionDenied; a merchant needs one answer for both.
    getUserId.mockReturnValue(
      err({ name: "GetUserIdErr::Unknown", payload: { reason: "call denied by host" } }),
    );
    await expect(getHostUsername()).resolves.toEqual({ status: "denied" });
  });

  it("carries the host's own words for anything else", async () => {
    getUserId.mockReturnValue(err({ name: "GetUserIdErr::Unknown", payload: { reason: "boom" } }));
    await expect(getHostUsername()).resolves.toEqual({ status: "error", reason: "boom" });
  });

  it("never throws when the call itself blows up", async () => {
    getUserId.mockImplementation(() => {
      throw new Error("no transport");
    });
    await expect(getHostUsername()).resolves.toMatchObject({ status: "error" });
  });

  it("is unavailable outside a host, and asks the host only once per session", async () => {
    inHost.mockReturnValue(false);
    await expect(getHostUsername()).resolves.toEqual({ status: "unavailable" });
    expect(getUserId).not.toHaveBeenCalled();

    // The call prompts for the identity permission, so a second read must not
    // re-ask — it reuses the settled answer.
    resetHostUsernameCache();
    inHost.mockReturnValue(true);
    getUserId.mockReturnValue(ok("todor"));
    await getHostUsername();
    await getHostUsername();
    expect(getUserId).toHaveBeenCalledTimes(1);
  });
});
