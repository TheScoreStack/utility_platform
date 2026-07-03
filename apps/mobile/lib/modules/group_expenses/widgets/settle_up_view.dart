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

  Future<void> _recordSettlement(
    BuildContext context,
    SettlementSuggestion suggestion,
  ) async {
    final recorded = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _RecordSettlementSheet(
        api: api,
        summary: summary,
        suggestion: suggestion,
      ),
    );
    if (recorded == true && context.mounted) {
      HapticFeedback.mediumImpact();
      showAppSnackBar(context, 'Settlement recorded', success: true);
      await onRefresh();
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
    String handle,
    Settlement settlement,
  ) async {
    if (method == 'zelle') {
      await Clipboard.setData(ClipboardData(text: handle));
      if (context.mounted) {
        showAppSnackBar(context, 'Zelle handle copied: $handle', success: true);
      }
      return;
    }

    final link = buildPaymentLink(
      method,
      handle,
      amount: settlement.amount,
      currency: settlement.currency,
      note: 'Settling up: ${summary.trip.name}',
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
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
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
                    padding: const EdgeInsets.fromLTRB(14, 10, 10, 10),
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
                  onPay: (method, handle) =>
                      _openPaymentLink(context, method, handle, settlement),
                ),
              ),
              const SizedBox(height: 12),
            ],
          ],
          if (confirmed.isNotEmpty) ...[
            Text('History', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            ...confirmed.map(
              (settlement) => Padding(
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
                  ],
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

  const _PendingSettlementCard({
    required this.settlement,
    required this.summary,
    required this.nameOf,
    required this.memberOf,
    required this.onConfirm,
    required this.onPay,
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
      void addButton(String method, String? handle, IconData icon) {
        if (handle == null || handle.trim().isEmpty) return;
        payButtons.add(
          OutlinedButton.icon(
            onPressed: () => onPay(method, handle),
            icon: Icon(icon, size: 16),
            style: OutlinedButton.styleFrom(
              visualDensity: VisualDensity.compact,
              side: const BorderSide(color: Colors.white24),
            ),
            label: Text(
              method == 'venmo'
                  ? 'Venmo'
                  : method == 'paypal'
                  ? 'PayPal'
                  : 'Zelle',
            ),
          ),
        );
      }

      addButton('venmo', recipientMethods.venmo, Icons.bolt_rounded);
      addButton(
        'paypal',
        recipientMethods.paypal,
        Icons.account_balance_wallet_rounded,
      );
      addButton('zelle', recipientMethods.zelle, Icons.copy_rounded);
    }

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: AppColors.warning.withValues(alpha: 0.35)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
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
            const Text(
              'Waiting for confirmation',
              style: TextStyle(fontSize: 12, color: AppColors.warning),
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

class _RecordSettlementSheet extends StatefulWidget {
  final ApiClient api;
  final TripSummary summary;
  final SettlementSuggestion suggestion;

  const _RecordSettlementSheet({
    required this.api,
    required this.summary,
    required this.suggestion,
  });

  @override
  State<_RecordSettlementSheet> createState() => _RecordSettlementSheetState();
}

class _RecordSettlementSheetState extends State<_RecordSettlementSheet> {
  late final TextEditingController _amountController;
  final _noteController = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _amountController = TextEditingController(
      text: widget.suggestion.amount.toStringAsFixed(2),
    );
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

  Future<void> _save() async {
    final amount =
        double.tryParse(_amountController.text.trim().replaceAll(',', '.')) ??
        0;
    if (amount <= 0) {
      setState(() => _error = 'Enter an amount greater than zero.');
      return;
    }
    final note = _noteController.text.trim();

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.api
          .post('/trips/${widget.summary.trip.tripId}/settlements', {
            'fromMemberId': widget.suggestion.from,
            'toMemberId': widget.suggestion.to,
            'amount': (amount * 100).roundToDouble() / 100,
            'currency': widget.summary.trip.currency,
            if (note.isNotEmpty) 'note': note,
          });
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
              'Record a payment',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              '${_name(widget.suggestion.from)} pays '
              '${_name(widget.suggestion.to)}',
              style: const TextStyle(fontSize: 13, color: Colors.white70),
            ),
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
              decoration: const InputDecoration(
                labelText: 'Amount',
                border: OutlineInputBorder(),
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
                  : const Text('Record payment'),
            ),
          ],
        ),
      ),
    );
  }
}
