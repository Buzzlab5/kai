import { RealPmsHttpAdapter, type RealPmsHttpAdapterConfig } from "./real-pms-http-adapter";
import {
  asRecord,
  formatRezdyTimeLabel,
  isRezdyLocalDateTime,
  readArrayRecords,
  readExtraOptionLabel,
  readExtraOptionPrice,
  readNestedRecord,
  readNumber,
  readPriceOptionLabel,
  readString,
  resolveRezdyDateRange,
  selectPriceOption,
  splitTravellerName,
  type UnknownRecord
} from "./rezdy-pms-adapter";
import type {
  PmsAvailabilityRequest,
  PmsAvailabilityResult,
  PmsCreateBookingRequest,
  PmsCreateBookingResult
} from "./types";

// Best guess at Rezdy's payments[].type enum value for a card-on-file/agent-collected payment -
// unconfirmed against real docs/payloads for the Agent API specifically. Verify and fix before this
// adapter's confirmBooking is used against a real order.
const PAYMENT_TYPE_PLACEHOLDER = "CASH" as const;

export interface RezdyMarketplaceProduct {
  productCode: string;
  name: string;
  description: string;
  supplierName: string;
  supplierId: string;
  region: string;
  priceFrom: number | null;
  currency: string;
  imageUrl: string | null;
  productUrl: string | null;
  /** Full, unmapped Rezdy record - kept so a consumer isn't blocked on fields this mapping missed. */
  raw: UnknownRecord;
}

interface RezdyAgentAvailabilitySession {
  dateRange: ReturnType<typeof resolveRezdyDateRange>;
  session?: UnknownRecord;
  sessions: UnknownRecord[];
}

/**
 * Rezdy Agent API adapter - BluePass acting as reseller/agent across many connected operators'
 * inventory via one credential, instead of one Supplier API key per operator (see
 * rezdy-pms-adapter.ts's RezdyPmsAdapter for that older, still-live path - Boattime's demo booking
 * flow runs on it and this file must never be reached from Boattime's tenant config).
 *
 * Registered under the distinct "REZDY_AGENT" provider in pms-adapter-registry.ts, deliberately not
 * the existing "REZDY" branch, so Boattime's Supplier API credentials are never routed here by
 * mistake (see that registry file's own comment for why this separation is load-bearing, not
 * cosmetic).
 *
 * Endpoint shapes below are BluePass's best-effort mapping from Rezdy's published Agent API spec
 * (https://developers.rezdy.com/rezdyapi/index-agent.html) plus the parsing helpers already proven
 * against real Supplier API payloads (same underlying Rezdy data model: sessions/priceOptions). None
 * of this has been verified against a real Agent API response yet - Rezdy's staging demo key
 * supports GET calls (marketplace/availability) with no approval wait, which is how getAvailability
 * and listProducts (inherited from the base class) should be validated before writing booking code
 * against a real operator. Write calls (createBooking/confirmBooking/cancelBooking) need the real,
 * approved Agent API key - not available at the time this was written.
 */
export class RezdyAgentPmsAdapter extends RealPmsHttpAdapter {
  provider = "REZDY_AGENT" as const;

  constructor(config: RealPmsHttpAdapterConfig = {}) {
    super({ ...config, apiKeyPlacement: config.apiKeyPlacement ?? "query" });
  }

  /**
   * Richer than the PmsAdapter interface's own listProducts() (inherited from the base class),
   * which maps down to the minimal {externalProductId, title, description, bookingMode} shape built
   * for in-chat product listing - too lossy for populating a public Discover/marketplace page, which
   * needs supplier identity, region, an image, and a price signal. Built for that one specific
   * consumer (see the internal marketplace-products API route that calls this) rather than added to
   * the shared PmsAdapter interface, since no other adapter or call site needs it.
   *
   * Field names (supplierName/supplierId/region/images/priceOptions) are this codebase's best guess
   * at Rezdy's actual GET /v1/products/marketplace response shape, following Rezdy's documented
   * product-image convention elsewhere in their API (images[].itemUrl / .largeSizeUrl) - unconfirmed
   * against a real response. `raw` carries the full untouched record specifically so a consumer isn't
   * blocked if this guess turns out wrong for a field it needs.
   */
  async listMarketplaceProducts(): Promise<RezdyMarketplaceProduct[]> {
    this.assertConfigured(["baseUrl", "apiKey", "productListPath"]);
    const payload = await this.requestJson("GET", this.config.productListPath as string);
    const record = asRecord(payload);
    const products = readArrayRecords(record, "products");

    return products.map((product) => this.mapMarketplaceProduct(product));
  }

