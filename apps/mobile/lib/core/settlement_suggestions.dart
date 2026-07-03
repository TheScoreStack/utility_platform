/// Dart port of `apps/web/src/lib/settlementSuggestions.ts`: greedy matching
/// of debtors to creditors so everyone settles in the fewest payments.
library;

import '../models/models.dart';

class SettlementSuggestion {
  final String from;
  final String to;
  final double amount;

  const SettlementSuggestion({
    required this.from,
    required this.to,
    required this.amount,
  });
}

class _Party {
  final String memberId;
  double amount;

  _Party(this.memberId, this.amount);
}

List<SettlementSuggestion> computeSettlementSuggestions(
  List<BalanceRow> balances,
) {
  final creditors = <_Party>[];
  final debtors = <_Party>[];

  for (final balance in balances) {
    if (balance.balance > 0.01) {
      creditors.add(_Party(balance.memberId, balance.balance));
    } else if (balance.balance < -0.01) {
      debtors.add(_Party(balance.memberId, balance.balance.abs()));
    }
  }

  if (creditors.isEmpty || debtors.isEmpty) {
    return const [];
  }

  final suggestions = <SettlementSuggestion>[];
  var creditorIndex = 0;
  var debtorIndex = 0;

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    final creditor = creditors[creditorIndex];
    final debtor = debtors[debtorIndex];
    final amount = creditor.amount < debtor.amount
        ? creditor.amount
        : debtor.amount;

    suggestions.add(
      SettlementSuggestion(
        from: debtor.memberId,
        to: creditor.memberId,
        amount: (amount * 100).roundToDouble() / 100,
      ),
    );

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
}
