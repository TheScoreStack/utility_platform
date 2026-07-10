import 'package:flutter/material.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../../../core/formatters.dart';
import '../harmony_api.dart';
import '../models/harmony_models.dart';
import '../widgets/entry_row.dart';
import '../widgets/entry_sheet.dart';

/// Everything about one group: balance breakdown, its ledger entries, and
/// the transfers that touched it. Entries are tappable (edit/delete/source)
/// and the FAB records straight into this group.
class GroupDetailScreen extends StatefulWidget {
  final HarmonyApi api;
  final String groupId;
  final String groupName;

  /// False for viewer-role members: all write affordances are hidden.
  final bool canWrite;

  const GroupDetailScreen({
    super.key,
    required this.api,
    required this.groupId,
    required this.groupName,
    this.canWrite = true,
  });

  @override
  State<GroupDetailScreen> createState() => _GroupDetailScreenState();
}

class _GroupDetailScreenState extends State<GroupDetailScreen> {
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
        _error = 'Could not load the group.';
      });
    }
  }

  Future<void> _record() async {
    final data = _data;
    if (data == null) return;
    final entry = await showHarmonyEntrySheet(
      context: context,
      api: widget.api,
      groups: data.groups,
      initialGroupId: widget.groupId,
    );
    if (entry != null && mounted) {
      showAppSnackBar(
        context,
        'Recorded ${formatCurrency(entry.amount, entry.currency)}.',
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
    if (changed && mounted) {
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    final entries = data?.entries
            .where((entry) => entry.groupId == widget.groupId)
            .toList() ??
        [];
    final transfers = data?.transfers
            .where(
              (transfer) =>
                  transfer.fromGroupId == widget.groupId ||
                  transfer.toGroupId == widget.groupId,
            )
            .toList() ??
        [];
    final summary = data?.groupSummaries
        .where((item) => item.groupId == widget.groupId)
        .firstOrNull;

    return Scaffold(
        appBar: AppBar(title: Text(widget.groupName)),
        floatingActionButton: data == null || !widget.canWrite
            ? null
            : FloatingActionButton.extended(
                onPressed: _record,
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
                    OutlinedButton(
                      onPressed: _load,
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              )
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
                  children: [
                    _summaryCard(summary),
                    const SizedBox(height: 20),
                    Text('ENTRIES · ${entries.length}', style: eyebrowStyle()),
                    const SizedBox(height: 8),
                    if (entries.isEmpty)
                      const Text(
                        'Nothing recorded for this group yet.',
                        style: TextStyle(color: Colors.white54),
                      ),
                    for (final entry in entries)
                      HarmonyEntryRow(
                        entry: entry,
                        showGroup: false,
                        onTap: widget.canWrite
                            ? () => _entryActions(entry)
                            : null,
                      ),
                    if (transfers.isNotEmpty) ...[
                      const SizedBox(height: 20),
                      Text(
                        'TRANSFERS · ${transfers.length}',
                        style: eyebrowStyle(),
                      ),
                      const SizedBox(height: 8),
                      for (final transfer in transfers)
                        _transferRow(transfer),
                    ],
                  ],
                ),
              ),
    );
  }

  Widget _summaryCard(HarmonyGroupSummary? summary) {
    final net = summary?.net ?? 0;
    final positive = net >= 0;
    final rows = <(String, double, bool)>[
      ('Donations', summary?.donations ?? 0, true),
      ('Income', summary?.income ?? 0, true),
      ('Reimbursements', summary?.reimbursements ?? 0, true),
      ('Expenses', summary?.expenses ?? 0, false),
      ('Transfers in', summary?.transfersIn ?? 0, true),
      ('Transfers out', summary?.transfersOut ?? 0, false),
    ];

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
          Text('GROUP BALANCE', style: eyebrowStyle()),
          const SizedBox(height: 4),
          Text(
            formatCurrency(net, 'USD'),
            style: TextStyle(
              fontSize: 32,
              fontWeight: FontWeight.w700,
              fontFeatures: kTabularFigures,
              color: positive ? AppColors.positive : AppColors.danger,
            ),
          ),
          const SizedBox(height: 12),
          for (final (label, amount, isIn) in rows)
            if (amount != 0)
              Padding(
                padding: const EdgeInsets.only(bottom: 3),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        label,
                        style: const TextStyle(
                          fontSize: 13,
                          color: Colors.white70,
                        ),
                      ),
                    ),
                    Text(
                      '${isIn ? '+' : '−'}${formatCurrency(amount, 'USD')}',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        fontFeatures: kTabularFigures,
                        color: isIn ? AppColors.positive : AppColors.danger,
                      ),
                    ),
                  ],
                ),
              ),
        ],
      ),
    );
  }

  Widget _transferRow(HarmonyTransfer transfer) {
    final incoming = transfer.toGroupId == widget.groupId;
    final other = incoming
        ? (transfer.fromGroupName ?? 'Unallocated')
        : (transfer.toGroupName ?? 'Unallocated');
    return ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      leading: Icon(
        incoming ? Icons.call_received_rounded : Icons.call_made_rounded,
        size: 20,
        color: incoming ? AppColors.positive : AppColors.danger,
      ),
      title: Text(incoming ? 'From $other' : 'To $other'),
      subtitle: Text(
        [
          transfer.createdAt.split('T').first,
          if (transfer.note != null) transfer.note!,
        ].join(' · '),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontSize: 12, color: Colors.white54),
      ),
      trailing: Text(
        '${incoming ? '+' : '−'}'
        '${formatCurrency(transfer.amount, transfer.currency)}',
        style: TextStyle(
          fontWeight: FontWeight.w600,
          fontFeatures: kTabularFigures,
          color: incoming ? AppColors.positive : AppColors.danger,
        ),
      ),
    );
  }
}
