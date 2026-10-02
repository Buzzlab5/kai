/**
 * Runs everyday traveller messages through Kai's BluePass marketplace flow and prints the scripted
 * replies, so a voice change can be read side by side. No LLM and no database needed.
 *
 *   npx tsx scripts/kai-voice-probe.ts
 */
import { handleBluePassMarketplaceMessage } from "@/server/bluepass/bluepass-message-flow";

const probes: Array<{ message: string; history?: string[] }> = [
  { message: "hi" },
  { message: "how's it going?", history: ["looking at komodo liveaboards"] },
  { message: "thanks heaps", history: ["looking at komodo liveaboards"] },
  { message: "Do I need to be a certified diver?" },
  { message: "What about Sulawesi, do you know any boats?" },
  { message: "Why should I book through BluePass?" },
  { message: "What commission do you take?" },
  { message: "Where does the 5% go?" },
  { message: "these are too expensive", history: ["komodo liveaboards please"] },
  { message: "start over", history: ["komodo liveaboards please"] },
  { message: "Show me boats in Komodo" },
  { message: "I'd like to book Alila Purnama" },
  {
    message: "19 July, 2 of us. I'm Maya Chen, maya@example.com, +61 400 111 222",
    history: ["I'd like to book Alila Purnama"]
  }
];

async function main() {
  for (const probe of probes) {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: "voice-probe",
      conversationId: "voice-probe",
      content: probe.message,
      priorTravellerMessages: probe.history ?? []
    });
    const context = probe.history?.length ? ` (after: "${probe.history.join('" / "')}")` : "";

    process.stdout.write(`Traveller: ${probe.message}${context}\nKai: ${result.assistantContent}\n\n`);
  }

  process.exit(0);
}

void main();
