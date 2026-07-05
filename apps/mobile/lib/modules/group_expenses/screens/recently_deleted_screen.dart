import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../../../core/formatters.dart';
import '../../../models/models.dart';

/// Soft-deleted expenses and settlements, with restore and delete-forever —
/// the mobile counterpart of web's "Recently deleted" lists.
class RecentlyDeletedScreen extends StatefulWidget {
  final ApiClient api;
  final TripSummary summary;

  const RecentlyDeletedScreen({
    super.key,
    required this.api,
    required this.summary,
  });

  @override
  State<RecentlyDeletedScreen> createState() => _RecentlyDeletedScreenState();
}

class _RecentlyDeletedScreenState extends State<RecentlyDeletedScreen> {
  late final List<Expense> _expenses = List.of(widget.summary.deletedExpenses);
  late final List<Settlement> _settlements = List.of(
    widget.summary.deletedSettlements,
  );
  String? _busyId;

  String get _tripId => widget.summary.trip.tripId;

  String _memberName(String memberId) {
    for (final member in widget.summary.members) {
      if (member.memberId == memberId) return firstName(member.displayName);
    }
    return 'Someone';
  }

  Future<bool> _confirmPurge(String what) async {
    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Delete forever?',
                style: Theme.of(sheetContext).textTheme.titleMedium,
              ),
              const SizedBox(height: 6),
              Text(
                '"$what" will be gone for good — no undo after this.',
                style: const TextStyle(fontSize: 13, color: Colors.white70),
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () => Navigator.of(sheetContext).pop(true),
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.danger,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                child: const Text('Delete forever'),
              ),
              TextButton(
                onPressed: () => Navigator.of(sheetContext).pop(false),
                child: const Text('Keep it'),
              ),
            ],
          ),
        ),
      ),
    );
    return confirmed == true;
  }

  Future<void> _run({
    required String id,
    required String path,
    required String successMessage,
    required VoidCallback onDone,
    required bool isDelete,
  }) async {
    setState(() => _busyId = id);
    try {
      if (isDelete) {
        await widget.api.delete(path);
      } else {
        await widget.api.post(path, const {});
      }
      if (!mounted) return;
      HapticFeedback.mediumImpact();
      setState(() {
        onDone();
        _busyId = null;
      });
      showAppSnackBar(context, successMessage, success: true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _busyId = null);
      showAppSnackBar(context, error.message, error: true);
    } catch (_) {
      if (!mounted) return;
      setState(() => _busyId = null);
      showAppSnackBar(context, 'Something went wrong.', error: true);
    }
  }

  Widget _row({
    required String id,
    required String title,
    required String subtitle,
    required String amount,
    required VoidCallback onRestore,
    required VoidCallback onPurge,
  }) {
    final busy = _busyId == id;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Colors.white10),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 8, 12),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  Text(
                    subtitle,
                    style: const TextStyle(
                      fontSize: 12,
                      color: Colors.white54,
                    ),
                  ),
                ],
              ),
            ),
            Text(
              amount,
              style: const TextStyle(
                fontWeight: FontWeight.w700,
                fontFeatures: kTabularFigures,
              ),
            ),
            const SizedBox(width: 4),
            if (busy)
              const Padding(
                padding: EdgeInsets.all(12),
                child: SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              )
            else ...[
              TextButton(
                onPressed: _busyId != null ? null : onRestore,
                child: const Text('Restore'),
              ),
              IconButton(
                onPressed: _busyId != null ? null : onPurge,
                tooltip: 'Delete forever',
                icon: const Icon(
                  Icons.delete_forever_rounded,
                  size: 20,
                  color: AppColors.danger,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final empty = _expenses.isEmpty && _settlements.isEmpty;

    return Scaffold(
      appBar: AppBar(title: const Text('Recently deleted'), centerTitle: false),
      body: empty
          ? const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.delete_outline_rounded,
                    size: 44,
                    color: Colors.white24,
                  ),
                  SizedBox(height: 12),
                  Text(
                    'Nothing here.\nDeleted expenses and settlements can be\nrestored from this screen.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.white70),
                  ),
                ],
              ),
            )
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              children: [
                if (_expenses.isNotEmpty) ...[
                  Text(
                    'Expenses',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  ..._expenses.map(
                    (expense) => _row(
                      id: expense.expenseId,
                      title: expense.description,
                      subtitle:
                          'Deleted ${formatShortDate(expense.deletedAt) ?? 'recently'}',
                      amount: formatCurrency(expense.total, expense.currency),
                      onRestore: () => _run(
                        id: expense.expenseId,
                        path:
                            '/trips/$_tripId/expenses/${expense.expenseId}/restore',
                        successMessage: 'Restored "${expense.description}"',
                        isDelete: false,
                        onDone: () => _expenses.remove(expense),
                      ),
                      onPurge: () async {
                        if (!await _confirmPurge(expense.description)) return;
                        await _run(
                          id: expense.expenseId,
                          path:
                              '/trips/$_tripId/expenses/${expense.expenseId}/purge',
                          successMessage: 'Deleted forever',
                          isDelete: true,
                          onDone: () => _expenses.remove(expense),
                        );
                      },
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
                if (_settlements.isNotEmpty) ...[
                  Text(
                    'Settlements',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  ..._settlements.map(
                    (settlement) => _row(
                      id: settlement.settlementId,
                      title:
                          '${_memberName(settlement.fromMemberId)} → '
                          '${_memberName(settlement.toMemberId)}',
                      subtitle:
                          'Deleted ${formatShortDate(settlement.deletedAt) ?? 'recently'}',
                      amount: formatCurrency(
                        settlement.amount,
                        settlement.currency,
                      ),
                      onRestore: () => _run(
                        id: settlement.settlementId,
                        path:
                            '/trips/$_tripId/settlements/${settlement.settlementId}/restore',
                        successMessage: 'Settlement restored',
                        isDelete: false,
                        onDone: () => _settlements.remove(settlement),
                      ),
                      onPurge: () async {
                        if (!await _confirmPurge(
                          '${_memberName(settlement.fromMemberId)} → '
                          '${_memberName(settlement.toMemberId)}',
                        )) {
                          return;
                        }
                        await _run(
                          id: settlement.settlementId,
                          path:
                              '/trips/$_tripId/settlements/${settlement.settlementId}/purge',
                          successMessage: 'Deleted forever',
                          isDelete: true,
                          onDone: () => _settlements.remove(settlement),
                        );
                      },
                    ),
                  ),
                ],
              ],
            ),
    );
  }
}
