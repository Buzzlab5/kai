import {
  composeAssistantReply,
  type AssistantConversationMessage,
  type AssistantLlmClient
} from "@/core/llm/assistant-reply-composer";
import { resolveBluePassCatalog, type BluePassCatalogSnapshotItem } from "@/core/bluepass/catalog";
import { isBluePassConservationQuestion, isBluePassValuePropQuestion } from "@/core/bluepass/reply";
import { isBluePassCommissionQuestion } from "./bluepass-message-flow";
import { PERSON_OFFER } from "@/core/conversation/human-handoff";

type BluePassMarketplaceComposerResult = {
  reply: string;
  source: "DETERMINISTIC" | "LLM";
};

type BluePassMarketplaceResultLike = {
  replyMode?: "CONCIERGE" | "ACTION";
  assistantContent: string;
  bluepassMatches: Array<{ name?: string | null; region?: string | null }>;
  bluepassInquiry?: {
    selectedYachtName?: string | null;
    operatorName?: string | null;
    destination?: string | null;
    dateWindow?: string | null;
    guests?: number | null;
  } | null;
};

export async function composeBluePassMarketplaceAssistantReply(input: {
  deterministicReply: string;
  latestMessage: string;
  marketplaceResult: BluePassMarketplaceResultLike;
  conversationHistory: AssistantConversationMessage[];
  llmClient?: AssistantLlmClient | null;
  catalogInput?: BluePassCatalogSnapshotItem[];
}): Promise<BluePassMarketplaceComposerResult> {
  const conciergeMode = input.marketplaceResult.replyMode === "CONCIERGE";
  const productTitles = buildMarketplaceProductTitles(input.marketplaceResult);
  // Concierge-mode replies otherwise carry zero required facts (paraphrase is fine for open chat).
  // But three question shapes have a load-bearing, non-negotiable answer that must survive rewriting
  // in every mode, or an LLM rewrite is free to replace it with something false and still pass
  // isSafeRewrite on an otherwise-empty required-facts list:
  // - commission-shaped questions: the percentages are the actual answer, not color.
  // - conservation/value questions (kai-conversation-flow-notes.md stop-the-line item A): a real
  //   conversation once got "the 5% is likely a service fee... goes towards maintaining the
  //   platform" - the exact inverse of the truth. "operator's side" / "never added to your fare" is
  //   required so a hallucinated rewrite that keeps "5%" but flips the direction still gets rejected.
  const isValueOrConservationQuestion =
    isBluePassConservationQuestion(input.latestMessage) || isBluePassValuePropQuestion(input.latestMessage);
  // A mid-enquiry reminder ("When you're ready, just tell me your dates...") is the traveller's way
  // back into their enquiry after a side question, so a rewrite has to keep it word for word.
  const enquiryReminder = input.deterministicReply.match(
    /When you're ready, (?:just tell me|just say yes|pop your details|send me your)[^.]*\./
  )?.[0];
  const requiredFacts = [
    ...(conciergeMode ? [] : buildMarketplaceRequiredFacts(input.marketplaceResult, input.deterministicReply)),
    ...(enquiryReminder ? [enquiryReminder] : []),
    // The offer of a person has to survive word for word, or a "yes" to it can't be recognised.
    ...(input.deterministicReply.includes(PERSON_OFFER) ? [PERSON_OFFER] : []),
    // The offer of a person has to survive word for word, or a "yes" to it can't be recognised.
    ...(input.deterministicReply.includes(PERSON_OFFER) ? [PERSON_OFFER] : []),
    ...(isBluePassCommissionQuestion(input.latestMessage) ? extractBluePassPercentageFacts(input.deterministicReply) : []),
    ...(isValueOrConservationQuestion ? ["operator's side", "never added to your fare"] : [])
  ];
  // Derived from the actual resolved catalog (not a hardcoded literal) so it's self-updating as
  // soon as a real catalog snapshot carries new regions - no code change needed for the next one.
  const knownRegions = Array.from(
    new Set(resolveBluePassCatalog(input.catalogInput).map((item) => item.region))
  );

  return composeAssistantReply({
    deterministicReply: input.deterministicReply,
    requiredFacts,
    latestUserMessage: input.latestMessage,
    conversationHistory: input.conversationHistory,
    llmClient: input.llmClient ?? null,
    tenantContext: {
      tenantName: "BluePass",
      // Kai's own personality (core/llm/kai-persona.ts) is the BluePass voice, so no extra tenant tone.
      brandVoice: null,
      pmsProvider: "BluePass marketplace catalogue and operator network",
      responseGuardrails: [
        conciergeMode
          ? "For discovery and travel inspiration, answer the traveller naturally first; do not force name, email, or inquiry collection until they clearly want to send an operator inquiry."
          : "For transactional inquiry replies, preserve all operational facts exactly.",
        conciergeMode
          ? "Act as a knowledgeable marine travel concierge across Australia, Indonesia and beyond: freely use your own general travel knowledge to answer questions about any destination, activity, culture, or logistics, even outside the BluePass catalogue, as long as you stay honest about what BluePass has actually vetted."
          : null,
        // kai-conversation-flow-notes.md stop-the-line item B: a real conversation, when the
        // traveller's budget didn't match any catalog yacht, volunteered "I can try to suggest
        // alternative liveaboard options... although they may not be part of the BluePass catalog" -
        // offering unvetted inventory BluePass cannot book and earns nothing on, breaking the
        // vetting promise on every page footer. General travel knowledge (seasons, regions, culture)
        // stays fine; naming or offering to find a specific non-catalog operator/vessel does not.
        "Never suggest, name, or offer to find a specific operator, vessel, or booking option that is not in the BluePass catalog - if nothing in the catalog fits the traveller's ask (budget, dates, style), say so honestly and offer to note their interest or connect them once a fit exists, instead of naming or offering to source alternatives BluePass cannot book.",
        "Do not confirm live availability, final price, payment, or booking before operator confirmation.",
        "Do not invent operator responses, payment links, dates, or live availability.",
        "If the traveller asks general questions, answer helpfully before asking for booking details."
      ].filter((line): line is string => line !== null),
      productTitles,
      knownRegions
    }
  });
}

