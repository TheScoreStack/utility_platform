import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../../../core/formatters.dart';
import '../../../core/payment_links.dart';
import '../../../core/settlement_suggestions.dart';
import '../../../models/models.dart';
import 'animated_amount.dart';
import 'member_avatar.dart';

/// "Settle up" tab: per-member balances, suggested payments, pending
/// settlements (with confirm + payment deep links), and confirmed history.
class SettleUpView extends StatelessWidget {
  final ApiClient api;
  final TripSummary summary;
  final Future<void> Function() onRefresh;

  const SettleUpView({
    super.key,
    required this.api,
    required this.summary,
    required this.onRefresh,
  });

  TripMember? _member(String memberId) {
    for (final member in summary.members) {
      if (member.memberId == memberId) return member;
    }
    return null;
  }

  String _name(String memberId) =>
      firstName(_member(memberId)?.displayName ?? 'Someone');

  /// Mirrors the server rule: participants, whoever recorded it, or the
  /// trip owner can edit/delete a settlement.
  bool _canModify(Settlement settlement) {
    final userId = summary.currentUserId;
    return settlement.fromMemberId == userId ||
        settlement.toMemberId == userId ||
        settlement.createdBy == userId ||
        summary.trip.ownerId == userId;
  }

  /// Without [suggestion] the sheet is free-form: pick who pays whom and
  /// any amount — for money that moved outside the suggested pairings.
  Future<void> _recordSettlement(
    BuildContext context, [
    SettlementSuggestion? suggestion,
  ]) async {
    final recorded = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _RecordSettlementSheet(
        api: api,
        summary: summary,
        suggestion: suggestion,
        onPay: (method, handle, amount) => _openPaymentLink(
          context,
          method,
          handle,
          amount: amount,
          currency: summary.trip.currency,
        ),
      ),
    );
    if (recorded == true && context.mounted) {
      HapticFeedback.mediumImpact();
      showAppSnackBar(context, 'Settlement recorded', success: true);
      await onRefresh();
    }
  }

  Future<void> _showSettlementActions(
    BuildContext context,
    Settlement settlement,
  ) async {
    HapticFeedback.selectionClick();
    final action = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 8),
            ListTile(
              title: Text(
                '${_name(settlement.fromMemberId)} → '
                '${_name(settlement.toMemberId)}',
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              subtitle: Text(
                formatCurrency(settlement.amount, settlement.currency),
                style: const TextStyle(color: Colors.white70),
              ),
            ),
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.edit_rounded),
              title: const Text('Edit payment'),
              subtitle: settlement.confirmedAt != null
                  ? const Text(
                      'Changing the amount resets the confirmation.',
                      style: TextStyle(fontSize: 12, color: Colors.white54),
                    )
                  : null,
              onTap: () => Navigator.of(sheetContext).pop('edit'),
            ),
            ListTile(
              leading: const Icon(
                Icons.delete_outline_rounded,
                color: AppColors.danger,
              ),
              title: const Text(
                'Delete settlement',
                style: TextStyle(color: AppColors.danger),
              ),
              onTap: () => Navigator.of(sheetContext).pop('delete'),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (action == null || !context.mounted) return;
    if (action == 'edit') {
      await _editSettlement(context, settlement);
    } else if (action == 'delete') {
      await _deleteSettlement(context, settlement);
    }
  }

  Future<void> _editSettlement(
    BuildContext context,
    Settlement settlement,
  ) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _RecordSettlementSheet(
        api: api,
        summary: summary,
        initial: settlement,
      ),
    );
    if (saved == true && context.mounted) {
      HapticFeedback.mediumImpact();
      showAppSnackBar(context, 'Settlement updated', success: true);
      await onRefresh();
    }
  }

  Future<void> _deleteSettlement(
    BuildContext context,
    Settlement settlement,
  ) async {
    try {
      await api.delete(
        '/trips/${summary.trip.tripId}/settlements/${settlement.settlementId}',
      );
      if (!context.mounted) return;
      HapticFeedback.lightImpact();
      showAppSnackBar(context, 'Settlement deleted', success: true);
      await onRefresh();
    } on ApiException catch (error) {
      if (!context.mounted) return;
      showAppSnackBar(context, error.message, error: true);
    } catch (_) {
      if (!context.mounted) return;
      showAppSnackBar(context, 'Could not delete the settlement.', error: true);
    }
  }

  Future<void> _confirmSettlement(
    BuildContext context,
    Settlement settlement,
  ) async {
    try {
      await api.patch(
        '/trips/${summary.trip.tripId}/settlements/${settlement.settlementId}',
        {'confirmed': true},
      );
      if (!context.mounted) return;
      HapticFeedback.mediumImpact();
      showAppSnackBar(context, 'Marked as received', success: true);
      await onRefresh();
    } on ApiException catch (error) {
      if (!context.mounted) return;
      showAppSnackBar(context, error.message, error: true);
    } catch (_) {
      if (!context.mounted) return;
      showAppSnackBar(
        context,
        'Could not confirm the settlement.',
        error: true,
      );
    }
  }

  Future<void> _openPaymentLink(
    BuildContext context,
    String method,
    String handle, {
    required double amount,
    required String currency,
  }) async {
    if (method == 'zelle') {
      await Clipboard.setData(ClipboardData(text: handle));
      if (context.mounted) {
        showAppSnackBar(context, 'Zelle handle copied: $handle', success: true);
      }
      return;
    }

    final note = 'Settling up: ${summary.trip.name}';

    // Venmo: prefer the native scheme (guaranteed app-open when installed);
    // universal links occasionally stay in the browser.
    if (method == 'venmo') {
      final appLink = buildVenmoAppLink(
        handle,
        amount: amount,
        currency: currency,
        note: note,
      );
      if (appLink != null) {
        final appUri = Uri.parse(appLink);
        if (await canLaunchUrl(appUri)) {
          final opened = await launchUrl(
            appUri,
            mode: LaunchMode.externalApplication,
          );
          if (opened) return;
        }
      }
    }

    final link = buildPaymentLink(
      method,
      handle,
      amount: amount,
      currency: currency,
      note: note,
    );
    if (link == null) {
      await Clipboard.setData(ClipboardData(text: handle));
      if (context.mounted) {
        showAppSnackBar(context, 'Payment handle copied: $handle');
      }
      return;
    }
    final launched = await launchUrl(
      Uri.parse(link),
      mode: LaunchMode.externalApplication,
    );
    if (!launched && context.mounted) {
      showAppSnackBar(context, 'Could not open the payment app.', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final currency = summary.trip.currency;
    final suggestions = computeSettlementSuggestions(summary.balances);
    final pending = summary.pendingSettlements;
    final confirmed = summary.settlements
        .where((settlement) => settlement.confirmedAt != null)
        .toList();
    final allSettled = suggestions.isEmpty && pending.isEmpty;

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
        children: [
          Text('Balances', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Card(
            margin: EdgeInsets.zero,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Column(
                children: summary.balances.map((row) {
                  final positive = row.balance > 0.01;
                  final negative = row.balance < -0.01;
                  final color = positive
                      ? AppColors.positive
                      : negative
                      ? AppColors.danger
                      : Colors.white70;
                  return Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Row(
                      children: [
                        MemberAvatar(
                          memberId: row.memberId,
                          displayName: row.displayName,
                          radius: 14,
                        ),
                        const SizedBox(width: 10),
                        Expanded(child: Text(row.displayName)),
                        AnimatedAmount(
                          amount: row.balance,
                          currency: currency,
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            color: color,
                          ),
                        ),
                      ],
                    ),
                  );
                }).toList(),
              ),
            ),
          ),
          const SizedBox(height: 20),
          if (allSettled) ...[
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 32),
              child: Column(
                children: [
                  Icon(
                    Icons.celebration_rounded,
                    size: 44,
                    color: AppColors.positive,
                  ),
                  SizedBox(height: 12),
                  Text(
                    'All settled up — nothing owed.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.white70),
                  ),
                ],
              ),
            ),
          ] else ...[
            if (suggestions.isNotEmpty) ...[
              Text(
                'Suggested payments',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              ...suggestions.map(
                (suggestion) => Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
                    child: Row(
                      children: [
                        MemberAvatar(
                          memberId: suggestion.from,
                          displayName: _name(suggestion.from),
                          radius: 13,
                        ),
                        const Padding(
                          padding: EdgeInsets.symmetric(horizontal: 6),
                          child: Icon(
                            Icons.arrow_forward_rounded,
                            size: 16,
                            color: Colors.white54,
                          ),
                        ),
                        MemberAvatar(
                          memberId: suggestion.to,
                          displayName: _name(suggestion.to),
                          radius: 13,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text.rich(
                            TextSpan(
                              children: [
                                TextSpan(
                                  text: _name(suggestion.from),
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                const TextSpan(
                                  text: ' pays ',
                                  style: TextStyle(color: Colors.white70),
                                ),
                                TextSpan(
                                  text: _name(suggestion.to),
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                TextSpan(
                                  text:
                                      ' ${formatCurrency(suggestion.amount, currency)}',
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w700,
                                    fontFeatures: kTabularFigures,
                                  ),
                                ),
                              ],
                            ),
                            style: const TextStyle(fontSize: 13),
                          ),
                        ),
                        FilledButton.tonal(
                          onPressed: () =>
                              _recordSettlement(context, suggestion),
                          style: FilledButton.styleFrom(
                            visualDensity: VisualDensity.compact,
                          ),
                          child: const Text('Record'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],
            if (pending.isNotEmpty) ...[
              Text(
                'Waiting to be confirmed',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              ...pending.map(
                (settlement) => _PendingSettlementCard(
                  settlement: settlement,
                  summary: summary,
                  nameOf: _name,
                  memberOf: _member,
                  onConfirm: () => _confirmSettlement(context, settlement),
                  onPay: (method, handle) => _openPaymentLink(
                    context,
                    method,
                    handle,
                    amount: settlement.amount,
                    currency: settlement.currency,
                  ),
                  onMore: _canModify(settlement)
                      ? () => _showSettlementActions(context, settlement)
                      : null,
                ),
              ),
              const SizedBox(height: 12),
            ],
          ],
          // Free-form escape hatch: any payer, any recipient, any amount —
          // for money that moved outside the suggested pairings.
          if (summary.members.length > 1) ...[
            OutlinedButton.icon(
              onPressed: () => _recordSettlement(context),
              icon: const Icon(Icons.add_rounded, size: 18),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 12),
                side: const BorderSide(color: Colors.white10),
              ),
              label: const Text('Record a different payment'),
            ),
            const SizedBox(height: 16),
          ],
          if (confirmed.isNotEmpty) ...[
            Text('History', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            ...confirmed.map(
              (settlement) => InkWell(
                // Only those allowed to edit/delete get the tap target.
                onTap: _canModify(settlement)
                    ? () => _showSettlementActions(context, settlement)
                    : null,
                borderRadius: BorderRadius.circular(8),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.check_circle_rounded,
                        size: 18,
                        color: AppColors.positive,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          '${_name(settlement.fromMemberId)} paid '
                          '${_name(settlement.toMemberId)}'
                          '${settlement.note != null && settlement.note!.isNotEmpty ? ' · ${settlement.note}' : ''}',
                          style: const TextStyle(
                            fontSize: 13,
                            color: Colors.white70,
                          ),
                        ),
                      ),
                      Text(
                        formatCurrency(settlement.amount, settlement.currency),
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          fontFeatures: kTabularFigures,
                        ),
                      ),
                      if (_canModify(settlement)) ...[
                        const SizedBox(width: 6),
                        const Icon(
                          Icons.more_horiz_rounded,
                          size: 16,
                          color: Colors.white38,
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _PendingSettlementCard extends StatelessWidget {
  final Settlement settlement;
  final TripSummary summary;
  final String Function(String memberId) nameOf;
  final TripMember? Function(String memberId) memberOf;
  final VoidCallback onConfirm;
  final void Function(String method, String handle) onPay;

  /// Opens edit/delete actions; null when the viewer isn't allowed.
  final VoidCallback? onMore;

  const _PendingSettlementCard({
    required this.settlement,
    required this.summary,
    required this.nameOf,
    required this.memberOf,
    required this.onConfirm,
    required this.onPay,
    this.onMore,
  });

  @override
  Widget build(BuildContext context) {
    final currentUserId = summary.currentUserId;
    final isPayer = settlement.fromMemberId == currentUserId;
    final canConfirm =
        settlement.fromMemberId == currentUserId ||
        settlement.toMemberId == currentUserId ||
        summary.trip.ownerId == currentUserId;
    final recipientMethods = memberOf(settlement.toMemberId)?.paymentMethods;

    final payButtons = <Widget>[];
    if (isPayer && recipientMethods != null) {
      // Preferred method first, and visually loudest — "pay this person
      // through this method" should be a single obvious tap.
      final ordered = recipientMethods.orderedKeys;
      for (var i = 0; i < ordered.length; i++) {
        final method = ordered[i];
        final handle = recipientMethods.handleFor(method)!;
        final icon = method == 'venmo'
            ? Icons.bolt_rounded
            : method == 'paypal'
            ? Icons.account_balance_wallet_rounded
            : Icons.copy_rounded;
        final label = method == 'venmo'
            ? 'Venmo'
            : method == 'paypal'
            ? 'PayPal'
            : 'Zelle';
        final isPreferred = i == 0 && recipientMethods.primary == method;
        payButtons.add(
          isPreferred
              ? FilledButton.icon(
                  onPressed: () => onPay(method, handle),
                  icon: Icon(icon, size: 16),
                  style: FilledButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                  ),
                  label: Text('Pay via $label'),
                )
              : OutlinedButton.icon(
                  onPressed: () => onPay(method, handle),
                  icon: Icon(icon, size: 16),
                  style: OutlinedButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    side: const BorderSide(color: Colors.white10),
                  ),
                  label: Text(label),
                ),
        );
      }
    }

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: AppColors.warning.withValues(alpha: 0.35)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '${nameOf(settlement.fromMemberId)} → '
                    '${nameOf(settlement.toMemberId)}',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
                Text(
                  formatCurrency(settlement.amount, settlement.currency),
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                    fontFeatures: kTabularFigures,
                  ),
                ),
                if (onMore != null)
                  IconButton(
                    onPressed: onMore,
                    icon: const Icon(
                      Icons.more_horiz_rounded,
                      size: 18,
                      color: Colors.white54,
                    ),
                    visualDensity: VisualDensity.compact,
                    padding: EdgeInsets.zero,
                    tooltip: 'Edit or delete',
                  ),
              ],
            ),
            if (settlement.note != null && settlement.note!.isNotEmpty) ...[
              const SizedBox(height: 2),
              Text(
                settlement.note!,
                style: const TextStyle(fontSize: 12, color: Colors.white70),
              ),
            ],
            const SizedBox(height: 4),
            Text(
              'WAITING FOR CONFIRMATION',
              style: eyebrowStyle(AppColors.warning),
            ),
            if (payButtons.isNotEmpty || canConfirm) ...[
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [
                  ...payButtons,
                  if (canConfirm)
                    FilledButton.tonal(
                      onPressed: onConfirm,
                      style: FilledButton.styleFrom(
                        visualDensity: VisualDensity.compact,
                      ),
                      child: const Text('Confirm received'),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Records a new settlement from a [suggestion], edits an existing one with
/// [initial] (amount + note; participants stay fixed), or — with neither —
/// records a free-form payment between any two members.
class _RecordSettlementSheet extends StatefulWidget {
  final ApiClient api;
  final TripSummary summary;
  final SettlementSuggestion? suggestion;
  final Settlement? initial;

  /// Launches a payment deep link for (method, handle, amount). Only used
  /// when the signed-in user is the payer.
  final void Function(String method, String handle, double amount)? onPay;

  const _RecordSettlementSheet({
    required this.api,
    required this.summary,
    this.suggestion,
    this.initial,
    this.onPay,
  });

  @override
  State<_RecordSettlementSheet> createState() => _RecordSettlementSheetState();
}

class _RecordSettlementSheetState extends State<_RecordSettlementSheet> {
  late final TextEditingController _amountController;
  late final TextEditingController _noteController;
  late String _fromMemberId;
  late String _toMemberId;
  bool _saving = false;
  String? _error;

  bool get _isEditing => widget.initial != null;

  /// No suggestion, no existing settlement: the caller picks who pays whom.
  bool get _isFreeForm => widget.initial == null && widget.suggestion == null;

  @override
  void initState() {
    super.initState();
    final members = widget.summary.members;
    if (widget.initial != null) {
      _fromMemberId = widget.initial!.fromMemberId;
      _toMemberId = widget.initial!.toMemberId;
    } else if (widget.suggestion != null) {
      _fromMemberId = widget.suggestion!.from;
      _toMemberId = widget.suggestion!.to;
    } else {
      // Default to "I pay someone" — the most common way people reach for a
      // custom settlement.
      final currentUserId = widget.summary.currentUserId;
      _fromMemberId =
          members.any((m) => m.memberId == currentUserId)
          ? currentUserId
          : members.first.memberId;
      _toMemberId = members
          .firstWhere(
            (m) => m.memberId != _fromMemberId,
            orElse: () => members.first,
          )
          .memberId;
    }
    final amount = widget.initial?.amount ?? widget.suggestion?.amount;
    _amountController = TextEditingController(
      text: amount?.toStringAsFixed(2) ?? '',
    );
    _noteController = TextEditingController(text: widget.initial?.note ?? '');
  }

  @override
  void dispose() {
    _amountController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  String _name(String memberId) {
    for (final member in widget.summary.members) {
      if (member.memberId == memberId) return member.displayName;
    }
    return 'Someone';
  }

  double get _enteredAmount =>
      double.tryParse(_amountController.text.trim().replaceAll(',', '.')) ?? 0;

  Widget _memberDropdown({
    required String label,
    required String value,
    required void Function(String) onChanged,
  }) {
    return Row(
      children: [
        SizedBox(width: 52, child: Text(label, style: eyebrowStyle())),
        Expanded(
          child: DropdownButton<String>(
            value: value,
            isExpanded: true,
            onChanged: _saving
                ? null
                : (next) {
                    if (next != null) onChanged(next);
                  },
            items: widget.summary.members
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
    );
  }

  /// "Pay first, then record" — shown when the signed-in user is the payer
  /// and the recipient has payment handles. Preferred method leads.
  List<Widget> _buildPaySection() {
    final onPay = widget.onPay;
    if (_isEditing ||
        onPay == null ||
        _fromMemberId != widget.summary.currentUserId) {
      return const [];
    }
    PaymentMethods? methods;
    for (final member in widget.summary.members) {
      if (member.memberId == _toMemberId) {
        methods = member.paymentMethods;
        break;
      }
    }
    if (methods == null || methods.isEmpty) return const [];

    final ordered = methods.orderedKeys;
    final recipient = firstName(_name(_toMemberId));
    final resolvedMethods = methods;

    return [
      const SizedBox(height: 16),
      Text('PAY $recipient VIA'.toUpperCase(), style: eyebrowStyle()),
      const SizedBox(height: 8),
      Wrap(
        spacing: 8,
        runSpacing: 6,
        children: [
          for (var i = 0; i < ordered.length; i++)
            (i == 0 && resolvedMethods.primary == ordered[i])
                ? FilledButton.tonalIcon(
                    onPressed: () => onPay(
                      ordered[i],
                      resolvedMethods.handleFor(ordered[i])!,
                      _enteredAmount,
                    ),
                    icon: Icon(
                      ordered[i] == 'venmo'
                          ? Icons.bolt_rounded
                          : ordered[i] == 'paypal'
                          ? Icons.account_balance_wallet_rounded
                          : Icons.copy_rounded,
                      size: 16,
                    ),
                    label: Text(
                      '${ordered[i] == 'venmo'
                          ? 'Venmo'
                          : ordered[i] == 'paypal'
                          ? 'PayPal'
                          : 'Zelle'} · preferred',
                    ),
                  )
                : OutlinedButton.icon(
                    onPressed: () => onPay(
                      ordered[i],
                      resolvedMethods.handleFor(ordered[i])!,
                      _enteredAmount,
                    ),
                    icon: Icon(
                      ordered[i] == 'venmo'
                          ? Icons.bolt_rounded
                          : ordered[i] == 'paypal'
                          ? Icons.account_balance_wallet_rounded
                          : Icons.copy_rounded,
                      size: 16,
                    ),
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: Colors.white10),
                    ),
                    label: Text(
                      ordered[i] == 'venmo'
                          ? 'Venmo'
                          : ordered[i] == 'paypal'
                          ? 'PayPal'
                          : 'Zelle',
                    ),
                  ),
        ],
      ),
      const SizedBox(height: 4),
      const Text(
        'Send the money there, then record it below so balances update.',
        style: TextStyle(fontSize: 12, color: Colors.white70),
      ),
    ];
  }

  Future<void> _save() async {
    final amount =
        double.tryParse(_amountController.text.trim().replaceAll(',', '.')) ??
        0;
    if (amount <= 0) {
      setState(() => _error = 'Enter an amount greater than zero.');
      return;
    }
    if (_fromMemberId == _toMemberId) {
      setState(() => _error = 'Pick two different people.');
      return;
    }
    final note = _noteController.text.trim();

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final tripId = widget.summary.trip.tripId;
      if (_isEditing) {
        // Note is always sent — an empty string clears it server-side.
        await widget.api.patch(
          '/trips/$tripId/settlements/${widget.initial!.settlementId}',
          {'amount': (amount * 100).roundToDouble() / 100, 'note': note},
        );
      } else {
        await widget.api.post('/trips/$tripId/settlements', {
          'fromMemberId': _fromMemberId,
          'toMemberId': _toMemberId,
          'amount': (amount * 100).roundToDouble() / 100,
          'currency': widget.summary.trip.currency,
          if (note.isNotEmpty) 'note': note,
        });
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
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
        _error = 'Could not record the settlement.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 16,
          bottom: MediaQuery.of(context).viewInsets.bottom + 16,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              _isEditing ? 'Edit payment' : 'Record a payment',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            if (_isFreeForm) ...[
              const Text(
                'Any amount, between anyone — useful when money moved '
                'outside the suggestions.',
                style: TextStyle(fontSize: 13, color: Colors.white70),
              ),
              const SizedBox(height: 12),
              _memberDropdown(
                label: 'FROM',
                value: _fromMemberId,
                onChanged: (value) => setState(() => _fromMemberId = value),
              ),
              const SizedBox(height: 8),
              _memberDropdown(
                label: 'TO',
                value: _toMemberId,
                onChanged: (value) => setState(() => _toMemberId = value),
              ),
            ] else
              Text(
                '${_name(_fromMemberId)} pays ${_name(_toMemberId)}',
                style: const TextStyle(fontSize: 13, color: Colors.white70),
              ),
            if (_isEditing && widget.initial!.confirmedAt != null) ...[
              const SizedBox(height: 6),
              const Text(
                'This payment was confirmed — changing the amount resets it '
                'to pending.',
                style: TextStyle(fontSize: 12, color: AppColors.warning),
              ),
            ],
            ..._buildPaySection(),
            const SizedBox(height: 16),
            TextField(
              controller: _amountController,
              enabled: !_saving,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
              ],
              decoration: InputDecoration(
                labelText: 'Amount',
                prefixText: '${currencySymbol(widget.summary.trip.currency)} ',
                prefixStyle: const TextStyle(
                  color: Colors.white38,
                  fontSize: 14,
                ),
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _noteController,
              enabled: !_saving,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: 'Note (optional)',
                border: OutlineInputBorder(),
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 10),
              Text(
                _error!,
                style: const TextStyle(color: AppColors.danger, fontSize: 13),
              ),
            ],
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _saving ? null : _save,
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              child: _saving
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(_isEditing ? 'Save changes' : 'Record payment'),
            ),
          ],
        ),
      ),
    );
  }
}
