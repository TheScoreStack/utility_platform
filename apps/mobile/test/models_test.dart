import 'package:flutter_test/flutter_test.dart';
import 'package:platform_mobile/models/models.dart';

void main() {
  group('Expense', () {
    test('round-trips an itemized expense through fromJson/toJson', () {
      final json = <String, dynamic>{
        'tripId': 'trip_1',
        'expenseId': 'exp_1',
        'createdAt': '2026-06-01T12:00:00.000Z',
        'updatedAt': '2026-06-01T12:00:00.000Z',
        'description': 'Dinner',
        'vendor': 'Blue Bistro',
        'total': 52,
        'currency': 'USD',
        'tax': 4,
        'tip': 8,
        'paidByMemberId': 'a',
        'sharedWithMemberIds': ['a', 'b'],
        'allocations': [
          {'memberId': 'a', 'amount': 39},
          {'memberId': 'b', 'amount': 13},
        ],
        'lineItems': [
          {
            'lineItemId': 'li_1',
            'description': 'Steak',
            'total': 30,
            'assignedMemberIds': ['a'],
          },
          {
            'lineItemId': 'li_2',
            'description': 'Pasta',
            'quantity': 1,
            'unitPrice': 10,
            'total': 10,
            'assignedMemberIds': ['b'],
          },
        ],
        'extrasSplitMode': 'proportional',
        'receiptId': 'rcpt_1',
      };

      final expense = Expense.fromJson(json);
      expect(expense.description, 'Dinner');
      expect(expense.total, 52);
      expect(expense.tax, 4);
      expect(expense.lineItems, hasLength(2));
      expect(expense.lineItems![0].assignedMemberIds, ['a']);
      expect(expense.lineItems![1].unitPrice, 10);
      expect(expense.allocations[1].amount, 13);

      expect(expense.toJson(), json);
    });

    test('tolerates missing optional fields', () {
      final expense = Expense.fromJson(const {
        'tripId': 'trip_1',
        'expenseId': 'exp_2',
        'description': 'Taxi',
        'total': 12.5,
        'paidByMemberId': 'a',
      });

      expect(expense.total, 12.5);
      expect(expense.currency, 'USD');
      expect(expense.tax, isNull);
      expect(expense.lineItems, isNull);
      expect(expense.allocations, isEmpty);
      expect(expense.sharedWithMemberIds, isEmpty);
      expect(expense.draft, isFalse);
      expect(expense.createdBy, isNull);
    });

    test('round-trips a draft expense with createdBy', () {
      final json = <String, dynamic>{
        'tripId': 'trip_1',
        'expenseId': 'exp_3',
        'createdAt': '2026-06-02T09:00:00.000Z',
        'updatedAt': '2026-06-02T09:00:00.000Z',
        'description': 'Groceries',
        'total': 41.2,
        'currency': 'USD',
        'paidByMemberId': 'a',
        'sharedWithMemberIds': ['a', 'b'],
        'allocations': [
          {'memberId': 'a', 'amount': 20.6},
          {'memberId': 'b', 'amount': 20.6},
        ],
        'draft': true,
        'createdBy': 'a',
      };

      final expense = Expense.fromJson(json);
      expect(expense.draft, isTrue);
      expect(expense.createdBy, 'a');
      expect(expense.toJson(), json);
    });
  });

  group('Receipt', () {
    test('parses draft and createdBy, defaulting draft to false', () {
      final draftReceipt = Receipt.fromJson(const {
        'tripId': 'trip_1',
        'receiptId': 'rcpt_1',
        'storageKey': 'k',
        'uploadUrl': 'https://example.com/put',
        'fileName': 'r.jpg',
        'status': 'PENDING_UPLOAD',
        'draft': true,
        'createdBy': 'a',
        'createdAt': '2026-06-02T09:00:00.000Z',
        'updatedAt': '2026-06-02T09:00:00.000Z',
      });
      expect(draftReceipt.draft, isTrue);
      expect(draftReceipt.createdBy, 'a');

      final plain = Receipt.fromJson(const {
        'tripId': 'trip_1',
        'receiptId': 'rcpt_2',
      });
      expect(plain.draft, isFalse);
      expect(plain.createdBy, isNull);
    });
  });

  group('TextractExtraction', () {
    test('round-trips an extraction with items', () {
      final json = <String, dynamic>{
        'merchantName': 'Corner Deli',
        'total': 23.45,
        'subtotal': 20,
        'tax': 1.45,
        'tip': 2,
        'date': '2026-06-01',
        'lineItems': [
          {
            'description': 'Sandwich',
            'quantity': 2,
            'unitPrice': 7.5,
            'total': 15,
          },
          {'description': 'Soda', 'total': 5},
        ],
      };

      final extraction = TextractExtraction.fromJson(json);
      expect(extraction.merchantName, 'Corner Deli');
      expect(extraction.lineItems, hasLength(2));
      expect(extraction.lineItems[0].quantity, 2);
      expect(extraction.lineItems[1].total, 5);

      expect(extraction.toJson(), json);
    });

    test('tolerates an empty extraction', () {
      final extraction = TextractExtraction.fromJson(const {});
      expect(extraction.merchantName, isNull);
      expect(extraction.lineItems, isEmpty);
    });
  });

  group('TripListItem', () {
    test('parses trip fields plus balance summary', () {
      final item = TripListItem.fromJson(const {
        'tripId': 'trip_1',
        'ownerId': 'a',
        'name': 'Tahoe',
        'startDate': '2026-06-03',
        'endDate': '2026-06-09',
        'createdAt': '2026-05-01T00:00:00.000Z',
        'updatedAt': '2026-05-01T00:00:00.000Z',
        'currency': 'USD',
        'outstandingBalance': 0,
        'owedToYou': 42.5,
        'hasPendingActions': true,
      });

      expect(item.trip.name, 'Tahoe');
      expect(item.owedToYou, 42.5);
      expect(item.outstandingBalance, 0);
      expect(item.hasPendingActions, isTrue);
    });
  });

  group('TripSummary', () {
    test('parses the GET /trips/:id shape', () {
      final summary = TripSummary.fromJson(const {
        'trip': {
          'tripId': 'trip_1',
          'ownerId': 'a',
          'name': 'Tahoe',
          'createdAt': '2026-05-01T00:00:00.000Z',
          'updatedAt': '2026-05-01T00:00:00.000Z',
          'currency': 'USD',
        },
        'members': [
          {
            'tripId': 'trip_1',
            'memberId': 'a',
            'displayName': 'Hunter Adam',
            'addedBy': 'a',
            'createdAt': '2026-05-01T00:00:00.000Z',
          },
        ],
        'expenses': [],
        'deletedExpenses': [],
        'receipts': [],
        'settlements': [],
        'deletedSettlements': [],
        'balances': [
          {'memberId': 'a', 'displayName': 'Hunter Adam', 'balance': -12.34},
        ],
        'pendingSettlements': [],
        'currentUserId': 'a',
      });

      expect(summary.trip.tripId, 'trip_1');
      expect(summary.members.single.displayName, 'Hunter Adam');
      expect(summary.balances.single.balance, -12.34);
      expect(summary.currentUserId, 'a');
      // draftExpenses absent (older API responses) → empty, never null.
      expect(summary.draftExpenses, isEmpty);
    });

    test('parses draftExpenses separately from published expenses', () {
      final summary = TripSummary.fromJson(const {
        'trip': {
          'tripId': 'trip_1',
          'ownerId': 'a',
          'name': 'Tahoe',
          'createdAt': '2026-05-01T00:00:00.000Z',
          'updatedAt': '2026-05-01T00:00:00.000Z',
          'currency': 'USD',
        },
        'members': [],
        'expenses': [
          {
            'tripId': 'trip_1',
            'expenseId': 'exp_pub',
            'description': 'Dinner',
            'total': 20,
            'paidByMemberId': 'a',
          },
        ],
        'draftExpenses': [
          {
            'tripId': 'trip_1',
            'expenseId': 'exp_draft',
            'description': 'Groceries',
            'total': 41.2,
            'paidByMemberId': 'a',
            'draft': true,
            'createdBy': 'a',
          },
        ],
        'deletedExpenses': [],
        'receipts': [],
        'settlements': [],
        'deletedSettlements': [],
        'balances': [],
        'pendingSettlements': [],
        'currentUserId': 'a',
      });

      expect(summary.expenses.single.expenseId, 'exp_pub');
      expect(summary.draftExpenses.single.expenseId, 'exp_draft');
      expect(summary.draftExpenses.single.draft, isTrue);
      expect(summary.draftExpenses.single.createdBy, 'a');
    });
  });
}
