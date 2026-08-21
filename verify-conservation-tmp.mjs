import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const entry = await prisma.pmsBookingLedgerEntry.findFirst({
  where: { kind: "CONSERVATION_ALLOCATION", status: "FINALIZED" },
  select: { conversationId: true },
});
console.log("conversationId:", entry.conversationId);

const before = await prisma.conversation.findUnique({ where: { id: entry.conversationId }, select: { travellerId: true } });
console.log("before travellerId:", before.travellerId);

await prisma.conversation.update({
  where: { id: entry.conversationId },
  data: { travellerId: "cmsfpb8nx0004l604deu0alj5" },
});
console.log("temporarily set travellerId for visual verification");

await prisma.$disconnect();
