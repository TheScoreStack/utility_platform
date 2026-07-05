import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../../../core/formatters.dart';
import '../../../core/split_math.dart';
import '../../../models/models.dart';
import 'member_avatar.dart';

class QuickExpenseResult {
  final double total;
  final int peopleCount;
  final String currency;

  /// True when the expense was saved as a private draft.
  final bool draft;

  const QuickExpenseResult({
    required this.total,
    required this.peopleCount,
    required this.currency,
    this.draft = false,
  });
}

/// Compact bottom-sheet form for a manual, evenly split expense: big amount
/// field, description, payer, member chips. POSTs with `splitEvenly: true`
/// plus cent-exact allocations matching the server's even-split math.
///
/// With [initialExpense] it edits in place via PATCH, re-splitting evenly
/// across the selected members. Draft/published status is left untouched.
Future<QuickExpenseResult?> showQuickExpenseSheet({
  required BuildContext context,
  required ApiClient api,
  required TripSummary summary,
  Expense? initialExpense,
  bool duplicate = false,
}) {
  return showModalBottomSheet<QuickExpenseResult>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _QuickExpenseSheet(
      api: api,
      summary: summary,
      initialExpense: initialExpense,
      duplicate: duplicate,
    ),
  );
}

class _QuickExpenseSheet extends StatefulWidget {
  final ApiClient api;
  final TripSummary summary;
  final Expense? initialExpense;

  /// With [initialExpense], saves a NEW expense seeded from it instead of
  /// editing in place.
  final bool duplicate;

  const _QuickExpenseSheet({
    required this.api,
    required this.summary,
    this.initialExpense,
    this.duplicate = false,
  });

  @override
  State<_QuickExpenseSheet> createState() => _QuickExpenseSheetState();
}

class _QuickExpenseSheetState extends State<_QuickExpenseSheet> {
  final _amountController = TextEditingController();
  final _descriptionController = TextEditingController();
  late String _payerId;
  late final Set<String> _selectedMemberIds;
  bool _saving = false;
  bool _savingAsDraft = false;
  String? _error;

  /// 'none' | 'weekly' | 'monthly' — creates a repeating template alongside
  /// the expense. Only offered when creating (not editing).
  String _cadence = 'none';

  List<TripMember> get _members => widget.summary.members;

  String get _currency => widget.summary.trip.currency;

  bool get _isEditing => widget.initialExpense != null && !widget.duplicate;

  @override
  void initState() {
    super.initState();
    final memberIds = _members.map((member) => member.memberId).toSet();
    final initial = widget.initialExpense;
    if (initial != null) {
      _amountController.text = initial.total.toStringAsFixed(2);
      _descriptionController.text = initial.description;
      _payerId = memberIds.contains(initial.paidByMemberId)
          ? initial.paidByMemberId
          : _members.first.memberId;
      final shared = initial.sharedWithMemberIds
          .where(memberIds.contains)
          .toSet();
      _selectedMemberIds = shared.isEmpty ? {...memberIds} : shared;
    } else {
      _payerId = memberIds.contains(widget.summary.currentUserId)
          ? widget.summary.currentUserId
          : _members.first.memberId;
      _selectedMemberIds = {...memberIds};
    }
  }

