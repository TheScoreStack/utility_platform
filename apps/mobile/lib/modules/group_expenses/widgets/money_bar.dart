import 'package:flutter/material.dart';

import '../../../core/formatters.dart';
import '../../../core/split_math.dart';
import '../../../models/models.dart';
import 'member_avatar.dart';

/// Sticky bottom "money bar": per-person running totals, always visible while
/// assigning items, with an items + extras = total caption underneath.
class PerPersonMoneyBar extends StatelessWidget {
  final ItemizedAllocationResult result;
  final Map<String, TripMember> membersById;
  final String currency;

  const PerPersonMoneyBar({
    super.key,
    required this.result,
    required this.membersById,
    required this.currency,
  });

  @override
  Widget build(BuildContext context) {
    final caption =
        '${formatCurrency(result.itemsSubtotal, currency)} items + '
        '${formatCurrency(result.extrasTotal, currency)} tax & tip = '
        '${formatCurrency(result.grandTotal, currency)}';

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          height: 64,
          child: result.allocations.isEmpty
              ? const Center(
                  child: Text(
                    'Assign items to see who owes what',
                    style: TextStyle(color: Colors.white70, fontSize: 13),
                  ),
                )
              : ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: result.allocations.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 16),
                  itemBuilder: (context, index) {
                    final allocation = result.allocations[index];
                    final member = membersById[allocation.memberId];
                    final name = firstName(
                      member?.displayName ?? allocation.memberId,
                    );
                    return Row(
                      children: [
                        MemberAvatar(
                          memberId: allocation.memberId,
                          displayName: member?.displayName ?? '?',
                          radius: 16,
                        ),
                        const SizedBox(width: 8),
                        Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              name,
                              style: const TextStyle(
                                fontSize: 12,
                                color: Colors.white70,
                              ),
                            ),
                            Text(
                              formatCurrency(allocation.amount, currency),
                              style: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      ],
                    );
                  },
                ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
          child: Text(
            caption,
            style: const TextStyle(fontSize: 12, color: Colors.white70),
          ),
        ),
      ],
    );
  }
}
