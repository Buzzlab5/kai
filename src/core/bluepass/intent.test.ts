import { describe, expect, it } from "vitest";
import {
  extractBluePassInquiryIntent,
  getMissingBluePassInquiryFields,
  extractBluePassGuestCount
} from "./intent";

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

  it("recognizes a day and month typed with no space between them", () => {
    const intent = extractBluePassInquiryIntent(["28july for 2 people"]);

    expect(intent).toMatchObject({
      dateWindow: "28 July",
      guests: 2
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

  it("preserves an explicitly stated AUD budget instead of relabeling it as USD", () => {
    const intent = extractBluePassInquiryIntent(["my budget is AUD 5000 for the trip"]);

    expect(intent.budget).toBe("AUD 5000");
  });

  it("recognizes a known region beyond Komodo/Raja Ampat when passed explicitly", () => {
    const intent = extractBluePassInquiryIntent(
      ["looking for a trip to Great Barrier Reef"],
      ["Komodo", "Raja Ampat", "Great Barrier Reef"]
    );

    expect(intent.destination).toBe("Great Barrier Reef");
  });

  it("uses the most recently mentioned destination instead of always preferring Raja Ampat", () => {
    const intent = extractBluePassInquiryIntent([
      "any recommendation for raja ampat?",
      "in komodo please"
    ]);

    expect(intent.destination).toBe("Komodo");
  });

  it("switches back to Raja Ampat when it is mentioned after Komodo", () => {
    const intent = extractBluePassInquiryIntent(["in komodo please", "actually raja ampat"]);

    expect(intent.destination).toBe("Raja Ampat");
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

describe("extractBluePassGuestCount", () => {
  it("understands the everyday ways travellers give a group size", () => {
    expect(extractBluePassGuestCount("8 guests")).toBe(8);
    expect(extractBluePassGuestCount("four people")).toBe(4);
    expect(extractBluePassGuestCount("19 July, 2 of us")).toBe(2);
    expect(extractBluePassGuestCount("there's six of us")).toBe(6);
    expect(extractBluePassGuestCount("2 adults and 2 kids")).toBe(4);
    expect(extractBluePassGuestCount("just me this time")).toBe(1);
    expect(extractBluePassGuestCount("me and my partner")).toBe(2);
    expect(extractBluePassGuestCount("my wife and I")).toBe(2);
  });

  it("doesn't guess when the phrasing isn't really a headcount", () => {
    expect(extractBluePassGuestCount("one of us gets seasick")).toBeUndefined();
    expect(extractBluePassGuestCount("we have 2 kids")).toBeUndefined();
    expect(extractBluePassGuestCount("me and my partner and our kids")).toBeUndefined();
    expect(extractBluePassGuestCount("19 July")).toBeUndefined();
  });
});

describe("bare phone numbers", () => {
  it("recognises a phone number without the word 'phone' in front of it", () => {
    expect(extractBluePassInquiryIntent(["I'm Maya Chen, maya@example.com, +61 400 111 222"]).travellerPhone).toBe(
      "+61 400 111 222"
    );
    expect(extractBluePassInquiryIntent(["call me on 0400 111 222"]).travellerPhone).toBe("0400 111 222");
    expect(extractBluePassInquiryIntent(["wa saya 081234567890"]).travellerPhone).toBe("081234567890");
  });

  it("doesn't mistake prices, dates or group sizes for a phone number", () => {
    const intent = extractBluePassInquiryIntent(["19 July 2026 for 4 people, budget USD 10000"]);
    expect(intent.travellerPhone).toBeUndefined();
  });
});
