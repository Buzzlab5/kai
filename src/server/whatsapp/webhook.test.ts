import { describe, expect, it } from "vitest";
import {
  extractBluePassOperatorResponsesFromWhatsAppWebhook,
  extractWhatsAppInboundTextMessagesFromWebhook,
  extractWhatsAppMessageStatusesFromWebhook
} from "./webhook";

describe("extractBluePassOperatorResponsesFromWhatsAppWebhook", () => {
  it("extracts BluePass operator quick reply button payloads", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285337210180",
                    id: "wamid.operator.accept",
                    type: "interactive",
                    interactive: {
                      type: "button_reply",
                      button_reply: {
                        id: "accept:inquiry_123",
                        title: "Accept"
                      }
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(responses).toEqual([
      {
        inquiryId: "inquiry_123",
        action: "accept",
        providerMessageId: "wamid.operator.accept",
        operatorPhone: "6285337210180",
        counterText: null
      }
    ]);
  });

  it("extracts counter details from operator free text replies", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285337210180",
                    id: "wamid.operator.counter",
                    type: "text",
                    text: {
                      body: "counter:inquiry_456 Available 21 July instead at USD 48,000"
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(responses).toEqual([
      {
        inquiryId: "inquiry_456",
        action: "counter",
        providerMessageId: "wamid.operator.counter",
        operatorPhone: "6285337210180",
        counterText: "Available 21 July instead at USD 48,000"
      }
    ]);
  });

  it("treats natural counter details as a counter reply without exposing an internal id", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285337210180",
                    id: "wamid.operator.natural_counter",
                    type: "text",
                    text: {
                      body: "Available 18 July 2026. Final price USD 3,900 per cabin/night for 4 guests. Includes full board meals. Excludes flights. Condition: 30% deposit."
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(responses).toEqual([
      {
        inquiryId: null,
        action: "counter",
        providerMessageId: "wamid.operator.natural_counter",
        operatorPhone: "6285337210180",
        counterText:
          "Available 18 July 2026. Final price USD 3,900 per cabin/night for 4 guests. Includes full board meals. Excludes flights. Condition: 30% deposit."
      }
    ]);
  });

  it("treats a price quote mentioning a deposit-to-hold condition as a counter reply, not payment-ready", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285337210180",
                    id: "wamid.operator.deposit_to_hold",
                    type: "text",
                    text: {
                      body: "Available 29 July 2026. Final price USD 3,900 per cabin/night. Includes meals, dives, crew, tanks and weights. Excludes flights, park fees, alcohol and tips. Condition: 30% deposit to hold."
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(responses).toEqual([
      {
        inquiryId: null,
        action: "counter",
        providerMessageId: "wamid.operator.deposit_to_hold",
        operatorPhone: "6285337210180",
        counterText:
          "Available 29 July 2026. Final price USD 3,900 per cabin/night. Includes meals, dives, crew, tanks and weights. Excludes flights, park fees, alcohol and tips. Condition: 30% deposit to hold."
      }
    ]);
  });

  it("treats short availability replies as operator accept replies", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285337210180",
                    id: "wamid.operator.natural_accept",
                    type: "text",
                    text: {
                      body: "Yes available, we can do it."
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(responses).toEqual([
      {
        inquiryId: null,
        action: "accept",
        providerMessageId: "wamid.operator.natural_accept",
        operatorPhone: "6285337210180",
        counterText: null
      }
    ]);
  });

  it("does not treat traveller-style alternative permission as an operator accept reply", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285156246329",
                    id: "wamid.traveller.alt_permission",
                    type: "text",
                    text: {
                      body: "yes send the alternative"
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(responses).toEqual([]);
  });

  it("does not treat traveller yacht selection as an operator reply", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285156246329",
                    id: "wamid.traveller.alt_selection",
                    type: "text",
                    text: {
                      body: "try Alila Purnama"
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(responses).toEqual([]);
  });

  it("treats short sold-out replies as operator decline replies", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285337210180",
                    id: "wamid.operator.natural_decline",
                    type: "text",
                    text: {
                      body: "20 July full, sorry."
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(responses).toEqual([
      {
        inquiryId: null,
        action: "decline",
        providerMessageId: "wamid.operator.natural_decline",
        operatorPhone: "6285337210180",
        counterText: null
      }
    ]);
  });

  it("treats operator hold and payment details as a payment-ready reply", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285337210180",
                    id: "wamid.operator.payment_ready",
                    type: "text",
                    text: {
                      body: "Slot held for 22 July. Payment link: https://pay.example/cj-22. Deposit 30% due today. Booking reference CJ-2207."
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(responses).toEqual([
      {
        inquiryId: null,
        action: "payment_ready",
        providerMessageId: "wamid.operator.payment_ready",
        operatorPhone: "6285337210180",
        counterText:
          "Slot held for 22 July. Payment link: https://pay.example/cj-22. Deposit 30% due today. Booking reference CJ-2207."
      }
    ]);
  });

  it("treats short operator payment link replies as payment-ready details", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285337210180",
                    id: "wamid.operator.short_payment_ready",
                    type: "text",
                    text: {
                      body: "Pay here: https://pay.example/cj-22. Ref CJ-2207. Slot on 22 July."
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(responses).toEqual([
      {
        inquiryId: null,
        action: "payment_ready",
        providerMessageId: "wamid.operator.short_payment_ready",
        operatorPhone: "6285337210180",
        counterText: "Pay here: https://pay.example/cj-22. Ref CJ-2207. Slot on 22 July."
      }
    ]);
  });

  it("treats operator payment received and booking confirmation as a booking-confirmed reply", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285337210180",
                    id: "wamid.operator.booking_confirmed",
                    type: "text",
                    text: {
                      body: "Payment received. Booking confirmed for 22 July. Booking reference CJ-2207."
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(responses).toEqual([
      {
        inquiryId: null,
        action: "booking_confirmed",
        providerMessageId: "wamid.operator.booking_confirmed",
        operatorPhone: "6285337210180",
        counterText: "Payment received. Booking confirmed for 22 July. Booking reference CJ-2207."
      }
    ]);
  });

  it("treats short paid booking replies as booking-confirmed details", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285337210180",
                    id: "wamid.operator.short_booking_confirmed",
                    type: "text",
                    text: {
                      body: "Payment done, booking ok. Ref CJ-2207."
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(responses).toEqual([
      {
        inquiryId: null,
        action: "booking_confirmed",
        providerMessageId: "wamid.operator.short_booking_confirmed",
        operatorPhone: "6285337210180",
        counterText: "Payment done, booking ok. Ref CJ-2207."
      }
    ]);
  });

  it("extracts Meta button payload replies", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285337210180",
                    id: "wamid.operator.button",
                    type: "button",
                    button: {
                      payload: "accept:inquiry_789",
                      text: "Accept"
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(responses).toEqual([
      {
        inquiryId: "inquiry_789",
        action: "accept",
        providerMessageId: "wamid.operator.button",
        operatorPhone: "6285337210180",
        counterText: null
      }
    ]);
  });

  it("does not treat a traveller's 'Send inquiry' button tap as an operator reply", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285156246329",
                    id: "wamid.traveller.send_inquiry_tap",
                    type: "interactive",
                    interactive: {
                      type: "button_reply",
                      button_reply: {
                        id: "Send inquiry",
                        title: "Send inquiry"
                      }
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(responses).toEqual([]);
  });

  it("extracts text-only button replies so the route can resolve latest operator context", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285337210180",
                    id: "wamid.operator.button_text",
                    type: "button",
                    button: {
                      text: "Accept"
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(responses).toEqual([
      {
        inquiryId: null,
        action: "accept",
        providerMessageId: "wamid.operator.button_text",
        operatorPhone: "6285337210180",
        counterText: null
      }
    ]);
  });
});

