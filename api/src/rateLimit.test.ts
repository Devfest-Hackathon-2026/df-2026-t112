import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { rateLimit } from "./rateLimit.js";

describe("rateLimit", () => {
  const make = (now: () => number) => {
    const app = new Hono();
    app.use("*", rateLimit({ limit: 2, windowMs: 1000, now }));
    app.get("/", (c) => c.text("ok"));
    return app;
  };
  const get = (app: Hono, ip: string) => app.request("/", { headers: { "x-forwarded-for": ip } });

  it("blocks after the limit, per client, and resets after the window", async () => {
    let t = 0;
    const app = make(() => t);
    expect((await get(app, "1.1.1.1")).status).toBe(200);
    expect((await get(app, "1.1.1.1")).status).toBe(200);
    const blocked = await get(app, "1.1.1.1");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("1");
    expect((await get(app, "2.2.2.2")).status).toBe(200);
    t = 1001;
    expect((await get(app, "1.1.1.1")).status).toBe(200);
  });
});
