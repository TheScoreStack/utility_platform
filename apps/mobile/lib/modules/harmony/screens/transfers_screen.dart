import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../../../core/formatters.dart';
import '../harmony_api.dart';
import '../models/harmony_models.dart';

/// Inter-group fund movements: history list plus a create sheet.
class TransfersScreen extends StatefulWidget {
  final HarmonyApi api;

  const TransfersScreen({super.key, required this.api});

  @override
  State<TransfersScreen> createState() => _TransfersScreenState();
}

class _TransfersScreenState extends State<TransfersScreen> {
  HarmonyLedgerData? _data;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final data = await widget.api.getLedger();
      if (!mounted) return;
      setState(() {
        _data = data;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Could not load transfers.';
      });
    }
  }

  Future<void> _create() async {
    final data = _data;
    if (data == null) return;
    final created = await showModalBottomSheet<HarmonyTransfer>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _TransferSheet(api: widget.api, groups: data.groups),
    );
    if (created != null && mounted) {
      showAppSnackBar(
        context,
        'Moved ${formatCurrency(created.amount, created.currency)}.',
        success: true,
      );
      await _load();
    }
  }

  Future<void> _delete(HarmonyTransfer transfer) async {
    final proceed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Delete this transfer?'),
        content: Text(
          '${formatCurrency(transfer.amount, transfer.currency)} from '
          '${transfer.fromGroupName ?? 'Unallocated'} to '
          '${transfer.toGroupName ?? 'Unallocated'} will be removed.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (proceed != true || !mounted) return;
    try {
      await widget.api.deleteTransfer(transfer.transferId, transfer.createdAt);
      if (!mounted) return;
      await _load();
    } on ApiException catch (error) {
      if (mounted) showAppSnackBar(context, error.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final transfers = _data?.transfers ?? [];

    return Scaffold(
      appBar: AppBar(title: const Text('Group transfers')),
      floatingActionButton: _data == null
          ? null
          : FloatingActionButton.extended(
              onPressed: _create,
              icon: const Icon(Icons.swap_horiz_rounded),
              label: const Text('Move funds'),
            ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_error!),
                  const SizedBox(height: 12),
                  OutlinedButton(onPressed: _load, child: const Text('Retry')),
                ],
              ),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: transfers.isEmpty
                  ? ListView(
                      children: const [
                        Padding(
                          padding: EdgeInsets.only(top: 120),
                          child: Center(
                            child: Padding(
                              padding: EdgeInsets.symmetric(horizontal: 32),
                              child: Text(
                                'Move funds between groups (or in and out of '
                                'the unallocated pool) without recording new '
                                'income or expenses.',
                                textAlign: TextAlign.center,
                                style: TextStyle(color: Colors.white70),
                              ),
                            ),
                          ),
                        ),
                      ],
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.fromLTRB(12, 8, 12, 96),
                      itemCount: transfers.length,
                      itemBuilder: (context, index) =>
                          _transferCard(transfers[index]),
                    ),
            ),
    );
  }

  Widget _transferCard(HarmonyTransfer transfer) {
    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: Colors.white10),
      ),
      child: ListTile(
        leading: const Icon(Icons.swap_horiz_rounded),
        title: Text(
          '${transfer.fromGroupName ?? 'Unallocated'} → '
          '${transfer.toGroupName ?? 'Unallocated'}',
        ),
        subtitle: Text(
          [
            transfer.createdAt.split('T').first,
            if (transfer.note != null) transfer.note!,
            if (transfer.createdByName != null) transfer.createdByName!,
          ].join(' · '),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 12, color: Colors.white54),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              formatCurrency(transfer.amount, transfer.currency),
              style: const TextStyle(
                fontWeight: FontWeight.w700,
                fontFeatures: kTabularFigures,
              ),
            ),
            PopupMenuButton<String>(
              onSelected: (action) {
                if (action == 'delete') _delete(transfer);
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'delete', child: Text('Delete')),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _TransferSheet extends StatefulWidget {
  final HarmonyApi api;
  final List<HarmonyGroup> groups;

  const _TransferSheet({required this.api, required this.groups});

  @override
  State<_TransferSheet> createState() => _TransferSheetState();
}

class _TransferSheetState extends State<_TransferSheet> {
  final _amountController = TextEditingController();
  final _noteController = TextEditingController();

  /// null = the unallocated pool.
  String? _fromGroupId;
  String? _toGroupId;
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _amountController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  double get _amount =>
      double.tryParse(_amountController.text.trim().replaceAll(',', '.')) ?? 0;

  String? get _blockedReason {
    if (_amount <= 0) return 'Enter an amount';
    if (_fromGroupId == _toGroupId) return 'Pick two different buckets';
    return null;
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final transfer = await widget.api.createTransfer(
        fromGroupId: _fromGroupId,
        toGroupId: _toGroupId,
        amount: double.parse(_amount.toStringAsFixed(2)),
        note: _noteController.text.trim(),
      );
      if (!mounted) return;
      HapticFeedback.mediumImpact();
      Navigator.of(context).pop(transfer);
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
        _error = 'Could not save the transfer.';
      });
    }
  }

  Widget _groupChips({
    required String? selected,
    required ValueChanged<String?> onChanged,
  }) {
    final activeGroups = widget.groups
        .where((group) => group.isActive)
        .toList();
    return Wrap(
      spacing: 6,
      runSpacing: 2,
      children: [
        ChoiceChip(
          label: const Text('Unallocated'),
          selected: selected == null,
          visualDensity: VisualDensity.compact,
          onSelected: _saving ? null : (_) => onChanged(null),
        ),
        for (final group in activeGroups)
          ChoiceChip(
            label: Text(group.name),
            selected: selected == group.groupId,
            visualDensity: VisualDensity.compact,
            onSelected: _saving
                ? null
                : (_) {
                    HapticFeedback.selectionClick();
                    onChanged(group.groupId);
                  },
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final blockedReason = _blockedReason;

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
                'Move funds',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 4),
              const Text(
                'Adjusts group balances without new income or expenses.',
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
                  prefixText: '${currencySymbol('USD')} ',
                  prefixStyle: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w600,
                    color: Colors.white38,
                  ),
                  border: InputBorder.none,
                ),
              ),
              const SizedBox(height: 8),
              Text('FROM', style: eyebrowStyle()),
              const SizedBox(height: 6),
              _groupChips(
                selected: _fromGroupId,
                onChanged: (value) => setState(() => _fromGroupId = value),
              ),
              const SizedBox(height: 14),
              Text('TO', style: eyebrowStyle()),
              const SizedBox(height: 6),
              _groupChips(
                selected: _toGroupId,
                onChanged: (value) => setState(() => _toGroupId = value),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _noteController,
                enabled: !_saving,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                  labelText: 'Note (optional)',
                  isDense: true,
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
                onPressed: blockedReason == null && !_saving ? _save : null,
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                child: _saving
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(blockedReason ?? 'Move funds'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
