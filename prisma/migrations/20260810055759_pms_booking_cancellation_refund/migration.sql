-- AlterEnum
ALTER TYPE "PmsBookingPaymentAttemptStatus" ADD VALUE 'CANCELLED_REFUNDED';

-- AlterTable
ALTER TABLE "PmsBookingPaymentAttempt" ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledBy" TEXT,
ADD COLUMN     "refundAmountCents" INTEGER,
ADD COLUMN     "refundTierPercent" INTEGER;
