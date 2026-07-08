// Ports all cases from services/api/src/lib/splitMath.test.ts so the Dart
// port and the API's TypeScript implementation can never drift apart.
import 'package:flutter_test/flutter_test.dart';
import 'package:platform_mobile/core/split_math.dart';

double sumAllocations(List<ItemizedAllocationDetail> allocations) {
  final total = allocations.fold<double>(0, (sum, a) => sum + a.amount);
  return (total * 100).roundToDouble() / 100;
}

Map<String, double> amountsByMember(
  List<ItemizedAllocationDetail> allocations,
) => {for (final a in allocations) a.memberId: a.amount};

void main() {
  group('buildItemizedAllocations', () {
    test('splits each item evenly among its assigned members', () {
      final result = buildItemizedAllocations(
        lineItems: const [
          ItemizedLineItem(total: 20, assignedMemberIds: ['a', 'b']),
          ItemizedLineItem(total: 10, assignedMemberIds: ['b']),
        ],
      );

      expect(result.itemsSubtotal, 30);
      expect(result.grandTotal, 30);
      expect(result.allocations.length, 2);
      expect(result.allocations[0].memberId, 'a');
      expect(result.allocations[0].amount, 10);
      expect(result.allocations[1].memberId, 'b');
      expect(result.allocations[1].amount, 20);
    });

    test("keeps cent remainders inside the item's assigned members", () {
      final result = buildItemizedAllocations(
        lineItems: const [
          ItemizedLineItem(total: 10, assignedMemberIds: ['a', 'b', 'c']),
        ],
      );

      expect(sumAllocations(result.allocations), 10);
      final amounts = result.allocations.map((a) => a.amount).toList()..sort();
      expect(amounts, [3.33, 3.33, 3.34]);
    });

    test('rotates remainder cents across items so one member is not always '
        'charged extra', () {
      final result = buildItemizedAllocations(
        lineItems: const [
          ItemizedLineItem(total: 10, assignedMemberIds: ['a', 'b', 'c']),
          ItemizedLineItem(total: 10, assignedMemberIds: ['a', 'b', 'c']),
          ItemizedLineItem(total: 10, assignedMemberIds: ['a', 'b', 'c']),
        ],
      );

      expect(sumAllocations(result.allocations), 30);
      // Each member absorbs the extra cent exactly once across the 3 items.
      expect(result.allocations.map((a) => a.amount).toList(), [10, 10, 10]);
    });

    test(
      "allocates tax and tip proportionally to each member's item subtotal",
      () {
        final result = buildItemizedAllocations(
          lineItems: const [
            ItemizedLineItem(total: 30, assignedMemberIds: ['a']),
            ItemizedLineItem(total: 10, assignedMemberIds: ['b']),
          ],
          tax: 4,
          tip: 8,
          extrasSplitMode: 'proportional',
        );

        // a has 75% of the items, b has 25% — extras total 12.
        final byMember = amountsByMember(result.allocations);
        expect(byMember['a'], 39);
        expect(byMember['b'], 13);
        expect(result.grandTotal, 52);
      },
    );

    test('distributes leftover extras cents by largest remainder and still '
        'sums exactly', () {
      final result = buildItemizedAllocations(
        lineItems: const [
          ItemizedLineItem(total: 10, assignedMemberIds: ['a']),
          ItemizedLineItem(total: 10, assignedMemberIds: ['b']),
          ItemizedLineItem(total: 10, assignedMemberIds: ['c']),
        ],
        tax: 1,
        extrasSplitMode: 'proportional',
      );

      expect(sumAllocations(result.allocations), 31);
      final amounts = result.allocations.map((a) => a.amount).toList()..sort();
      expect(amounts, [10.33, 10.33, 10.34]);
    });

    test('splits extras evenly when requested regardless of item share', () {
      final result = buildItemizedAllocations(
        lineItems: const [
          ItemizedLineItem(total: 90, assignedMemberIds: ['a']),
          ItemizedLineItem(total: 10, assignedMemberIds: ['b']),
        ],
        tax: 5,
        tip: 5,
        extrasSplitMode: 'even',
      );

      final byMember = amountsByMember(result.allocations);
      expect(byMember['a'], 95);
      expect(byMember['b'], 15);
    });

    test(
      'shares an item among multiple members while others keep their own',
      () {
        final result = buildItemizedAllocations(
          lineItems: const [
            ItemizedLineItem(total: 24, assignedMemberIds: ['a', 'b', 'c']),
            ItemizedLineItem(total: 15.5, assignedMemberIds: ['a']),
            ItemizedLineItem(total: 9.25, assignedMemberIds: ['c']),
          ],
          tax: 3.9,
          tip: 9.75,
          extrasSplitMode: 'proportional',
        );

        expect(
          sumAllocations(result.allocations),
          24 + 15.5 + 9.25 + 3.9 + 9.75,
        );
        final byMember = amountsByMember(result.allocations);
        // a: 8 + 15.50 = 23.50 of 48.75 items; b: 8; c: 17.25
        expect(byMember['a']! > byMember['c']!, isTrue);
        expect(byMember['c']! > byMember['b']!, isTrue);
      },
    );

    test('ignores items with no assigned members', () {
      final result = buildItemizedAllocations(
        lineItems: const [
          ItemizedLineItem(total: 10, assignedMemberIds: ['a']),
          ItemizedLineItem(total: 99, assignedMemberIds: []),
        ],
      );

      expect(result.itemsSubtotal, 10);
      expect(result.allocations.length, 1);
      expect(result.allocations.single.memberId, 'a');
      expect(result.allocations.single.amount, 10);
    });

    test('attributes unassigned items to unassignedMemberId when provided',
        () {
      final result = buildItemizedAllocations(
        lineItems: const [
          ItemizedLineItem(total: 10, assignedMemberIds: ['a']),
          ItemizedLineItem(total: 30, assignedMemberIds: []),
        ],
        unassignedMemberId: 'payer',
      );

      expect(result.itemsSubtotal, 40);
      final amounts = amountsByMember(result.allocations);
      expect(amounts['a'], 10);
      expect(amounts['payer'], 30);
    });

    test(
        'pro-rates extras against the full bill when unclaimed items ride '
        'with the payer', () {
      // The split-link rule: a claims 25 of the 100 in items, so their
      // tax+tip share is exactly 25% — no matter how much is still unclaimed.
      final result = buildItemizedAllocations(
        lineItems: const [
          ItemizedLineItem(total: 25, assignedMemberIds: ['a']),
          ItemizedLineItem(total: 75, assignedMemberIds: []),
        ],
        tax: 8,
        tip: 12,
        unassignedMemberId: 'payer',
      );

      final amounts = amountsByMember(result.allocations);
      expect(amounts['a'], 30);
      expect(amounts['payer'], 90);
      expect(sumAllocations(result.allocations), 120);
    });

    test('falls back to an even extras split when items subtotal is zero', () {
      final result = buildItemizedAllocations(
        lineItems: const [
          ItemizedLineItem(total: 0, assignedMemberIds: ['a', 'b']),
        ],
        tip: 10,
        extrasSplitMode: 'proportional',
      );

      final byMember = amountsByMember(result.allocations);
      expect(byMember['a'], 5);
      expect(byMember['b'], 5);
    });
  });

  group('splitTotalIntoUnits', () {
    test('splits an even quantity line into equal units', () {
      expect(splitTotalIntoUnits(68, 4), [17.0, 17.0, 17.0, 17.0]);
    });

    test('gives leftover cents to the first units and sums exactly', () {
      final units = splitTotalIntoUnits(10, 3);
      expect(units, [3.34, 3.33, 3.33]);
      expect(units.reduce((a, b) => a + b), closeTo(10, 0.0001));
    });

    test('returns the total untouched for quantity 1', () {
      expect(splitTotalIntoUnits(16, 1), [16.0]);
    });
  });
}
