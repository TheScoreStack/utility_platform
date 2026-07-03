/// Dart port of `packages/shared/src/splitMath.ts`.
///
/// The API recomputes stored allocations with the TypeScript original, so this
/// port must match it exactly (integer-cents math, per-item even split with
/// leftover cents rotated by item index, extras via largest-remainder or even).
library;

class ItemizedLineItem {
  final double total;
  final List<String> assignedMemberIds;

  const ItemizedLineItem({
    required this.total,
    required this.assignedMemberIds,
  });
}

class ItemizedAllocationDetail {
  final String memberId;
  final double itemsAmount;
  final double extrasAmount;
  final double amount;

  const ItemizedAllocationDetail({
    required this.memberId,
    required this.itemsAmount,
    required this.extrasAmount,
    required this.amount,
  });
}

class ItemizedAllocationResult {
  final List<ItemizedAllocationDetail> allocations;
  final double itemsSubtotal;
  final double extrasTotal;
  final double grandTotal;

  const ItemizedAllocationResult({
    required this.allocations,
    required this.itemsSubtotal,
    required this.extrasTotal,
    required this.grandTotal,
  });
}

double roundCents(double value) => (value * 100).roundToDouble() / 100;

int _toCents(double value) => (value * 100).round();

/// Converts per-line-item member assignments into cent-accurate per-person
/// allocations. Each item's cost is split evenly among the members assigned to
/// it; tax + tip are then layered on top either proportionally to each
/// person's item subtotal or evenly across everyone with an assignment.
/// The returned allocation amounts always sum exactly to
/// items subtotal + tax + tip.
ItemizedAllocationResult buildItemizedAllocations({
  required List<ItemizedLineItem> lineItems,
  double tax = 0,
  double tip = 0,
  String extrasSplitMode = 'proportional',
}) {
  // Member order is first appearance across items so results are stable.
  final memberOrder = <String>[];
  final itemCentsByMember = <String, int>{};
  void track(String memberId) {
    if (!itemCentsByMember.containsKey(memberId)) {
      itemCentsByMember[memberId] = 0;
      memberOrder.add(memberId);
    }
  }

  var itemsSubtotalCents = 0;
  for (var itemIndex = 0; itemIndex < lineItems.length; itemIndex += 1) {
    final item = lineItems[itemIndex];
    final assigned = item.assignedMemberIds;
    if (assigned.isEmpty) continue;
    final cents = _toCents(item.total);
    itemsSubtotalCents += cents;

    final base = cents ~/ assigned.length;
    var remainder = cents - base * assigned.length;
    for (final memberId in assigned) {
      track(memberId);
    }
    // Rotate who absorbs leftover cents by item index so no single member
    // is systematically overcharged across a long receipt.
    for (var i = 0; i < assigned.length; i += 1) {
      final memberId = assigned[(i + itemIndex) % assigned.length];
      var share = base;
      if (remainder > 0) {
        share += 1;
        remainder -= 1;
      }
      itemCentsByMember[memberId] = (itemCentsByMember[memberId] ?? 0) + share;
    }
  }

  final extrasCents = _toCents(tax) + _toCents(tip);
  final extrasByMember = <String, int>{};

  if (memberOrder.isNotEmpty && extrasCents != 0) {
    if (extrasSplitMode == 'even' || itemsSubtotalCents == 0) {
      final base = extrasCents ~/ memberOrder.length;
      var remainder = extrasCents - base * memberOrder.length;
      for (final memberId in memberOrder) {
        var share = base;
        if (remainder > 0) {
          share += 1;
          remainder -= 1;
        }
        extrasByMember[memberId] = share;
      }
    } else {
      // Largest-remainder method: floor each proportional share, then hand
      // leftover cents to the members with the biggest truncated fraction.
      var assignedCents = 0;
      final fractions = <({String memberId, int index, double fraction})>[];
      for (var index = 0; index < memberOrder.length; index += 1) {
        final memberId = memberOrder[index];
        final itemCents = itemCentsByMember[memberId] ?? 0;
        final exact = (extrasCents * itemCents) / itemsSubtotalCents;
        final floored = exact.floor();
        assignedCents += floored;
        extrasByMember[memberId] = floored;
        fractions.add((
          memberId: memberId,
          index: index,
          fraction: exact - floored,
        ));
      }
      var leftover = extrasCents - assignedCents;
      fractions.sort((a, b) {
        final byFraction = b.fraction.compareTo(a.fraction);
        if (byFraction != 0) return byFraction;
        return a.index.compareTo(b.index);
      });
      for (final entry in fractions) {
        if (leftover <= 0) break;
        extrasByMember[entry.memberId] =
            (extrasByMember[entry.memberId] ?? 0) + 1;
        leftover -= 1;
      }
    }
  }

  final allocations = memberOrder.map((memberId) {
    final itemsCents = itemCentsByMember[memberId] ?? 0;
    final extras = extrasByMember[memberId] ?? 0;
    return ItemizedAllocationDetail(
      memberId: memberId,
      itemsAmount: itemsCents / 100,
      extrasAmount: extras / 100,
      amount: (itemsCents + extras) / 100,
    );
  }).toList();

  return ItemizedAllocationResult(
    allocations: allocations,
    itemsSubtotal: itemsSubtotalCents / 100,
    extrasTotal: extrasCents / 100,
    grandTotal:
        (itemsSubtotalCents + (memberOrder.isNotEmpty ? extrasCents : 0)) / 100,
  );
}
