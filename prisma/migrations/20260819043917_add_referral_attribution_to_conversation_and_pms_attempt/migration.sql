-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referralLinkId" TEXT,
ADD COLUMN     "referralPartnerId" TEXT,
ADD COLUMN     "referralRole" TEXT;

-- AlterTable
ALTER TABLE "PmsBookingPaymentAttempt" ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referralLinkId" TEXT,
ADD COLUMN     "referralPartnerId" TEXT,
ADD COLUMN     "referralRole" TEXT;
