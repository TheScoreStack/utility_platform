import 'package:flutter_test/flutter_test.dart';
import 'package:platform_mobile/core/settlement_suggestions.dart';
import 'package:platform_mobile/models/models.dart';

BalanceRow row(String memberId, double balance) =>
    BalanceRow(memberId: memberId, displayName: memberId, balance: balance);

void main() {
  group('computeSettlementSuggestions', () {
    test('one debtor pays one creditor directly', () {
      final suggestions = computeSettlementSuggestions([
        row('a', 30),
        row('b', -30),
      ]);

      expect(suggestions, hasLength(1));
      expect(suggestions.single.from, 'b');
      expect(suggestions.single.to, 'a');
      expect(suggestions.single.amount, 30);
    });

    test('multiple debtors are matched against one creditor in order', () {
      final suggestions = computeSettlementSuggestions([
        row('a', 50),
        row('b', -20),
        row('c', -30),
      ]);

      expect(suggestions, hasLength(2));
      expect(suggestions[0].from, 'b');
      expect(suggestions[0].to, 'a');
      expect(suggestions[0].amount, 20);
      expect(suggestions[1].from, 'c');
      expect(suggestions[1].to, 'a');
      expect(suggestions[1].amount, 30);
    });

    test('one debtor is split across multiple creditors', () {
      final suggestions = computeSettlementSuggestions([
        row('a', 10),
        row('b', 15),
        row('c', -25),
      ]);

      expect(suggestions, hasLength(2));
      expect(suggestions[0].from, 'c');
      expect(suggestions[0].to, 'a');
      expect(suggestions[0].amount, 10);
      expect(suggestions[1].from, 'c');
      expect(suggestions[1].to, 'b');
      expect(suggestions[1].amount, 15);
    });

    test('near-zero balances produce no suggestions', () {
      final suggestions = computeSettlementSuggestions([
        row('a', 0),
        row('b', 0.005),
        row('c', -0.005),
      ]);

      expect(suggestions, isEmpty);
    });

    test('amounts are rounded to cents', () {
      final suggestions = computeSettlementSuggestions([
        row('a', 10.333333),
        row('b', -10.333333),
      ]);

      expect(suggestions.single.amount, 10.33);
    });
  });
}
