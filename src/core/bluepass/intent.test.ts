import { describe, expect, it } from "vitest";
import { extractBluePassInquiryIntent, getMissingBluePassInquiryFields } from "./intent";

describe("BluePass inquiry intent", () => {
  it("extracts traveller and trip fields from message history", () => {
    const intent = extractBluePassInquiryIntent([
      "I want a Komodo yacht for 8 guests next month around USD 10000",
      "My name is Maya Chen, email maya@example.com, phone +61 400 111 222"
    ]);

    expect(intent).toMatchObject({
      destination: "Komodo",
      dateWindow: "next month",
      guests: 8,
      budget: "USD 10000",
      travellerName: "Maya Chen",
      travellerEmail: "maya@example.com",
      travellerPhone: "+61 400 111 222"
    });
  });

  it("preserves full day month year date windows", () => {
    const intent = extractBluePassInquiryIntent([
      "for 29th june 2026, 4 people my name is Eka, email is eka@gmail.com, and phone is 0876634231987"
    ]);

    expect(intent).toMatchObject({
      dateWindow: "29 June 2026",
      guests: 4,
      travellerName: "Eka",
      travellerEmail: "eka@gmail.com",
      travellerPhone: "0876634231987"
    });
  });

  it("preserves full ordinal of month date windows", () => {
    const intent = extractBluePassInquiryIntent([
      "for 6th of july 2026, 4 people my name is Inova, email is inova@gmail.com, and whatsapp number is 085156246329"
    ]);

    expect(intent).toMatchObject({
      dateWindow: "6 July 2026",
      guests: 4,
      travellerName: "Inova",
      travellerEmail: "inova@gmail.com",
      travellerPhone: "085156246329"
    });
  });

  it("extracts phone when traveller says WhatsApp number is", () => {
    const intent = extractBluePassInquiryIntent([
      "my name is Inov, email is inoveka@gmail.com, and whatsapp number is 085156246329"
    ]);

    expect(intent).toMatchObject({
      travellerName: "Inov",
      travellerEmail: "inoveka@gmail.com",
      travellerPhone: "085156246329"
    });
  });

  it("captures Australian destinations so the AU inquiry funnel can complete", () => {
    const intent = extractBluePassInquiryIntent([
      "diving the Great Barrier Reef in June, 6 guests, I'm Sam, sam@x.com"
    ]);
    expect(intent.destination).toBe("Great Barrier Reef");
    expect(intent.guests).toBe(6);
    // destination is captured, so it is no longer a missing field
    expect(getMissingBluePassInquiryFields(intent)).not.toContain("destination");
    // other AU regions resolve too
    expect(extractBluePassInquiryIntent(["Ningaloo whale sharks next week"]).destination).toBe("Ningaloo Reef");
    expect(extractBluePassInquiryIntent(["charter on the Whitsundays"]).destination).toBe("Whitsundays");
    // Indonesian behaviour is unchanged (Indonesia still wins when both are relevant)
    expect(extractBluePassInquiryIntent(["a Komodo liveaboard"]).destination).toBe("Komodo");
  });

  it("reports required missing fields", () => {
    expect(
      getMissingBluePassInquiryFields({
        destination: "Komodo",
        guests: 8
      })
    ).toEqual(["dateWindow", "travellerName", "travellerEmail", "travellerPhone"]);
  });
});
