import 'package:flutter_test/flutter_test.dart';
import 'package:platform_mobile/modules/harmony/models/harmony_models.dart';

void main() {
  group('HarmonyStagedTxn', () {
    test('parses a full transaction payload', () {
      final txn = HarmonyStagedTxn.fromJson({
        'txnId': 'stx_1',
        'statementId': 'stmt_1',
        'txnDate': '2026-06-02',
        'amount': 25,
        'currency': 'USD',
        'direction': 'IN',
        'rawDescription': 'Jazz night door',
        'counterparty': 'Maria Lopez',
        'suggestedType': 'DONATION',
        'suggestedGroupId': 'highlyte',
        'suggestedGroupName': 'Highlyte',
        'isLikelyInternalTransfer': false,
        'duplicateOf': {'kind': 'entry', 'id': 'ent_1'},
        'status': 'PENDING',
      });

      expect(txn.amount, 25);
      expect(txn.isInflow, isTrue);
      expect(txn.isPending, isTrue);
      expect(txn.isDuplicate, isTrue);
      expect(txn.suggestedGroupName, 'Highlyte');
    });

    test('tolerates missing optional fields', () {
      final txn = HarmonyStagedTxn.fromJson({
        'txnId': 'stx_2',
        'statementId': 'stmt_1',
        'txnDate': '2026-06-05',
        'amount': 42.99,
        'direction': 'OUT',
        'rawDescription': 'PA cable',
        'suggestedType': 'EXPENSE',
        'status': 'CONFIRMED',
      });

      expect(txn.currency, 'USD');
      expect(txn.isInflow, isFalse);
      expect(txn.isDuplicate, isFalse);
      expect(txn.isPending, isFalse);
      expect(txn.counterparty, isNull);
    });
  });

  group('HarmonyStatement', () {
    test('derives status helpers', () {
      HarmonyStatement statement(String status) => HarmonyStatement.fromJson({
        'statementId': 'stmt_1',
        'fileName': 'venmo.csv',
        'fileType': 'CSV',
        'sourceType': 'VENMO',
        'status': status,
        'uploadedAt': '2026-07-06T00:00:00.000Z',
      });

      expect(statement('PENDING_UPLOAD').isProcessing, isTrue);
      expect(statement('PROCESSING').isProcessing, isTrue);
      expect(statement('PARSED').isParsed, isTrue);
      expect(statement('FAILED').isFailed, isTrue);
    });

    test('parses counts when present', () {
      final statement = HarmonyStatement.fromJson({
        'statementId': 'stmt_1',
        'fileName': 'venmo.csv',
        'fileType': 'CSV',
        'sourceType': 'VENMO',
        'status': 'PARSED',
        'uploadedAt': '2026-07-06T00:00:00.000Z',
        'counts': {
          'total': 7,
          'pending': 5,
          'confirmed': 1,
          'dismissed': 1,
          'duplicates': 2,
        },
      });

      expect(statement.counts?.total, 7);
      expect(statement.counts?.duplicates, 2);
    });
  });

  group('HarmonyLedgerData', () {
    test('parses the entries response and computes group flows', () {
      final data = HarmonyLedgerData.fromJson({
        'entries': [
          {
            'entryId': 'ent_1',
            'type': 'DONATION',
            'amount': 60,
            'currency': 'USD',
            'description': 'community kitchen',
            'recordedAt': '2026-07-01T00:00:00.000Z',
            'occurredAt': '2026-06-25',
          },
        ],
        'totals': {
          'donations': 60,
          'income': 0,
          'expenses': 10,
          'reimbursements': 0,
          'net': 50,
        },
        'groups': [
          {'groupId': 'highlyte', 'name': 'Highlyte', 'isActive': true},
        ],
        'groupSummaries': [
          {
            'groupId': 'highlyte',
            'name': 'Highlyte',
            'donations': 60,
            'income': 5,
            'expenses': 10,
            'reimbursements': 0,
            'transfersIn': 15,
            'transfersOut': 20,
            'net': 50,
          },
        ],
      });

      expect(data.entries.single.isInflow, isTrue);
      expect(data.totals.net, 50);
      final summary = data.groupSummaries.single;
      expect(summary.inflow, 80); // 60 + 5 + 0 + 15
      expect(summary.outflow, 30); // 10 + 20
    });
  });
}
