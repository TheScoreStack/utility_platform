import { HarmonyLedgerService } from "../services/harmonyLedgerService.js";

const harmonyLedgerService = new HarmonyLedgerService();

/**
 * Daily EventBridge target: materializes due Harmony recurring templates
 * into ledger entries and advances their schedules.
 */
export const handler = async (): Promise<{ created: number }> => {
  const created = await harmonyLedgerService.materializeDueRecurringEntries();
  console.log(`Harmony recurring entries materialized: ${created}`);
  return { created };
};
