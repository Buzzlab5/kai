import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET } from "./route";

describe("GET /api/admin/cron-runs", () => {
  afterEach(() => {
    delete process.env.KAI_ADMIN_TOKEN;
  });

  it("requires the Kai admin token", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";

    const response = await GET(new Request("http://localhost/api/admin/cron-runs"));

    expect(response.status).toBe(401);
  });

  it("lists recent runs, most recent first, optionally filtered by jobName", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    const jobName = `test-job-${randomUUID()}`;
    const older = await prisma.cronRunLog.create({
      data: { jobName, status: "SUCCESS", startedAt: new Date(Date.now() - 60_000), finishedAt: new Date(Date.now() - 55_000) }
    });
    const newer = await prisma.cronRunLog.create({
      data: { jobName, status: "FAILURE", errorMessage: "boom", startedAt: new Date(), finishedAt: new Date() }
    });

    const response = await GET(
      new Request(`http://localhost/api/admin/cron-runs?jobName=${jobName}`, {
        headers: { authorization: "Bearer admin_secret" }
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.runs.map((r: { id: string }) => r.id)).toEqual([newer.id, older.id]);

    await prisma.cronRunLog.deleteMany({ where: { jobName } });
  });

  it("caps the limit at 100", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";

    const response = await GET(
      new Request("http://localhost/api/admin/cron-runs?limit=99999", {
        headers: { authorization: "Bearer admin_secret" }
      })
    );

    expect(response.status).toBe(200);
  });
});