  private mapMarketplaceProduct(product: UnknownRecord): RezdyMarketplaceProduct {
    const images = readArrayRecords(product, "images");
    const primaryImage = images.find((image) => image.isPrimary === true) ?? images[0];
    const priceOptions = readArrayRecords(product, "priceOptions");
    const selectedPrice = selectPriceOption(priceOptions);
    const priceFrom = selectedPrice ? readNumber(selectedPrice, ["price", "adultPrice", "advertisedPrice"]) : null;

    return {
      productCode: readString(product, ["productCode", "id", "productId"]),
      name: readString(product, ["name", "title", "productName"]),
      description: readString(product, ["description", "shortDescription", "summary"]),
      supplierName: readString(product, ["supplierName", "supplier", "companyName"]),
      supplierId: readString(product, ["supplierId", "supplierCode", "companyId"]),
      region: readString(product, ["region", "locationAddress", "city", "location"]),
      priceFrom: priceFrom && priceFrom > 0 ? priceFrom : null,
      currency: readString(product, ["currency", "currencyCode"]) || "AUD",
      imageUrl: primaryImage ? readString(primaryImage, ["largeSizeUrl", "itemUrl", "mediumSizeUrl"]) || null : null,
      productUrl: readString(product, ["productUrl", "bookingUrl"]) || null,
      raw: product
    };
  }