export function buildMarketplaceProductTitles(result: BluePassMarketplaceResultLike) {
  return Array.from(
    new Set(
      [
        result.bluepassInquiry?.selectedYachtName,
        result.bluepassInquiry?.operatorName,
        ...result.bluepassMatches.map((match) => match.name)
      ].filter((value): value is string => Boolean(value))
    )
  );
}

export function buildMarketplaceRequiredFacts(result: BluePassMarketplaceResultLike, deterministicReply: string) {
  const inquiry = result.bluepassInquiry;
  const facts = [
    inquiry?.selectedYachtName,
    inquiry?.destination,
    inquiry?.dateWindow,
    inquiry?.guests ? `${inquiry.guests}` : null,
    ...result.bluepassMatches.map((match) => match.name),
    ...extractBluePassDeterministicFacts(deterministicReply)
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(facts));
}

function extractBluePassPercentageFacts(reply: string) {
  return Array.from(new Set(reply.match(/\b\d{1,3}%/g) ?? []));
}

function extractBluePassDeterministicFacts(reply: string) {
  const facts: string[] = [];

  for (const match of reply.matchAll(/^\s*\d+\.\s+([A-Z][^-:\n]+?)\s+-/gm)) {
    facts.push(match[1].trim());
  }

  for (const pattern of [
    /\bfor\s+([A-Z][A-Za-z0-9' ]+?)\s+in\s+(?:Komodo|Raja Ampat)\b/g,
    /\b(?:Great choice\s+-|Good pick\.)\s+([A-Z][A-Za-z0-9' ]+?)\s+is\b/g,
    /^([A-Z][A-Za-z0-9' ]+?)\s+is\s+(?:a|an)\s+/gm
  ]) {
    for (const match of reply.matchAll(pattern)) {
      facts.push(match[1].trim());
    }
  }

  for (const match of reply.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    facts.push(match[0]);
  }

  for (const match of reply.matchAll(/\b(?:\+?62|0)\d{8,14}\b/g)) {
    facts.push(match[0]);
  }

  const contactMatch = reply.match(/\bContact details:\s*([^,\n.]+),/i);
  if (contactMatch) {
    facts.push(contactMatch[1].trim());
  }

  const tripMatch = reply.match(/\btrip details(?:\s+as|:)\s+([^.\n]+)\./i);
  if (tripMatch) {
    const tripDetails = tripMatch[1];
    const dateMatch = tripDetails.match(/\b\d{1,2}\s+[A-Z][a-z]+(?:\s+\d{4})?\b/);
    const guestMatch = tripDetails.match(/\b\d{1,3}\s+guests?\b/i);

    if (dateMatch) facts.push(dateMatch[0]);
    if (guestMatch) facts.push(guestMatch[0]);
  }

  return facts;
}
