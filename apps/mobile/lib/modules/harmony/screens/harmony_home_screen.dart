import 'package:flutter/material.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../../../core/formatters.dart';
import '../harmony_api.dart';
import '../models/harmony_models.dart';
import '../widgets/entry_row.dart';
import '../widgets/entry_sheet.dart';
import 'group_detail_screen.dart';
import 'statements_screen.dart';
import 'transfers_screen.dart';

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
  List<HarmonyStatement>? _statements;
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
      final results = await Future.wait([
        widget.api.getLedger(),
        widget.api.listStatements(),
      ]);
      if (!mounted) return;
      setState(() {
        _data = results[0] as HarmonyLedgerData;
        _statements = results[1] as List<HarmonyStatement>;
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

  Future<void> _entryActions(HarmonyEntry entry) async {
    final data = _data;
    if (data == null) return;
    final changed = await showHarmonyEntryActions(
      context: context,
      api: widget.api,
      groups: data.groups,
      entry: entry,
    );
    if (changed && mounted) await _load();
  }

  void _openGroup(HarmonyGroupSummary summary) {
    Navigator.of(context)
        .push(
          MaterialPageRoute<void>(
            builder: (_) => GroupDetailScreen(
              api: widget.api,
              groupId: summary.groupId,
              groupName: summary.name,
            ),
          ),
        )
        .then((_) => _load());
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

  void _openTransfers() {
    Navigator.of(context)
        .push(
          MaterialPageRoute<void>(
            builder: (_) => TransfersScreen(api: widget.api),
          ),
        )
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
            tooltip: 'Group transfers',
            icon: const Icon(Icons.swap_horiz_rounded),
            onPressed: _openTransfers,
          ),
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
              label: const Text('Record'),
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
                    ..._reviewNudge(),
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

  /// "N transactions awaiting review" / "statement failed" banner, shown
  /// only when a statement needs attention.
  List<Widget> _reviewNudge() {
    final statements = _statements ?? [];
    final pending = statements
        .where((s) => s.isParsed)
        .fold<int>(0, (sum, s) => sum + (s.counts?.pending ?? 0));
    final failed = statements.where((s) => s.isFailed).length;
    if (pending == 0 && failed == 0) return const [];

    final label = pending > 0
        ? '$pending imported ${pending == 1 ? 'transaction' : 'transactions'} '
              'awaiting review'
        : '$failed ${failed == 1 ? 'statement' : 'statements'} failed to parse';

    return [
      const SizedBox(height: 12),
      Card(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(
            color: (pending > 0 ? AppColors.warning : AppColors.danger)
                .withValues(alpha: 0.45),
          ),
        ),
        child: ListTile(
          dense: true,
          leading: Icon(
            pending > 0
                ? Icons.rule_rounded
                : Icons.error_outline_rounded,
            color: pending > 0 ? AppColors.warning : AppColors.danger,
          ),
          title: Text(label, style: const TextStyle(fontSize: 13)),
          trailing: const Icon(Icons.chevron_right_rounded),
          onTap: _openStatements,
        ),
      ),
    ];
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
        onTap: () => _openGroup(summary),
        title: Text(summary.name),
        subtitle: Text(
          'in ${formatCurrency(summary.inflow, 'USD')} · '
          'out ${formatCurrency(summary.outflow, 'USD')}',
          style: const TextStyle(fontSize: 12, color: Colors.white54),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              formatCurrency(summary.net, 'USD'),
              style: TextStyle(
                fontWeight: FontWeight.w700,
                fontFeatures: kTabularFigures,
                color: positive ? AppColors.positive : AppColors.danger,
              ),
            ),
            const Icon(Icons.chevron_right_rounded, color: Colors.white38),
          ],
        ),
      ),
    );
  }

  Widget _entryRow(HarmonyEntry entry) {
    return HarmonyEntryRow(entry: entry, onTap: () => _entryActions(entry));
  }
}
