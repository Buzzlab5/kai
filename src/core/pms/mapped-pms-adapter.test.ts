import { describe, expect, it, vi } from "vitest";
import { MappedPmsAdapter } from "./mapped-pms-adapter";
import type { PmsAdapter, PmsCreateBookingRequest, PmsCreateBookingResult, PmsProduct } from "./types";

describe("MappedPmsAdapter", () => {
  it("exposes website products and checks availability with the mapped PMS product id", async () => {
    const sourceAdapter: PmsAdapter = {
      provider: "REZDY",
      listProducts: vi.fn(async () => [
        {
          externalProductId: "rezdy-whale-ota",
          title: "(KLOOK) Luxury Whale Watching Experience",
          description: "",
          bookingMode: "AUTO_BOOKING"
        }
      ] satisfies PmsProduct[]),
      getAvailability: vi.fn(async () => ({
        productId: "rezdy-whale-direct",
        date: "tomorrow",
        available: true,
        remaining: 8,
        currency: "AUD",
        unitPriceCents: 9900
      })),
      createBooking: vi.fn(),
      cancelBooking: vi.fn(),
      getBooking: vi.fn()
    };

    const adapter = new MappedPmsAdapter(sourceAdapter, [
      {
        publicTitle: "Gold Coast Whale Escape",
        publicDescription: "Luxury whale watching",
        pmsProductId: "rezdy-whale-direct",
        productUrl: "https://tenant.example/whale",
        bookingMode: "AUTO_BOOKING",
        extraOptions: [{ label: "Corona Bucket", unitPriceCents: 3000 }]
      }
    ]);

    await expect(adapter.listProducts()).resolves.toEqual([
      {
        externalProductId: "rezdy-whale-direct",
        title: "Gold Coast Whale Escape",
        description: "Luxury whale watching",
        productUrl: "https://tenant.example/whale",
        bookingMode: "AUTO_BOOKING"
      }
    ]);

    await expect(
      adapter.getAvailability({ productId: "rezdy-whale-direct", date: "tomorrow", guests: 2 })
    ).resolves.toMatchObject({
      extraOptions: [{ label: "Corona Bucket", unitPriceCents: 3000 }]
    });

    expect(sourceAdapter.listProducts).not.toHaveBeenCalled();
    expect(sourceAdapter.getAvailability).toHaveBeenCalledWith({
      productId: "rezdy-whale-direct",
      date: "tomorrow",
      guests: 2
    });
  });

  it("delegates confirmBooking to the source adapter when it supports it", async () => {
    const confirmRequest: PmsCreateBookingRequest = {
      productId: "rezdy-whale-direct",
      date: "2026-06-28 12:00:00",
      guests: 2,
      travellerName: "Test Traveller",
      travellerEmail: "traveller@example.com"
    };
    const sourceAdapter: PmsAdapter = {
      provider: "REZDY",
      listProducts: vi.fn(async () => []),
      getAvailability: vi.fn(),
      createBooking: vi.fn(),
      cancelBooking: vi.fn(),
      getBooking: vi.fn(),
      confirmBooking: vi.fn(async (): Promise<PmsCreateBookingResult> => ({
        externalBookingId: "RZ-1",
        provider: "REZDY",
        status: "CONFIRMED"
      }))
    };

    const adapter = new MappedPmsAdapter(sourceAdapter, []);

    await expect(adapter.confirmBooking?.("RZ-1", confirmRequest)).resolves.toEqual({
      externalBookingId: "RZ-1",
      provider: "REZDY",
      status: "CONFIRMED"
    });
    expect(sourceAdapter.confirmBooking).toHaveBeenCalledWith("RZ-1", confirmRequest);
  });

  it("throws a clear error when the source adapter does not support confirmBooking", async () => {
    const sourceAdapter: PmsAdapter = {
      provider: "MOCK",
      listProducts: vi.fn(async () => []),
      getAvailability: vi.fn(),
      createBooking: vi.fn(),
      cancelBooking: vi.fn(),
      getBooking: vi.fn()
    };

    const adapter = new MappedPmsAdapter(sourceAdapter, []);
    const confirmRequest: PmsCreateBookingRequest = {
      productId: "mock-product",
      date: "2026-06-28 12:00:00",
      guests: 1,
      travellerName: "Test Traveller",
      travellerEmail: "traveller@example.com"
    };

    await expect(adapter.confirmBooking?.("id-1", confirmRequest)).rejects.toThrow(
      "MOCK PMS adapter does not support confirmBooking."
    );
  });

  it("delegates findAvailableDates to the source adapter with the raw PMS product id unchanged", async () => {
    const sourceAdapter: PmsAdapter = {
      provider: "REZDY",
      listProducts: vi.fn(async () => []),
      getAvailability: vi.fn(),
      createBooking: vi.fn(),
      cancelBooking: vi.fn(),
      getBooking: vi.fn(),
      findAvailableDates: vi.fn(async () => ({ dates: ["2026-06-24", "2026-06-27"] }))
    };

    const adapter = new MappedPmsAdapter(sourceAdapter, [
      { publicTitle: "Gold Coast Whale Escape", pmsProductId: "rezdy-whale-direct" }
    ]);

    await expect(
      adapter.findAvailableDates?.({ productId: "rezdy-whale-direct", guests: 2, fromDate: "tomorrow", daysToSearch: 60 })
    ).resolves.toEqual({ dates: ["2026-06-24", "2026-06-27"] });
    expect(sourceAdapter.findAvailableDates).toHaveBeenCalledWith({
      productId: "rezdy-whale-direct",
      guests: 2,
      fromDate: "tomorrow",
      daysToSearch: 60
    });
  });

  // This is the bug that shipped: MappedPmsAdapter forwarded confirmBooking but not
  // findAvailableDates, so booking-orchestrator's `if (adapter.findAvailableDates)`
  // feature-detection silently saw "unsupported" for every mapped Rezdy tenant (Boattime
  // included) even though the underlying RezdyPmsAdapter implements it - Kai's "not available"
  // replies never carried real alternative dates in production until this was caught live.
  it("degrades to no dates, rather than throwing, when the source adapter does not support findAvailableDates", async () => {
    const sourceAdapter: PmsAdapter = {
      provider: "MOCK",
      listProducts: vi.fn(async () => []),
      getAvailability: vi.fn(),
      createBooking: vi.fn(),
      cancelBooking: vi.fn(),
      getBooking: vi.fn()
    };

    const adapter = new MappedPmsAdapter(sourceAdapter, []);

    await expect(
      adapter.findAvailableDates?.({ productId: "mock-product", guests: 2, fromDate: "tomorrow", daysToSearch: 60 })
    ).resolves.toEqual({ dates: [] });
  });
});
