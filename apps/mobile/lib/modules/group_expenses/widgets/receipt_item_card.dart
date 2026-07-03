import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/app_theme.dart';
import '../../../core/formatters.dart';
import '../../../models/models.dart';
import 'member_avatar.dart';

/// Mutable line-item state owned by the scan review screen. Controllers stay
/// alive across rebuilds; the screen disposes them.
class EditableReceiptItem {
  static int _nextId = 0;

  final String id;
  final TextEditingController descriptionController;
  final TextEditingController amountController;
  final Set<String> assignedMemberIds;

  EditableReceiptItem({
    String description = '',
    double? amount,
    Iterable<String> assignedMemberIds = const [],
  }) : id = 'item_${_nextId++}',
       descriptionController = TextEditingController(text: description),
       amountController = TextEditingController(
         text: amount == null ? '' : amount.toStringAsFixed(2),
       ),
       assignedMemberIds = {...assignedMemberIds};

  String get description => descriptionController.text.trim();

  double get amount =>
      double.tryParse(amountController.text.trim().replaceAll(',', '.')) ?? 0;

  void dispose() {
    descriptionController.dispose();
    amountController.dispose();
  }
}

/// One parsed receipt line: editable description + amount, an avatar-chip Wrap
/// to toggle who shared it, and swipe-to-delete via [Dismissible].
class ReceiptItemCard extends StatelessWidget {
  final EditableReceiptItem item;
  final List<TripMember> members;
  final String currency;
  final VoidCallback onChanged;
  final VoidCallback onRemoved;

  const ReceiptItemCard({
    super.key,
    required this.item,
    required this.members,
    required this.currency,
    required this.onChanged,
    required this.onRemoved,
  });

  @override
  Widget build(BuildContext context) {
    final needsAssignees = item.amount > 0 && item.assignedMemberIds.isEmpty;
    final shareCount = item.assignedMemberIds.length;
    const amber = AppColors.warning;

    return Dismissible(
      key: ValueKey(item.id),
      direction: DismissDirection.endToStart,
      onDismissed: (_) {
        HapticFeedback.lightImpact();
        onRemoved();
      },
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 24),
        margin: const EdgeInsets.symmetric(vertical: 4),
        decoration: BoxDecoration(
          color: AppColors.danger.withValues(alpha: 0.85),
          borderRadius: BorderRadius.circular(12),
        ),
        child: const Icon(Icons.delete_outline, color: Colors.white),
      ),
      child: Card(
        margin: const EdgeInsets.symmetric(vertical: 4),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: needsAssignees ? amber : Colors.white10),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: item.descriptionController,
                      onChanged: (_) => onChanged(),
                      textCapitalization: TextCapitalization.sentences,
                      decoration: const InputDecoration(
                        hintText: 'Item description',
                        isDense: true,
                        border: InputBorder.none,
                      ),
                      style: const TextStyle(fontWeight: FontWeight.w500),
                    ),
                  ),
                  const SizedBox(width: 12),
                  SizedBox(
                    width: 92,
                    child: TextField(
                      controller: item.amountController,
                      onChanged: (_) => onChanged(),
                      textAlign: TextAlign.right,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      inputFormatters: [
                        FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
                      ],
                      decoration: InputDecoration(
                        hintText: '0.00',
                        prefixText: currencySymbol(currency),
                        prefixStyle: const TextStyle(
                          color: Colors.white38,
                          fontSize: 13,
                        ),
                        isDense: true,
                        border: InputBorder.none,
                      ),
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 16,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Wrap(
                spacing: 6,
                runSpacing: 2,
                children: members
                    .map(
                      (member) => MemberToggleChip(
                        memberId: member.memberId,
                        displayName: firstName(member.displayName),
                        selected: item.assignedMemberIds.contains(
                          member.memberId,
                        ),
                        onTap: () {
                          if (!item.assignedMemberIds.remove(member.memberId)) {
                            item.assignedMemberIds.add(member.memberId);
                          }
                          onChanged();
                        },
                      ),
                    )
                    .toList(),
              ),
              const SizedBox(height: 6),
              if (needsAssignees)
                Text(
                  'Pick who shared this',
                  style: TextStyle(fontSize: 12, color: amber),
                )
              else if (shareCount > 0 && item.amount > 0)
                Text(
                  '${formatCurrency(item.amount / shareCount, currency)} each · '
                  '$shareCount ${shareCount == 1 ? 'person' : 'people'}',
                  style: const TextStyle(fontSize: 12, color: Colors.white70),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