describe("extractWhatsAppInboundTextMessagesFromWebhook", () => {
  it("extracts a traveller's tapped interactive button reply as conversational context", () => {
    const messages = extractWhatsAppInboundTextMessagesFromWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285156246329",
                    id: "wamid.traveller.button_tap",
                    type: "interactive",
                    interactive: {
                      type: "button_reply",
                      button_reply: {
                        id: "Send inquiry",
                        title: "Send inquiry"
                      }
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(messages).toEqual([
      {
        from: "6285156246329",
        providerMessageId: "wamid.traveller.button_tap",
        body: "Send inquiry"
      }
    ]);
  });

  it("extracts ordinary inbound WhatsApp text messages for conversational context", () => {
    const messages = extractWhatsAppInboundTextMessagesFromWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285156246329",
                    id: "wamid.traveller.status",
                    type: "text",
                    text: {
                      body: "what is my booking status?"
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(messages).toEqual([
      {
        from: "6285156246329",
        providerMessageId: "wamid.traveller.status",
        body: "what is my booking status?"
      }
    ]);
  });

  it("does not treat empty text messages as conversational context", () => {
    const messages = extractWhatsAppInboundTextMessagesFromWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "6285156246329",
                    id: "wamid.empty",
                    type: "text",
                    text: {
                      body: "   "
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(messages).toEqual([]);
  });
});

describe("extractWhatsAppMessageStatusesFromWebhook", () => {
  it("extracts Meta delivery statuses for outbound traveller messages", () => {
    const statuses = extractWhatsAppMessageStatusesFromWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  {
                    id: "wamid.traveller.accept",
                    status: "failed",
                    timestamp: "1780000000",
                    recipient_id: "6285156246329",
                    errors: [
                      {
                        code: 131026,
                        title: "Message undeliverable",
                        message: "Message was not delivered.",
                        error_data: {
                          details: "Recipient phone number is not in the allowed list."
                        }
                      }
                    ]
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(statuses).toEqual([
      {
        providerMessageId: "wamid.traveller.accept",
        status: "failed",
        timestamp: "1780000000",
        recipientId: "6285156246329",
        errors: [
          {
            code: 131026,
            title: "Message undeliverable",
            message: "Message was not delivered.",
            details: "Recipient phone number is not in the allowed list."
          }
        ]
      }
    ]);
  });
});

describe("strict known-operator parsing", () => {
  const availabilityPriceText = {
    from: "6285156246329",
    id: "wamid.traveller.availability_price",
    type: "text",
    text: { body: "Is the boat available on 20 July and what is the price?" }
  };
  const payloadWith = (message: unknown) => ({
    entry: [{ changes: [{ value: { messages: [message] } }] }]
  });

  it("leaves traveller availability/price questions out of operator replies when the sender is not a known operator", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook(payloadWith(availabilityPriceText), {
      knownOperatorPhones: ["+6285337210180"]
    });

    expect(responses).toEqual([]);
  });

  it("parses the same availability/price text as an operator counter when the sender holds a dispatch", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook(
      payloadWith({ ...availabilityPriceText, from: "6285337210180", text: { body: "Available 20 July. Price USD 3,900." } }),
      { knownOperatorPhones: ["+6285337210180"] }
    );

    expect(responses).toEqual([
      {
        inquiryId: null,
        action: "counter",
        providerMessageId: "wamid.traveller.availability_price",
        operatorPhone: "6285337210180",
        counterText: "Available 20 July. Price USD 3,900."
      }
    ]);
  });

  it("matches known operators across stored phone formats", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook(
      payloadWith({ from: "+6285337210180", id: "wamid.operator.fmt", type: "text", text: { body: "accept" } }),
      { knownOperatorPhones: ["085337210180"] }
    );

    expect(responses).toHaveLength(1);
    expect(responses[0]?.action).toBe("accept");
  });

  it("still extracts explicit action:inquiryId commands from unknown senders so ownership can reject them downstream", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook(
      payloadWith({
        from: "6285156246329",
        id: "wamid.stranger.accept",
        type: "text",
        text: { body: "accept:inq_123" }
      }),
      { knownOperatorPhones: [] }
    );

    expect(responses).toEqual([
      {
        inquiryId: "inq_123",
        action: "accept",
        providerMessageId: "wamid.stranger.accept",
        operatorPhone: "6285156246329",
        counterText: null
      }
    ]);
  });

  it("keeps legacy ungated parsing when no known-operator set is supplied", () => {
    const responses = extractBluePassOperatorResponsesFromWhatsAppWebhook(payloadWith(availabilityPriceText));

    expect(responses).toHaveLength(1);
    expect(responses[0]?.action).toBe("counter");
  });
});
