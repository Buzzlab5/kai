-- CreateEnum
CREATE TYPE "CronRunStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILURE');

-- CreateTable
CREATE TABLE "CronRunLog" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "status" "CronRunStatus" NOT NULL,
    "summary" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CronRunLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CronRunLog_jobName_finishedAt_idx" ON "CronRunLog"("jobName", "finishedAt");
