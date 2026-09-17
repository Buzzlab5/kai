-- RenameEnumValue: BluePassLedgerKind.CREATOR_COMMISSION_ESTIMATE -> PARTNER_COMMISSION_ESTIMATE
-- Backs both BluePassLedgerEntry.kind and PmsBookingLedgerEntry.kind (metadata-only, no data
-- migration needed - existing rows automatically read back under the new label).
ALTER TYPE "BluePassLedgerKind" RENAME VALUE 'CREATOR_COMMISSION_ESTIMATE' TO 'PARTNER_COMMISSION_ESTIMATE';
