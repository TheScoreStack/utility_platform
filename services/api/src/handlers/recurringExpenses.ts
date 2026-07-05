import { TripService } from "../services/tripService.js";

const tripService = new TripService();

/**
 * Daily EventBridge target: materializes every due recurring-expense
 * template into a real expense and advances its schedule.
 */
export const handler = async (): Promise<{ created: number }> => {
  const created = await tripService.materializeDueRecurringExpenses();
  console.log(`Recurring expenses materialized: ${created}`);
  return { created };
};
