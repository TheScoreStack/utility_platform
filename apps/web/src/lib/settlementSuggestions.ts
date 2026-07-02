import type { BalanceRow } from "../types";

export type SettlementSuggestion = { from: string; to: string; amount: number };

export const computeSettlementSuggestions = (balances: BalanceRow[]) => {
  const creditors: Array<{ memberId: string; amount: number }> = [];
  const debtors: Array<{ memberId: string; amount: number }> = [];

  balances.forEach((balance) => {
    if (balance.balance > 0.01) {
      creditors.push({ memberId: balance.memberId, amount: balance.balance });
    } else if (balance.balance < -0.01) {
      debtors.push({ memberId: balance.memberId, amount: Math.abs(balance.balance) });
    }
  });

  if (!creditors.length || !debtors.length) {
    return [] as SettlementSuggestion[];
  }

  const suggestions: SettlementSuggestion[] = [];
  let creditorIndex = 0;
  let debtorIndex = 0;

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const amount = Math.min(creditor.amount, debtor.amount);

    suggestions.push({
      from: debtor.memberId,
      to: creditor.memberId,
      amount: Math.round(amount * 100) / 100
    });

    creditor.amount -= amount;
    debtor.amount -= amount;

    if (creditor.amount <= 0.01) {
      creditorIndex += 1;
    }
    if (debtor.amount <= 0.01) {
      debtorIndex += 1;
    }
  }

  return suggestions;
};