  @override
  void dispose() {
    _amountController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  double get _amount =>
      double.tryParse(_amountController.text.trim().replaceAll(',', '.')) ?? 0;

  String? get _blockedReason {
    if (_amount <= 0) return 'Enter an amount';
    if (_selectedMemberIds.isEmpty) return 'Pick who shared it';
    return null;
  }

  Future<void> _save({required bool draft}) async {
    final total = roundCents(_amount);
    final memberIds = _members
        .map((member) => member.memberId)
        .where(_selectedMemberIds.contains)
        .toList();
    // Matches the server's resolveRemainderTarget: paidBy absorbs leftover
    // cents when included in the split, otherwise the last member does.
    final allocations = buildEvenSplitAllocations(
      total,
      memberIds,
      remainderMemberId: _payerId,
    );
    final description = _descriptionController.text.trim();

    setState(() {
      _saving = true;
      _savingAsDraft = draft;
      _error = null;
    });
    try {
      final payload = {
        'description': description.isEmpty ? 'Expense' : description,
        'total': total,
        'currency': _currency,
        'paidByMemberId': _payerId,
        'sharedWithMemberIds': memberIds,
        'splitEvenly': true,
        'allocations': allocations
            .map((a) => {'memberId': a.memberId, 'amount': a.amount})
            .toList(),
        if (draft) 'draft': true,
      };
      final tripId = widget.summary.trip.tripId;
      if (_isEditing) {
        // PATCH keeps draft/published status as-is; publishing stays a
        // separate explicit action.
        await widget.api.patch(
          '/trips/$tripId/expenses/${widget.initialExpense!.expenseId}',
          payload,
        );
      } else {
        await widget.api.post('/trips/$tripId/expenses', payload);
        if (_cadence != 'none') {
          // Today's expense was just recorded; the template takes over from
          // the next cycle.
          await widget.api.post('/trips/$tripId/recurring', {
            'description': description.isEmpty ? 'Expense' : description,
            'total': total,
            'currency': _currency,
            'paidByMemberId': _payerId,
            'sharedWithMemberIds': memberIds,
            'cadence': _cadence,
          });
        }
      }
      if (!mounted) return;
      HapticFeedback.mediumImpact();
      Navigator.of(context).pop(
        QuickExpenseResult(
          total: total,
          peopleCount: memberIds.length,
          currency: _currency,
          draft: _isEditing ? widget.initialExpense!.draft : draft,
        ),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = error.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = 'Could not save the expense.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final blockedReason = _blockedReason;
    final perHead = _selectedMemberIds.isEmpty || _amount <= 0
        ? null
        : _amount / _selectedMemberIds.length;

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 16,
          bottom: MediaQuery.of(context).viewInsets.bottom + 16,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                _isEditing
                    ? (widget.initialExpense!.draft
                          ? 'Edit draft'
                          : 'Edit expense')
                    : 'Quick expense',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 4),
              const Text(
                'Split evenly across everyone selected.',
                style: TextStyle(fontSize: 12, color: Colors.white70),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _amountController,
                autofocus: true,
                enabled: !_saving,
                onChanged: (_) => setState(() {}),
                textAlign: TextAlign.center,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
                ],
                style: const TextStyle(
                  fontSize: 34,
                  fontWeight: FontWeight.w700,
                  fontFeatures: kTabularFigures,
                ),
                decoration: InputDecoration(
                  hintText: '0.00',
                  hintStyle: TextStyle(
                    fontSize: 34,
                    fontWeight: FontWeight.w700,
                    color: Colors.white.withValues(alpha: 0.25),
                  ),
                  // Muted currency symbol so the amount reads unambiguously.
                  prefixText: '${currencySymbol(_currency)} ',
                  prefixStyle: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w600,
                    color: Colors.white38,
                  ),
                  border: InputBorder.none,
                ),
              ),
              TextField(
                controller: _descriptionController,
                enabled: !_saving,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                  labelText: 'What was it for?',
                  isDense: true,
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Text('PAID BY', style: eyebrowStyle()),
                  const SizedBox(width: 16),
                  Expanded(
                    child: DropdownButton<String>(
                      value: _payerId,
                      isExpanded: true,
                      onChanged: _saving
                          ? null
                          : (value) {
                              if (value != null) {
                                setState(() => _payerId = value);
                              }
                            },
                      items: _members
                          .map(
                            (member) => DropdownMenuItem(
                              value: member.memberId,
                              child: Row(
                                children: [
                                  MemberAvatar(
                                    memberId: member.memberId,
                                    displayName: member.displayName,
                                    radius: 11,
                                  ),
                                  const SizedBox(width: 8),
                                  Flexible(
                                    child: Text(
                                      member.displayName,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          )
                          .toList(),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 2,
                children: _members
                    .map(
                      (member) => MemberToggleChip(
                        memberId: member.memberId,
                        displayName: firstName(member.displayName),
                        selected: _selectedMemberIds.contains(member.memberId),
                        onTap: _saving
                            ? () {}
                            : () {
                                setState(() {
                                  if (!_selectedMemberIds.remove(
                                    member.memberId,
                                  )) {
                                    _selectedMemberIds.add(member.memberId);
                                  }
                                });
                              },
                      ),
                    )
                    .toList(),
              ),
              if (perHead != null) ...[
                const SizedBox(height: 8),
                Text(
                  '${formatCurrency(perHead, _currency)} each · '
                  '${_selectedMemberIds.length} '
                  '${_selectedMemberIds.length == 1 ? 'person' : 'people'}',
                  style: const TextStyle(fontSize: 12, color: Colors.white70),
                ),
              ],
              if (!_isEditing) ...[
                const SizedBox(height: 14),
                Row(
                  children: [
                    Text('REPEATS', style: eyebrowStyle()),
                    const SizedBox(width: 12),
                    Expanded(
                      child: SegmentedButton<String>(
                        segments: const [
                          ButtonSegment(value: 'none', label: Text('Never')),
                          ButtonSegment(value: 'weekly', label: Text('Weekly')),
                          ButtonSegment(
                            value: 'monthly',
                            label: Text('Monthly'),
                          ),
                        ],
                        selected: {_cadence},
                        showSelectedIcon: false,
                        style: const ButtonStyle(
                          visualDensity: VisualDensity.compact,
                        ),
                        onSelectionChanged: _saving
                            ? null
                            : (selection) {
                                HapticFeedback.selectionClick();
                                setState(() => _cadence = selection.first);
                              },
                      ),
                    ),
                  ],
                ),
                if (_cadence != 'none') ...[
                  const SizedBox(height: 6),
                  Text(
                    'Adds this expense automatically every '
                    '${_cadence == 'weekly' ? 'week' : 'month'} — manage it '
                    'from the Recurring section.',
                    style: const TextStyle(fontSize: 12, color: Colors.white70),
                  ),
                ],
              ],
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(
                  _error!,
                  style: const TextStyle(color: AppColors.danger, fontSize: 13),
                ),
              ],
              const SizedBox(height: 16),
              FilledButton(
                onPressed: blockedReason == null && !_saving
                    ? () => _save(draft: false)
                    : null,
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                child: _saving && !_savingAsDraft
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(
                        blockedReason ??
                            (_isEditing ? 'Save changes' : 'Save expense'),
                      ),
              ),
              if (!_isEditing && _cadence == 'none') ...[
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: blockedReason == null && !_saving
                      ? () => _save(draft: true)
                      : null,
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    side: BorderSide(
                      color: AppColors.warning.withValues(alpha: 0.45),
                    ),
                    foregroundColor: AppColors.warning,
                  ),
                  child: _saving && _savingAsDraft
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Save as draft'),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Only you can see drafts until you publish.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 12, color: Colors.white70),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
