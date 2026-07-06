import 'package:flutter/material.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../../../core/formatters.dart';
import '../harmony_api.dart';
import '../models/harmony_models.dart';
import '../widgets/entry_sheet.dart';
import 'statements_screen.dart';

/// Harmony Collective overview: net balance, group balances, recent entries,
/// plus the cash quick-entry FAB and statement imports.
class HarmonyHomeScreen extends StatefulWidget {
  final HarmonyApi api;

  const HarmonyHomeScreen({super.key, required this.api});

  @override
  State<HarmonyHomeScreen> createState() => _HarmonyHomeScreenState();
}

class _HarmonyHomeScreenState extends State<HarmonyHomeScreen> {
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
        _error = 'Could not load the ledger.';
      });
    }
  }

  Future<void> _recordCash() async {
    final data = _data;
    if (data == null) return;
    final entry = await showHarmonyEntrySheet(
      context: context,
      api: widget.api,
      groups: data.groups,
    );
    if (entry != null && mounted) {
      showAppSnackBar(
        context,
        'Recorded ${formatCurrency(entry.amount, entry.currency)} cash.',
        success: true,
      );
      await _load();
    }
  }

  Future<void> _editEntry(HarmonyEntry entry) async {
    final data = _data;
    if (data == null) return;
    final updated = await showHarmonyEntrySheet(
      context: context,
      api: widget.api,
      groups: data.groups,
      initialEntry: entry,
    );
    if (updated != null && mounted) {
      showAppSnackBar(context, 'Entry updated.', success: true);
      await _load();
    }
  }

  Future<void> _deleteEntry(HarmonyEntry entry) async {
    final proceed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Delete this entry?'),
        content: Text(
          '${formatCurrency(entry.amount, entry.currency)} '
          '${entry.description ?? entry.type.toLowerCase()} will be removed '
          'from the ledger.',
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
      await widget.api.deleteEntry(entry.entryId, entry.recordedAt);
      if (!mounted) return;
      showAppSnackBar(context, 'Entry deleted.', success: true);
      await _load();
    } on ApiException catch (error) {
      if (mounted) showAppSnackBar(context, error.message, error: true);
    }
  }

  Future<void> _showEntryActions(HarmonyEntry entry) async {
    final action = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Text(
                entry.description ?? entry.type,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(sheetContext).textTheme.titleMedium,
              ),
            ),
            ListTile(
              leading: const Icon(Icons.edit_outlined),
              title: const Text('Edit entry'),
              onTap: () => Navigator.of(sheetContext).pop('edit'),
            ),
            ListTile(
              leading: const Icon(
                Icons.delete_outline_rounded,
                color: AppColors.danger,
              ),
              title: const Text(
                'Delete entry',
                style: TextStyle(color: AppColors.danger),
              ),
              onTap: () => Navigator.of(sheetContext).pop('delete'),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (!mounted) return;
    if (action == 'edit') {
      await _editEntry(entry);
    } else if (action == 'delete') {
      await _deleteEntry(entry);
    }
  }

  void _openStatements() {
    Navigator.of(context)
        .push(
          MaterialPageRoute<void>(
            builder: (_) => StatementsScreen(api: widget.api),
          ),
        )
        // Confirmed imports change balances; refresh on return.
        .then((_) => _load());
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Harmony Collective'),
        actions: [
          IconButton(
            tooltip: 'Statement imports',
            icon: const Icon(Icons.upload_file_rounded),
            onPressed: _openStatements,
          ),
        ],
      ),
      floatingActionButton: data == null
          ? null
          : FloatingActionButton.extended(
              onPressed: _recordCash,
              icon: const Icon(Icons.payments_rounded),
              label: const Text('Record cash'),
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
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
                children: [
                  if (data != null) ...[
                    _netCard(data.totals),
                    const SizedBox(height: 16),
                    Text('GROUPS', style: eyebrowStyle()),
                    const SizedBox(height: 8),
                    ...(() {
                      final summaries = [...data.groupSummaries]
                        ..sort((a, b) => b.net.abs().compareTo(a.net.abs()));
                      return summaries.map(_groupRow);
                    })(),
                    if (data.groupSummaries.isEmpty)
                      const Text(
                        'No group activity yet.',
                        style: TextStyle(color: Colors.white54),
                      ),
                    const SizedBox(height: 20),
                    Text('RECENT ENTRIES', style: eyebrowStyle()),
                    const SizedBox(height: 8),
                    if (data.entries.isEmpty)
                      const Text(
                        'Nothing recorded yet — start with a cash entry or a '
                        'statement import.',
                        style: TextStyle(color: Colors.white54),
                      ),
                    ...data.entries.take(15).map(_entryRow),
                  ],
                ],
              ),
            ),
    );
  }

  Widget _netCard(HarmonyTotals totals) {
    final positive = totals.net >= 0;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: AppColors.headerGradient,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('NET BALANCE', style: eyebrowStyle()),
          const SizedBox(height: 4),
          Text(
            formatCurrency(totals.net, 'USD'),
            style: TextStyle(
              fontSize: 32,
              fontWeight: FontWeight.w700,
              fontFeatures: kTabularFigures,
              color: positive ? AppColors.positive : AppColors.danger,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _totalStat('In', totals.donations + totals.income + totals.reimbursements),
              const SizedBox(width: 20),
              _totalStat('Out', totals.expenses),
            ],
          ),
        ],
      ),
    );
  }

  Widget _totalStat(String label, double amount) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label.toUpperCase(),
          style: const TextStyle(fontSize: 10, color: Colors.white54),
        ),
        Text(
          formatCurrency(amount, 'USD'),
          style: const TextStyle(
            fontWeight: FontWeight.w600,
            fontFeatures: kTabularFigures,
          ),
        ),
      ],
    );
  }

  Widget _groupRow(HarmonyGroupSummary summary) {
    final positive = summary.net >= 0;
    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: Colors.white10),
      ),
      child: ListTile(
        dense: true,
        title: Text(summary.name),
        subtitle: Text(
          'in ${formatCurrency(summary.inflow, 'USD')} · '
          'out ${formatCurrency(summary.outflow, 'USD')}',
          style: const TextStyle(fontSize: 12, color: Colors.white54),
        ),
        trailing: Text(
          formatCurrency(summary.net, 'USD'),
          style: TextStyle(
            fontWeight: FontWeight.w700,
            fontFeatures: kTabularFigures,
            color: positive ? AppColors.positive : AppColors.danger,
          ),
        ),
      ),
    );
  }

  Widget _entryRow(HarmonyEntry entry) {
    final inflow = entry.isInflow;
    return ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      onTap: () => _showEntryActions(entry),
      leading: Icon(
        switch (entry.type) {
          'DONATION' => Icons.volunteer_activism_rounded,
          'INCOME' => Icons.trending_up_rounded,
          'REIMBURSEMENT' => Icons.replay_rounded,
          _ => Icons.trending_down_rounded,
        },
        size: 20,
        color: inflow ? AppColors.positive : AppColors.danger,
      ),
      title: Text(
        entry.description ?? entry.source ?? entry.type,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Text(
        [
          (entry.occurredAt ?? entry.recordedAt).split('T').first,
          if (entry.groupName != null) entry.groupName!,
          if (entry.source != null) entry.source!,
        ].join(' · '),
        style: const TextStyle(fontSize: 12, color: Colors.white54),
      ),
      trailing: Text(
        '${inflow ? '+' : '−'}${formatCurrency(entry.amount, entry.currency)}',
        style: TextStyle(
          fontWeight: FontWeight.w600,
          fontFeatures: kTabularFigures,
          color: inflow ? AppColors.positive : AppColors.danger,
        ),
      ),
    );
  }
}