  async getAvailability(request: PmsAvailabilityRequest): Promise<PmsAvailabilityResult> {
    const { dateRange, session, sessions } = await this.findAvailabilitySession(request);

    if (!session) {
      return {
        productId: request.productId,
        date: dateRange.startTimeLocal,
        available: false,
        remaining: 0,
        currency: "AUD",
        unitPriceCents: 0
      };
    }

    const priceOptions = readArrayRecords(session, "priceOptions");
    const selectedPrice = selectPriceOption(priceOptions);
    const unitPrice = selectedPrice ? readNumber(selectedPrice, ["price", "adultPrice", "advertisedPrice"]) : 0;
    const remaining = readNumber(session, ["seatsAvailable", "availability", "remaining"]);
    const timeOptions = sessions
      .filter((item) => readNumber(item, ["seatsAvailable", "availability", "remaining"]) >= request.guests)
      .map((item) => {
        const startTimeLocal = readString(item, ["startTimeLocal", "startTime"]);
        const checkoutItemKey = readString(item, ["itemKey"]);
        const checkoutSessionId = readString(item, ["id", "sessionId", "sessionKey", "availabilityId"]);

        return startTimeLocal
          ? {
              label: formatRezdyTimeLabel(startTimeLocal),
              startTimeLocal,
              remaining: readNumber(item, ["seatsAvailable", "availability", "remaining"]),
              ...(checkoutItemKey ? { checkoutItemKey } : {}),
              ...(checkoutSessionId ? { checkoutSessionId } : {})
            }
          : null;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const ticketOptions = priceOptions
      .map((priceOption) => ({
        label: readPriceOptionLabel(priceOption),
        unitPriceCents: Math.round(readNumber(priceOption, ["price", "adultPrice", "advertisedPrice"]) * 100)
      }))
      .filter((ticketOption) => ticketOption.label);
    const extraOptions = ["extras", "extraOptions", "productExtras"]
      .flatMap((key) => readArrayRecords(session, key))
      .map((extraOption) => ({
        label: readExtraOptionLabel(extraOption),
        unitPriceCents: Math.round(readExtraOptionPrice(extraOption) * 100)
      }))
      .filter((extraOption) => extraOption.label);

    return {
      productId: readString(session, ["productCode", "productId"]) || request.productId,
      date: readString(session, ["startTimeLocal", "startTime"]) || dateRange.startTimeLocal,
      available: remaining >= request.guests,
      remaining,
      currency: readString(session, ["currency", "currencyCode"]) || "AUD",
      unitPriceCents: Math.round(unitPrice * 100),
      timeOptions,
      ticketOptions,
      ...(extraOptions.length > 0 ? { extraOptions } : {})
    };
  }

  async createBooking(request: PmsCreateBookingRequest): Promise<PmsCreateBookingResult> {
    this.assertConfigured(["baseUrl", "apiKey", "bookingPath"]);
    const availabilitySession = isRezdyLocalDateTime(request.date)
      ? undefined
      : await this.findAvailabilitySession({
          productId: request.productId,
          date: request.date,
          guests: request.guests
        });
    const session = availabilitySession?.session;
    const remaining = session ? readNumber(session, ["seatsAvailable", "availability", "remaining"]) : 0;
    if (availabilitySession && (!session || remaining < request.guests)) {
      return {
        externalBookingId: "",
        provider: this.provider,
        status: "FAILED"
      };
    }

    const { items } = this.buildBookingItems(request, session);
    const name = splitTravellerName(request.travellerName);
    const payload = await this.requestJson("POST", this.config.bookingPath as string, {
      ...(request.confirmationMode === "PAYMENT_HOLD" ? { status: "PROCESSING" } : {}),
      customer: {
        firstName: name.firstName,
        lastName: name.lastName,
        email: request.travellerEmail,
        phone: request.travellerPhone ?? ""
      },
      items,
      ...(request.paymentCardToken ? { creditCard: { cardToken: request.paymentCardToken } } : {}),
      resellerComments: "Created by Kai (BluePass Agent) after traveller confirmation."
    });

    return this.mapBookingResponse(payload);
  }

  /**
   * Same full-resource-replace PUT pattern already proven for Supplier API (see
   * RezdyPmsAdapter.confirmBooking), plus the `payments` array Rezdy's Agent API requires before it
   * marks a "full payment to agent" booking as paid - Supplier API's adapter has no equivalent of
   * this at all, which is exactly why Boattime's bookings sit at totalPaid: 0 in Rezdy's own
   * dashboard forever. `request` has no price field, so the amount is re-derived the same way
   * createBooking does (re-look-up the session's selected price option) rather than trusting a
   * caller-supplied figure - unconfirmed against a real Agent API response what field names Rezdy
   * actually expects on the payments array; `type`/`amount`/`currency`/`date`/`label` are Rezdy's
   * documented field names for it.
   */
  async confirmBooking(externalBookingId: string, request: PmsCreateBookingRequest): Promise<PmsCreateBookingResult> {
    this.assertConfigured(["baseUrl", "apiKey", "bookingPath"]);
    const bookingPath = (this.config.bookingPath as string).replace(/\/$/, "");
    const name = splitTravellerName(request.travellerName);
    const { items } = this.buildBookingItems(request, undefined);
    const payment = await this.resolvePaymentForConfirm(request);

    const payload = await this.requestJson("PUT", `${bookingPath}/${externalBookingId}`, {
      status: "CONFIRMED",
      customer: {
        firstName: name.firstName,
        lastName: name.lastName,
        email: request.travellerEmail,
        phone: request.travellerPhone ?? ""
      },
      items,
      payments: [payment]
    });

    return this.mapBookingResponse(payload);
  }

  /**
   * Real cancel - closes a gap that has never been implemented for Rezdy in either API (Supplier's
   * adapter inherits the base class's "not enabled" for cancelBooking; it has never overridden it).
   * Unconfirmed against a real response what a successful DELETE actually returns - treats any
   * non-throwing response as cancelled, since requestJson already throws on a non-ok HTTP status.
   */
  async cancelBooking(externalBookingId: string): Promise<{ cancelled: boolean }> {
    this.assertConfigured(["baseUrl", "apiKey", "bookingPath"]);
    const bookingPath = (this.config.bookingPath as string).replace(/\/$/, "");
    await this.requestJson("DELETE", `${bookingPath}/${externalBookingId}`);
    return { cancelled: true };
  }

  private buildBookingItems(request: PmsCreateBookingRequest, session: UnknownRecord | undefined) {
    const priceOptions = session ? readArrayRecords(session, "priceOptions") : [];
    const selectedPrice = selectPriceOption(priceOptions);
    const selectedPriceLabel = readPriceOptionLabel(selectedPrice) || "Adult";
    const ticketQuantities =
      request.ticketQuantities && request.ticketQuantities.length > 0
        ? request.ticketQuantities.map((ticket) => ({ optionLabel: ticket.optionLabel, value: ticket.quantity }))
        : [{ optionLabel: selectedPriceLabel, value: request.guests }];
    const extraQuantities =
      request.extraQuantities && request.extraQuantities.length > 0
        ? request.extraQuantities.map((extra) => ({ name: extra.optionLabel, quantity: extra.quantity }))
        : undefined;

    return {
      ticketQuantities,
      items: [
        {
          productCode: (session ? readString(session, ["productCode", "productId"]) : "") || request.productId,
          startTimeLocal: (session ? readString(session, ["startTimeLocal", "startTime"]) : "") || request.date,
          quantities: ticketQuantities,
          ...(extraQuantities ? { extras: extraQuantities } : {})
        }
      ]
    };
  }

  /**
   * Re-looks-up the session the same way createBooking did, to compute the amount Rezdy's `payments`
   * array wants. Falls back to a zero-amount AUD payment (still satisfies the array's presence
   * requirement per Rezdy's docs) if the session can no longer be found - e.g. request.date is
   * already a Rezdy-normalized local datetime by the time confirmBooking runs, same caveat
   * RezdyPmsAdapter.confirmBooking documents for its own no-availability-relookup behavior.
   */
  private async resolvePaymentForConfirm(request: PmsCreateBookingRequest) {
    if (isRezdyLocalDateTime(request.date)) {
      return this.buildZeroPayment();
    }

    try {
      const { session } = await this.findAvailabilitySession({
        productId: request.productId,
        date: request.date,
        guests: request.guests
      });
      if (!session) return this.buildZeroPayment();

      const priceOptions = readArrayRecords(session, "priceOptions");
      const selectedPrice = selectPriceOption(priceOptions);
      const unitPrice = selectedPrice ? readNumber(selectedPrice, ["price", "adultPrice", "advertisedPrice"]) : 0;
      const totalGuests =
        request.ticketQuantities && request.ticketQuantities.length > 0
          ? request.ticketQuantities.reduce((sum, ticket) => sum + ticket.quantity, 0)
          : request.guests;
      const currency = readString(session, ["currency", "currencyCode"]) || "AUD";

      return {
        type: PAYMENT_TYPE_PLACEHOLDER,
        amount: Math.round(unitPrice * totalGuests * 100) / 100,
        currency,
        date: new Date().toISOString().slice(0, 10),
        label: "BluePass full payment to agent"
      };
    } catch {
      return this.buildZeroPayment();
    }
  }

  private buildZeroPayment() {
    return {
      type: PAYMENT_TYPE_PLACEHOLDER,
      amount: 0,
      currency: "AUD",
      date: new Date().toISOString().slice(0, 10),
      label: "BluePass full payment to agent"
    };
  }

  private mapBookingResponse(payload: unknown): PmsCreateBookingResult {
    const record = asRecord(payload);
    const bookingRecord = readNestedRecord(record, ["order", "booking"]);
    const externalBookingId = readString(bookingRecord, [
      "orderNumber",
      "bookingNumber",
      "confirmationNumber",
      "id",
      "orderId"
    ]);
    const rawStatus = readString(bookingRecord, ["status", "bookingStatus", "orderStatus"]).toUpperCase();
    const paymentUrl =
      readString(bookingRecord, ["paymentUrl", "paymentLink", "paymentPageUrl", "orderPaymentUrl", "paymentRequestUrl"]) ||
      readString(record, ["paymentUrl", "paymentLink", "paymentPageUrl", "orderPaymentUrl", "paymentRequestUrl"]);
    const status =
      !externalBookingId
        ? "FAILED"
        : rawStatus.includes("FAIL") || rawStatus.includes("CANCEL")
        ? "FAILED"
        : rawStatus.includes("PROCESS") || rawStatus.includes("PEND") || rawStatus.includes("UNPAID")
          ? "PENDING"
          : "CONFIRMED";

    return {
      externalBookingId,
      provider: this.provider,
      status,
      ...(paymentUrl ? { paymentUrl } : {})
    };
  }

  private async findAvailabilitySession(request: PmsAvailabilityRequest): Promise<RezdyAgentAvailabilitySession> {
    this.assertConfigured(["baseUrl", "apiKey", "availabilityPath"]);
    const dateRange = resolveRezdyDateRange(request.date);
    const payload = await this.requestJson("GET", this.config.availabilityPath as string, undefined, {
      productCode: request.productId,
      startTimeLocal: dateRange.startTimeLocal,
      endTimeLocal: dateRange.endTimeLocal,
      minAvailability: String(request.guests)
    });
    const record = asRecord(payload);
    const sessions = readArrayRecords(record, "sessions");
    const session =
      sessions.find((item) => readNumber(item, ["seatsAvailable", "availability", "remaining"]) >= request.guests) ??
      sessions[0];

    return { dateRange, session, sessions };
  }
}
