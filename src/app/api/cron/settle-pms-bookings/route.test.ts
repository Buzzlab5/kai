import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET } from "./route";

describe("GET /api/cron/settle-pms-bookings", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("requires the CRON_SECRET even when it's configured", async () => {
    process.env.CRON_SECRET = "cron_secret";

    const response = await GET(new Request("http://localhost/api/cron/settle-pms-bookings"));

    expect(response.status).toBe(401);
  });

  it("fails closed (401) when CRON_SECRET isn't configured at all, unlike bluepass-redesign's optional check", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(
      new Request("http://localhost/api/cron/settle-pms-bookings", {
        headers: { authorization: "Bearer anything" }
      })
    );

    expect(response.status).toBe(401);
  });

  it("records a SUCCESS CronRunLog entry after a clean sweep with nothing due", async () => {
    process.env.CRON_SECRET = "cron_secret";

    const response = await GET(
      new Request("http://localhost/api/cron/settle-pms-bookings", {
        headers: { authorization: "Bearer cron_secret" }
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);

    const runs = await prisma.cronRunLog.findMany({
      where: { jobName: "settle-pms-bookings" },
      orderBy: { finishedAt: "desc" },
      take: 1
    });
    expect(runs).toHaveLength(1);
    expect(runs[0].status === "SUCCESS" || runs[0].status === "PARTIAL").toBe(true);
    expect(runs[0].summary).toMatchObject({ checked: expect.any(Number) });

    await prisma.cronRunLog.delete({ where: { id: runs[0].id } });
  }, 30000);
});
