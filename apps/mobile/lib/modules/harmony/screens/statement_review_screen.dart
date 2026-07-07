import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../harmony_api.dart';
import '../models/harmony_models.dart';
import '../widgets/group_picker_sheet.dart';
import '../widgets/staged_txn_tile.dart';

/// Review queue for a parsed statement: adjust type/group per transaction,
/// swipe right to confirm, swipe left to dismiss, or bulk-accept.
class StatementReviewScreen extends StatefulWidget {
  final HarmonyApi api;
  final String statementId;

  const StatementReviewScreen({
    super.key,
    required this.api,
    required this.statementId,
  });

  @override
  State<StatementReviewScreen> createState() => _StatementReviewScreenState();
}

class _StatementReviewScreenState extends State<StatementReviewScreen> {
  HarmonyStatementDetail? _detail;
  bool _loading = true;
  String? _loadError;

  /// Local review choices that differ from the AI suggestions.
  final Map<String, String> _typeOverrides = {};
  final Map<String, GroupPick> _groupOverrides = {};
  final Set<String> _busyTxnIds = {};
  bool _bulkRunning = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final detail = await widget.api.getStatementDetail(widget.statementId);
      if (!mounted) return;
      setState(() {
        _detail = detail;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _loadError = error.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _loadError = 'Could not load the statement.';
      });
    }
  }

  String _effectiveType(HarmonyStagedTxn txn) =>
      _typeOverrides[txn.txnId] ?? txn.suggestedType;

  String? _effectiveGroupName(HarmonyStagedTxn txn) {
    final override = _groupOverrides[txn.txnId];
    if (override != null) return override.groupName;
    return txn.suggestedGroupName;
  }

  Future<void> _pickType(HarmonyStagedTxn txn) async {
    if (!txn.isInflow) {
      showAppSnackBar(context, 'Money going out is always an expense.');
      return;
    }
    final current = _effectiveType(txn);
    final picked = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Text(
                'Record as',
                style: Theme.of(sheetContext).textTheme.titleMedium,
              ),
            ),
            for (final type in const ['DONATION', 'INCOME', 'REIMBURSEMENT'])
              ListTile(
                title: Text(kEntryTypeLabels[type]!),
                trailing: current == type
                    ? const Icon(Icons.check_rounded)
                    : null,
                onTap: () => Navigator.of(sheetContext).pop(type),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (picked != null && mounted) {
      HapticFeedback.selectionClick();
      setState(() => _typeOverrides[txn.txnId] = picked);
    }
  }

  Future<void> _pickGroup(HarmonyStagedTxn txn) async {
    final detail = _detail;
    if (detail == null) return;
    final override = _groupOverrides[txn.txnId];
    final selectedGroupId = override != null
        ? override.groupId
        : txn.suggestedGroupId;
    final pick = await showGroupPickerSheet(
      context: context,
      groups: detail.groups,
      selectedGroupId: selectedGroupId,
    );
    if (pick != null && mounted) {
      HapticFeedback.selectionClick();
      setState(() => _groupOverrides[txn.txnId] = pick);
    }
  }

  void _replaceTxn(HarmonyStagedTxn txn, String status) {
    final detail = _detail;
    if (detail == null) return;
    final updated = [
      for (final item in detail.transactions)
        if (item.txnId == txn.txnId)
          HarmonyStagedTxn(
            txnId: item.txnId,
            statementId: item.statementId,
            txnDate: item.txnDate,
            amount: item.amount,
            currency: item.currency,
            direction: item.direction,
            rawDescription: item.rawDescription,
            counterparty: item.counterparty,
            suggestedType: item.suggestedType,
            suggestedGroupId: item.suggestedGroupId,
            suggestedGroupName: item.suggestedGroupName,
            isLikelyInternalTransfer: item.isLikelyInternalTransfer,
            isDuplicate: item.isDuplicate,
            status: status,
          )
        else
          item,
    ];
    setState(() {
      _detail = HarmonyStatementDetail(
        statement: detail.statement,
        transactions: updated,
        groups: detail.groups,
      );
    });
  }

  Future<bool> _confirmTxn(HarmonyStagedTxn txn) async {
    setState(() => _busyTxnIds.add(txn.txnId));
    try {
      final override = _groupOverrides[txn.txnId];
      await widget.api.confirmTransaction(
        statementId: widget.statementId,
        txnId: txn.txnId,
        txnDate: txn.txnDate,
        type: _typeOverrides[txn.txnId],
        groupId: override?.groupId,
        clearGroup: override != null && override.groupId == null,
      );
      if (!mounted) return false;
      HapticFeedback.mediumImpact();
      _replaceTxn(txn, 'CONFIRMED');
      return true;
    } on ApiException catch (error) {
      if (mounted) showAppSnackBar(context, error.message, error: true);
      return false;
    } catch (_) {
      if (mounted) {
        showAppSnackBar(context, 'Could not confirm.', error: true);
      }
      return false;
    } finally {
      if (mounted) setState(() => _busyTxnIds.remove(txn.txnId));
    }
  }

  Future<bool> _dismissTxn(HarmonyStagedTxn txn) async {
    setState(() => _busyTxnIds.add(txn.txnId));
    try {
      await widget.api.dismissTransaction(
        statementId: widget.statementId,
        txnId: txn.txnId,
        txnDate: txn.txnDate,
      );
      if (!mounted) return false;
      HapticFeedback.lightImpact();
      _replaceTxn(txn, 'DISMISSED');
      return true;
    } on ApiException catch (error) {
      if (mounted) showAppSnackBar(context, error.message, error: true);
      return false;
    } catch (_) {
      if (mounted) {
        showAppSnackBar(context, 'Could not dismiss.', error: true);
      }
      return false;
    } finally {
      if (mounted) setState(() => _busyTxnIds.remove(txn.txnId));
    }
  }

  Future<void> _unconfirmTxn(HarmonyStagedTxn txn) async {
    setState(() => _busyTxnIds.add(txn.txnId));
    try {
      await widget.api.unconfirmTransaction(
        statementId: widget.statementId,
        txnId: txn.txnId,
        txnDate: txn.txnDate,
      );
      if (!mounted) return;
      HapticFeedback.lightImpact();
      _replaceTxn(txn, 'PENDING');
      showAppSnackBar(context, 'Undone — the ledger entry was removed.');
    } on ApiException catch (error) {
      if (mounted) showAppSnackBar(context, error.message, error: true);
    } catch (_) {
      if (mounted) showAppSnackBar(context, 'Could not undo.', error: true);
    } finally {
      if (mounted) setState(() => _busyTxnIds.remove(txn.txnId));
    }
  }

  Future<void> _reopenTxn(HarmonyStagedTxn txn) async {
    setState(() => _busyTxnIds.add(txn.txnId));
    try {
      await widget.api.reopenTransaction(
        statementId: widget.statementId,
        txnId: txn.txnId,
        txnDate: txn.txnDate,
      );
      if (!mounted) return;
      HapticFeedback.lightImpact();
      _replaceTxn(txn, 'PENDING');
    } on ApiException catch (error) {
      if (mounted) showAppSnackBar(context, error.message, error: true);
    } catch (_) {
      if (mounted) {
        showAppSnackBar(context, 'Could not restore.', error: true);
      }
    } finally {
      if (mounted) setState(() => _busyTxnIds.remove(txn.txnId));
    }
  }

  /// Opens the originally uploaded file (image/PDF/CSV) in the browser via
  /// a short-lived presigned URL.
  Future<void> _viewOriginal() async {
    try {
      final url = await widget.api.getStatementFileUrl(widget.statementId);
      if (!mounted) return;
      final launched = await launchUrl(
        Uri.parse(url),
        mode: LaunchMode.externalApplication,
      );
      if (!launched && mounted) {
        showAppSnackBar(context, 'Could not open the file.', error: true);
      }
    } on ApiException catch (error) {
      if (mounted) showAppSnackBar(context, error.message, error: true);
    }
  }

  Future<void> _confirmAll() async {
    final detail = _detail;
    if (detail == null) return;
    final eligible = detail.transactions
        .where(
          (txn) =>
              txn.isPending && !txn.isLikelyInternalTransfer && !txn.isDuplicate,
        )
        .length;
    final proceed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Accept all suggestions?'),
        content: Text(
          'Creates $eligible ledger '
          '${eligible == 1 ? 'entry' : 'entries'} using the suggested types '
          'and groups. Duplicates and likely internal transfers are skipped.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Accept all'),
          ),
        ],
      ),
    );
    if (proceed != true || !mounted) return;

    setState(() => _bulkRunning = true);
    try {
      var result = await widget.api.confirmAll(widget.statementId);
      var confirmed = result.confirmed;
      // The API caps each call; keep going until the queue is drained.
      while (result.remaining > 0) {
        result = await widget.api.confirmAll(widget.statementId);
        confirmed += result.confirmed;
      }
      if (!mounted) return;
      showAppSnackBar(
        context,
        'Confirmed $confirmed ${confirmed == 1 ? 'entry' : 'entries'}.',
        success: true,
      );
      await _load();
    } on ApiException catch (error) {
      if (mounted) showAppSnackBar(context, error.message, error: true);
    } catch (_) {
      if (mounted) {
        showAppSnackBar(context, 'Bulk confirm failed.', error: true);
      }
    } finally {
      if (mounted) setState(() => _bulkRunning = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final detail = _detail;
    final pending =
        detail?.transactions.where((txn) => txn.isPending).toList() ?? [];
    final reviewed =
        detail?.transactions.where((txn) => !txn.isPending).toList() ?? [];

    return Scaffold(
      appBar: AppBar(
        title: Text(detail?.statement.fileName ?? 'Review statement'),
        actions: [
          if (detail != null)
            IconButton(
              tooltip: 'View original file',
              icon: const Icon(Icons.attachment_rounded),
              onPressed: _viewOriginal,
            ),
          if (pending.isNotEmpty)
            TextButton(
              onPressed: _bulkRunning ? null : _confirmAll,
              child: _bulkRunning
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Accept all'),
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _loadError != null
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_loadError!),
                  const SizedBox(height: 12),
                  OutlinedButton(onPressed: _load, child: const Text('Retry')),
                ],
              ),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 24),
                children: [
                  if (detail != null && detail.transactions.isEmpty)
                    const Padding(
                      padding: EdgeInsets.only(top: 60),
                      child: Center(
                        child: Text(
                          'No transactions were found in this statement.',
                          style: TextStyle(color: Colors.white70),
                        ),
                      ),
                    ),
                  if (pending.isNotEmpty) ...[
                    Padding(
                      padding: const EdgeInsets.fromLTRB(4, 4, 4, 8),
                      child: Text(
                        'TO REVIEW · ${pending.length}',
                        style: eyebrowStyle(),
                      ),
                    ),
                    const Padding(
                      padding: EdgeInsets.fromLTRB(4, 0, 4, 8),
                      child: Text(
                        'Swipe right to confirm, left to skip. Tap the chips '
                        'to change the type or group first.',
                        style: TextStyle(fontSize: 12, color: Colors.white54),
                      ),
                    ),
                    for (final txn in pending)
                      Dismissible(
                        key: ValueKey(txn.txnId),
                        direction: _busyTxnIds.contains(txn.txnId)
                            ? DismissDirection.none
                            : DismissDirection.horizontal,
                        background: _swipeBackground(
                          alignment: Alignment.centerLeft,
                          color: AppColors.positive,
                          icon: Icons.check_rounded,
                          label: 'Confirm',
                        ),
                        secondaryBackground: _swipeBackground(
                          alignment: Alignment.centerRight,
                          color: Colors.white54,
                          icon: Icons.close_rounded,
                          label: 'Skip',
                        ),
                        // The tile stays in the list (re-rendered with its new
                        // status), so always resolve false after the API call.
                        confirmDismiss: (direction) async {
                          if (direction == DismissDirection.startToEnd) {
                            await _confirmTxn(txn);
                          } else {
                            await _dismissTxn(txn);
                          }
                          return false;
                        },
                        child: StagedTxnTile(
                          txn: txn,
                          type: _effectiveType(txn),
                          groupName: _effectiveGroupName(txn),
                          busy: _busyTxnIds.contains(txn.txnId),
                          onTypeTap: () => _pickType(txn),
                          onGroupTap: () => _pickGroup(txn),
                        ),
                      ),
                  ],
                  if (reviewed.isNotEmpty) ...[
                    Padding(
                      padding: const EdgeInsets.fromLTRB(4, 16, 4, 8),
                      child: Text(
                        'REVIEWED · ${reviewed.length}',
                        style: eyebrowStyle(),
                      ),
                    ),
                    for (final txn in reviewed)
                      StagedTxnTile(
                        txn: txn,
                        type: _effectiveType(txn),
                        groupName: _effectiveGroupName(txn),
                        busy: _busyTxnIds.contains(txn.txnId),
                        onRestore: () => _reopenTxn(txn),
                        onUndo: () => _unconfirmTxn(txn),
                      ),
                  ],
                ],
              ),
            ),
    );
  }

  Widget _swipeBackground({
    required Alignment alignment,
    required Color color,
    required IconData icon,
    required String label,
  }) {
    return Container(
      alignment: alignment,
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, color: color),
          Text(label, style: TextStyle(fontSize: 11, color: color)),
        ],
      ),
    );
  }
}
