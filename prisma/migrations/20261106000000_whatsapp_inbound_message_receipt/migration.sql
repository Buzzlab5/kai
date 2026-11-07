-- CreateTable
CREATE TABLE "WhatsAppInboundMessageReceipt" (
    "id" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "fromPhone" TEXT,
    "outcome" TEXT,
    "bluePassInquiryId" TEXT,
    "claimToken" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppInboundMessageReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppInboundMessageReceipt_providerMessageId_key" ON "WhatsAppInboundMessageReceipt"("providerMessageId");
