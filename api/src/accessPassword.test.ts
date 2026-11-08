import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

describe("access password", () => {
  const app = createApp({ accessPassword: "s3cret" });

  it("rejects API calls without the password", async () => {
    const res = await app.request("/api/stats");
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("password_required");
  });

  it("rejects a wrong password", async () => {
    const res = await app.request("/api/stats", { headers: { "X-App-Password": "nope" } });
    expect(res.status).toBe(401);
  });

  it("accepts the right password", async () => {
    const res = await app.request("/api/stats", { headers: { "X-App-Password": "s3cret" } });
    expect(res.status).not.toBe(401);
  });

  it("keeps /api/health open", async () => {
    expect((await app.request("/api/health")).status).toBe(200);
  });

  it("/api/access checks the password", async () => {
    expect((await app.request("/api/access")).status).toBe(401);
    expect((await app.request("/api/access", { headers: { "X-App-Password": "s3cret" } })).status).toBe(200);
  });

  it("does nothing when no password is configured", async () => {
    const open = createApp({ accessPassword: "" });
    expect((await open.request("/api/stats")).status).not.toBe(401);
    expect(await (await open.request("/api/access")).json()).toEqual({ ok: true, required: false });
  });
});
