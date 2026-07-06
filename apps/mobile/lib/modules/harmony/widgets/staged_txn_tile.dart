import 'package:flutter/material.dart';

import '../../../core/app_theme.dart';
import '../../../core/formatters.dart';
import '../models/harmony_models.dart';

const Map<String, String> kEntryTypeLabels = {
  'DONATION': 'Donation',
  'INCOME': 'Income',
  'EXPENSE': 'Expense',
  'REIMBURSEMENT': 'Reimbursement',
};

/// One staged transaction in the review queue: date, description, signed
/// amount, plus tappable type/group chips and duplicate/transfer badges.
class StagedTxnTile extends StatelessWidget {
  final HarmonyStagedTxn txn;

  /// Type/group as currently chosen by the user (may differ from the AI
  /// suggestion stored on [txn]).
  final String type;
  final String? groupName;
  final bool busy;
  final VoidCallback? onTypeTap;
  final VoidCallback? onGroupTap;

  /// Shown as a "Restore" action on dismissed transactions.
  final VoidCallback? onRestore;

  /// Shown as an "Undo" action on confirmed transactions (removes the
  /// created ledger entry and re-queues the transaction).
  final VoidCallback? onUndo;

  const StagedTxnTile({
    super.key,
    required this.txn,
    required this.type,
    required this.groupName,
    this.busy = false,
    this.onTypeTap,
    this.onGroupTap,
    this.onRestore,
    this.onUndo,
  });

  @override
  Widget build(BuildContext context) {
    final amountColor = txn.isInflow ? AppColors.positive : AppColors.danger;
    final sign = txn.isInflow ? '+' : '−';
    final reviewed = !txn.isPending;

    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: Colors.white10),
      ),
      child: Opacity(
        opacity: reviewed ? 0.55 : 1,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          txn.rawDescription,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          [
                            txn.txnDate,
                            if (txn.counterparty != null) txn.counterparty!,
                          ].join(' · '),
                          style: const TextStyle(
                            fontSize: 12,
                            color: Colors.white54,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    '$sign${formatCurrency(txn.amount, txn.currency)}',
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      fontFeatures: kTabularFigures,
                      color: amountColor,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                runSpacing: 2,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  ActionChip(
                    label: Text(kEntryTypeLabels[type] ?? type),
                    visualDensity: VisualDensity.compact,
                    onPressed: reviewed || busy ? null : onTypeTap,
                  ),
                  ActionChip(
                    avatar: const Icon(Icons.folder_outlined, size: 16),
                    label: Text(groupName ?? 'Unallocated'),
                    visualDensity: VisualDensity.compact,
                    onPressed: reviewed || busy ? null : onGroupTap,
                  ),
                  if (txn.suggestedCategory != null)
                    _Badge(
                      label: txn.suggestedCategory!,
                      color: AppColors.accent,
                    ),
                  if (txn.isDuplicate)
                    const _Badge(
                      label: 'Possible duplicate',
                      color: AppColors.warning,
                    ),
                  if (txn.isLikelyInternalTransfer)
                    const _Badge(
                      label: 'Internal transfer?',
                      color: AppColors.warning,
                    ),
                  if (txn.status == 'CONFIRMED') ...[
                    _Badge(
                      label: txn.reviewedByName != null
                          ? 'Confirmed by ${txn.reviewedByName}'
                          : 'Confirmed',
                      color: AppColors.positive,
                    ),
                    if (onUndo != null)
                      ActionChip(
                        avatar: const Icon(Icons.undo_rounded, size: 16),
                        label: const Text('Undo'),
                        visualDensity: VisualDensity.compact,
                        onPressed: busy ? null : onUndo,
                      ),
                  ],
                  if (txn.status == 'DISMISSED') ...[
                    _Badge(
                      label: txn.reviewedByName != null
                          ? 'Skipped by ${txn.reviewedByName}'
                          : 'Skipped',
                      color: Colors.white54,
                    ),
                    if (onRestore != null)
                      ActionChip(
                        avatar: const Icon(Icons.undo_rounded, size: 16),
                        label: const Text('Restore'),
                        visualDensity: VisualDensity.compact,
                        onPressed: busy ? null : onRestore,
                      ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  final String label;
  final Color color;

  const _Badge({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Text(label, style: TextStyle(fontSize: 11, color: color)),
    );
  }
}
