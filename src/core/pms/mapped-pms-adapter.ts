import type {
  PmsAdapter,
  PmsAvailabilityRequest,
  PmsAvailabilityResult,
  PmsAvailableDatesRequest,
  PmsAvailableDatesResult,
  PmsExtraOption,
  PmsCreateBookingRequest,
  PmsCreateBookingResult,
  PmsProduct
} from "./types";

export interface PublicProductMapping {
  publicTitle: string;
  publicDescription?: string;
  productUrl?: string;
  pmsProductId: string;
  bookingMode?: "MANUAL_INQUIRY" | "AUTO_BOOKING";
  extraOptions?: PmsExtraOption[];
}

export class MappedPmsAdapter implements PmsAdapter {
  provider;

  constructor(
    private readonly sourceAdapter: PmsAdapter,
    private readonly mappings: PublicProductMapping[]
  ) {
    this.provider = sourceAdapter.provider;
  }

  async listProducts(): Promise<PmsProduct[]> {
    return this.mappings.map((mapping) => ({
      externalProductId: mapping.pmsProductId,
      title: mapping.publicTitle,
      description: mapping.publicDescription ?? "",
      productUrl: mapping.productUrl ?? null,
      bookingMode: mapping.bookingMode ?? "AUTO_BOOKING"
    }));
  }

  async getAvailability(request: PmsAvailabilityRequest): Promise<PmsAvailabilityResult> {
    const availability = await this.sourceAdapter.getAvailability(request);
    const mapping = this.mappings.find((item) => item.pmsProductId === request.productId);

    return {
      ...availability,
      extraOptions:
        availability.extraOptions && availability.extraOptions.length > 0
          ? availability.extraOptions
          : mapping?.extraOptions
    };
  }

  async createBooking(request: PmsCreateBookingRequest): Promise<PmsCreateBookingResult> {
    return this.sourceAdapter.createBooking(request);
  }

  async cancelBooking(externalBookingId: string): Promise<{ cancelled: boolean }> {
    return this.sourceAdapter.cancelBooking(externalBookingId);
  }

  async getBooking(externalBookingId: string): Promise<PmsCreateBookingResult | null> {
    return this.sourceAdapter.getBooking(externalBookingId);
  }

  async confirmBooking(externalBookingId: string, request: PmsCreateBookingRequest): Promise<PmsCreateBookingResult> {
    if (!this.sourceAdapter.confirmBooking) {
      throw new Error(`${this.provider} PMS adapter does not support confirmBooking.`);
    }

    return this.sourceAdapter.confirmBooking(externalBookingId, request);
  }

  /**
   * Unlike confirmBooking above, this degrades to "no dates" instead of throwing when the wrapped
   * adapter doesn't support it - findAvailableDates is feature-detected by its caller
   * (booking-orchestrator.ts) specifically to make "no date suggestions" a normal, expected outcome
   * for every non-Rezdy PMS, not an error. request.productId is already the raw PMS product id
   * (see getAvailability above - mapping.pmsProductId is what listProducts hands out as
   * externalProductId, so it needs no translation before reaching the source adapter).
   */
  async findAvailableDates(request: PmsAvailableDatesRequest): Promise<PmsAvailableDatesResult> {
    if (!this.sourceAdapter.findAvailableDates) {
      return { dates: [] };
    }

    return this.sourceAdapter.findAvailableDates(request);
  }
}
