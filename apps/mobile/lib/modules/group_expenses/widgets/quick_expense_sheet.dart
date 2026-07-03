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
Future<QuickExpenseResult?> showQuickExpenseSheet({
  required BuildContext context,
  required ApiClient api,
  required TripSummary summary,
}) {
  return showModalBottomSheet<QuickExpenseResult>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _QuickExpenseSheet(api: api, summary: summary),
  );
}

class _QuickExpenseSheet extends StatefulWidget {
  final ApiClient api;
  final TripSummary summary;

  const _QuickExpenseSheet({required this.api, required this.summary});

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

  List<TripMember> get _members => widget.summary.members;

  String get _currency => widget.summary.trip.currency;

  @override
  void initState() {
    super.initState();
    final memberIds = _members.map((member) => member.memberId).toSet();
    _payerId = memberIds.contains(widget.summary.currentUserId)
        ? widget.summary.currentUserId
        : _members.first.memberId;
    _selectedMemberIds = {...memberIds};
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
      await widget.api.post('/trips/${widget.summary.trip.tripId}/expenses', {
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
      });
      if (!mounted) return;
      HapticFeedback.mediumImpact();
      Navigator.of(context).pop(
        QuickExpenseResult(
          total: total,
          peopleCount: memberIds.length,
          currency: _currency,
          draft: draft,
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
                'Quick expense',
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
                  const Text(
                    'Paid by',
                    style: TextStyle(color: Colors.white70),
                  ),
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
                    : Text(blockedReason ?? 'Save expense'),
              ),
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
          ),
        ),
      ),
    );
  }
}
