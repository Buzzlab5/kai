-- AlterEnum
ALTER TYPE "PmsBookingPaymentAttemptStatus" ADD VALUE 'SETTLED';

-- AlterTable
ALTER TABLE "PmsBookingPaymentAttempt" ADD COLUMN     "settledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PmsBookingOperatorPayout" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pmsBookingLedgerEntryId" TEXT NOT NULL,
    "stripeConnectAccountId" TEXT NOT NULL,
    "stripeTransferId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "BluePassOperatorPayoutStatus" NOT NULL DEFAULT 'PENDING_RELEASE',
    "releasedBy" TEXT,
    "releasedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PmsBookingOperatorPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PmsBookingOperatorPayout_pmsBookingLedgerEntryId_key" ON "PmsBookingOperatorPayout"("pmsBookingLedgerEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "PmsBookingOperatorPayout_stripeTransferId_key" ON "PmsBookingOperatorPayout"("stripeTransferId");

-- CreateIndex
CREATE INDEX "PmsBookingOperatorPayout_tenantId_status_idx" ON "PmsBookingOperatorPayout"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "PmsBookingOperatorPayout" ADD CONSTRAINT "PmsBookingOperatorPayout_pmsBookingLedgerEntryId_fkey" FOREIGN KEY ("pmsBookingLedgerEntryId") REFERENCES "PmsBookingLedgerEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
