import { describe, expect, it, vi } from "vitest";
import { RezdyAgentPmsAdapter } from "./rezdy-agent-pms-adapter";

describe("RezdyAgentPmsAdapter", () => {
  it("exposes a distinct provider identity from Supplier API's RezdyPmsAdapter", async () => {
    const adapter = new RezdyAgentPmsAdapter();

    expect(adapter.provider).toBe("REZDY_AGENT");
    await expect(adapter.listProducts()).rejects.toThrow(
      "REZDY_AGENT PMS adapter requires baseUrl, apiKey, and productListPath before live calls."
    );
  });

  it("maps marketplace products with supplier identity, region, price, and image for Discover sync", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          products: [
            {
              productCode: "AGT-100",
              name: "Whitsundays Sunset Sail",
              description: "A relaxed sunset sail through the Whitsundays.",
              supplierName: "Whitsunday Sailing Co",
              supplierId: "SUP-42",
              region: "Whitsundays",
              currency: "AUD",
              priceOptions: [{ label: "Adult", price: 189 }],
              images: [
                { itemUrl: "https://example.test/thumb.jpg", largeSizeUrl: "https://example.test/large.jpg", isPrimary: false },
                { itemUrl: "https://example.test/thumb2.jpg", largeSizeUrl: "https://example.test/large2.jpg", isPrimary: true }
              ]
            },
            {
              productCode: "AGT-101",
              name: "Reef Snorkel Day Trip"
            }
          ]
        }),
        { status: 200 }
      );
    });
    const adapter = new RezdyAgentPmsAdapter({
      baseUrl: "https://api.rezdy.com/v1",
      apiKey: "agent-secret",
      productListPath: "/products/marketplace",
      fetcher
    });

    await expect(adapter.listMarketplaceProducts()).resolves.toEqual([
      {
        productCode: "AGT-100",
        name: "Whitsundays Sunset Sail",
        description: "A relaxed sunset sail through the Whitsundays.",
        supplierName: "Whitsunday Sailing Co",
        supplierId: "SUP-42",
        region: "Whitsundays",
        priceFrom: 189,
        currency: "AUD",
        imageUrl: "https://example.test/large2.jpg",
        productUrl: null,
        raw: expect.objectContaining({ productCode: "AGT-100" })
      },
      {
        productCode: "AGT-101",
        name: "Reef Snorkel Day Trip",
        description: "",
        supplierName: "",
        supplierId: "",
        region: "",
        priceFrom: null,
        currency: "AUD",
        imageUrl: null,
        productUrl: null,
        raw: expect.objectContaining({ productCode: "AGT-101" })
      }
    ]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url] = fetcher.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://api.rezdy.com/v1/products/marketplace?limit=100&offset=0&apiKey=agent-secret");
  });

  it("pages through more than one page of marketplace products", async () => {
    const makeProduct = (index: number) => ({ productCode: `AGT-${index}`, name: `Product ${index}` });
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const offset = Number(new URL(url as string).searchParams.get("offset"));
      const products = offset === 0 ? Array.from({ length: 100 }, (_, i) => makeProduct(i)) : [makeProduct(100)];
      return new Response(JSON.stringify({ products }), { status: 200 });
    });
    const adapter = new RezdyAgentPmsAdapter({
      baseUrl: "https://api.rezdy.com/v1",
      apiKey: "agent-secret",
      productListPath: "/products/marketplace",
      fetcher
    });

    const products = await adapter.listMarketplaceProducts();

    expect(products).toHaveLength(101);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new URL((fetcher.mock.calls[0] as unknown as [string])[0]).searchParams.get("offset")).toBe("0");
    expect(new URL((fetcher.mock.calls[1] as unknown as [string])[0]).searchParams.get("offset")).toBe("100");
  });

  it("checks availability with product code and local date query parameters, same shape as Supplier API", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          sessions: [
            {
              productCode: "AGT-001",
              startTimeLocal: "2026-09-10 09:00:00",
              seatsAvailable: 6,
              priceOptions: [{ label: "Adult", price: 199 }]
            }
          ]
        }),
        { status: 200 }
      );
    });
    const adapter = new RezdyAgentPmsAdapter({
      baseUrl: "https://api.rezdy.com/v1",
      apiKey: "agent-secret",
      availabilityPath: "/availability",
      fetcher
    });

    await expect(
      adapter.getAvailability({ productId: "AGT-001", date: "2026-09-10", guests: 2 })
    ).resolves.toEqual({
      productId: "AGT-001",
      date: "2026-09-10 09:00:00",
      available: true,
      remaining: 6,
      currency: "AUD",
      unitPriceCents: 19900,
      timeOptions: [{ label: "9:00 AM", startTimeLocal: "2026-09-10 09:00:00", remaining: 6 }],
      ticketOptions: [{ label: "Adult", unitPriceCents: 19900 }]
    });

    const [url] = fetcher.mock.calls[0] as unknown as [string];
    expect(url).toContain("https://api.rezdy.com/v1/availability?");
    expect(url).toContain("apiKey=agent-secret");
    expect(url).toContain("productCode=AGT-001");
  });

  it("reports unavailable with no live call side effects when no session matches", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ sessions: [] }), { status: 200 }));
    const adapter = new RezdyAgentPmsAdapter({
      baseUrl: "https://api.rezdy.com/v1",
      apiKey: "agent-secret",
      availabilityPath: "/availability",
      fetcher
    });

    await expect(
      adapter.getAvailability({ productId: "AGT-002", date: "2026-09-11", guests: 4 })
    ).resolves.toEqual({
      productId: "AGT-002",
      date: "2026-09-11 00:00:00",
      available: false,
      remaining: 0,
      currency: "AUD",
      unitPriceCents: 0
    });
  });

  it("creates a booking request with product, session, quantity, and traveller contact", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ order: { orderNumber: "AGT-ORDER-1", status: "PROCESSING" } }), {
        status: 200
      });
    });
    const adapter = new RezdyAgentPmsAdapter({
      baseUrl: "https://api.rezdy.com/v1",
      apiKey: "agent-secret",
      bookingPath: "/bookings",
      fetcher
    });

    await expect(
      adapter.createBooking({
        productId: "AGT-001",
        date: "2026-09-10 09:00:00",
        guests: 2,
        travellerName: "Maya Chen",
        travellerEmail: "maya@example.com",
        travellerPhone: "+61 400 111 222"
      })
    ).resolves.toEqual({
      externalBookingId: "AGT-ORDER-1",
      provider: "REZDY_AGENT",
      status: "PENDING"
    });

    const [url, requestInit] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.rezdy.com/v1/bookings?apiKey=agent-secret");
    expect(requestInit.method).toBe("POST");
    expect(JSON.parse(requestInit.body as string)).toEqual({
      customer: {
        firstName: "Maya",
        lastName: "Chen",
        email: "maya@example.com",
        phone: "+61 400 111 222"
      },
      items: [
        {
          productCode: "AGT-001",
          startTimeLocal: "2026-09-10 09:00:00",
          quantities: [{ optionLabel: "Adult", value: 2 }]
        }
      ],
      resellerComments: "Created by Kai (BluePass Agent) after traveller confirmation."
    });
  });

  const confirmRequest = {
    productId: "AGT-001",
    date: "2026-09-10 09:00:00",
    guests: 2,
    travellerName: "Raga Test",
    travellerEmail: "raga@example.com",
    travellerPhone: "085664326198",
    ticketQuantities: [{ optionLabel: "Adult", quantity: 2 }]
  };

  it("confirms a reserved booking with a full-resource PUT replace, including a payments array Rezdy requires for full-payment-to-agent", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ order: { orderNumber: "AGT-ORDER-1", status: "CONFIRMED" } }), {
        status: 200
      });
    });
    const adapter = new RezdyAgentPmsAdapter({
      baseUrl: "https://api.rezdy.com/v1",
      apiKey: "agent-secret",
      bookingPath: "/bookings",
      fetcher
    });

    await expect(adapter.confirmBooking("AGT-ORDER-1", confirmRequest)).resolves.toEqual({
      externalBookingId: "AGT-ORDER-1",
      provider: "REZDY_AGENT",
      status: "CONFIRMED"
    });

    const [url, requestInit] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.rezdy.com/v1/bookings/AGT-ORDER-1?apiKey=agent-secret");
    expect(requestInit.method).toBe("PUT");
    const body = JSON.parse(requestInit.body as string);
    expect(body).toMatchObject({
      status: "CONFIRMED",
      customer: {
        firstName: "Raga",
        lastName: "Test",
        email: "raga@example.com",
        phone: "085664326198"
      },
      items: [
        {
          productCode: "AGT-001",
          startTimeLocal: "2026-09-10 09:00:00",
          quantities: [{ optionLabel: "Adult", value: 2 }]
        }
      ]
    });
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0]).toMatchObject({
      amount: 0,
      currency: "AUD",
      label: "BluePass full payment to agent"
    });
    // request.date is already a Rezdy-normalized local datetime here (same caveat documented for
    // Supplier API's confirmBooking - no availability re-lookup is attempted), so the payment amount
    // falls back to the zero placeholder rather than a real price - see the adapter's own comment on
    // resolvePaymentForConfirm for why, and the "not yet verified against a real payload" note on the
    // payments array shape itself.
  });

  it("computes a real payment amount from a re-looked-up session when the confirm date is still natural text", async () => {
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes("/availability?")) {
        return new Response(
          JSON.stringify({
            sessions: [
              {
                productCode: "AGT-003",
                startTimeLocal: "2026-09-12 10:00:00",
                seatsAvailable: 8,
                currency: "AUD",
                priceOptions: [{ label: "Adult", price: 150 }]
              }
            ]
          }),
          { status: 200 }
        );
      }

      return new Response(JSON.stringify({ order: { orderNumber: "AGT-ORDER-2", status: "CONFIRMED" } }), {
        status: 200
      });
    });
    const adapter = new RezdyAgentPmsAdapter({
      baseUrl: "https://api.rezdy.com/v1",
      apiKey: "agent-secret",
      availabilityPath: "/availability",
      bookingPath: "/bookings",
      fetcher
    });

    await adapter.confirmBooking("AGT-ORDER-2", {
      productId: "AGT-003",
      date: "tomorrow",
      guests: 2,
      travellerName: "Raga Test",
      travellerEmail: "raga@example.com"
    });

    const putCall = fetcher.mock.calls.find(([input]) => !String(input).includes("/availability"));
    const [, requestInit] = putCall as unknown as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(body.payments).toEqual([
      expect.objectContaining({
        amount: 300,
        currency: "AUD",
        label: "BluePass full payment to agent"
      })
    ]);
  });

  it("includes PMS error response details when a confirm request is rejected", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: "Order already confirmed" }), { status: 409 }));
    const adapter = new RezdyAgentPmsAdapter({
      baseUrl: "https://api.rezdy.com/v1",
      apiKey: "agent-secret",
      bookingPath: "/bookings",
      fetcher
    });

    await expect(adapter.confirmBooking("AGT-1", confirmRequest)).rejects.toThrow(
      'REZDY_AGENT PMS API request failed with status 409: {"error":"Order already confirmed"}'
    );
  });

  it("cancels a booking with a real DELETE call - closes a gap RezdyPmsAdapter (Supplier API) has never implemented", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ requestStatus: { success: true } }), { status: 200 }));
    const adapter = new RezdyAgentPmsAdapter({
      baseUrl: "https://api.rezdy.com/v1",
      apiKey: "agent-secret",
      bookingPath: "/bookings",
      fetcher
    });

    await expect(adapter.cancelBooking("AGT-ORDER-1")).resolves.toEqual({ cancelled: true });

    const [url, requestInit] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.rezdy.com/v1/bookings/AGT-ORDER-1?apiKey=agent-secret");
    expect(requestInit.method).toBe("DELETE");
  });

  it("propagates a PMS error when cancel is rejected", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: "Order not cancellable" }), { status: 409 }));
    const adapter = new RezdyAgentPmsAdapter({
      baseUrl: "https://api.rezdy.com/v1",
      apiKey: "agent-secret",
      bookingPath: "/bookings",
      fetcher
    });

    await expect(adapter.cancelBooking("AGT-1")).rejects.toThrow(
      'REZDY_AGENT PMS API request failed with status 409: {"error":"Order not cancellable"}'
    );
  });
});
