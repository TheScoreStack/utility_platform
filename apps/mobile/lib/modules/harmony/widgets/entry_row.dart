import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../../../core/formatters.dart';
import '../harmony_api.dart';
import '../models/harmony_models.dart';
import 'entry_sheet.dart';

/// Compact ledger-entry row: type icon, description, date/group/source
/// subtitle, signed colored amount.
class HarmonyEntryRow extends StatelessWidget {
  final HarmonyEntry entry;
  final VoidCallback? onTap;

  /// Hides the group from the subtitle (e.g. on a group's own screen).
  final bool showGroup;

  const HarmonyEntryRow({
    super.key,
    required this.entry,
    this.onTap,
    this.showGroup = true,
  });

  @override
  Widget build(BuildContext context) {
    final inflow = entry.isInflow;
    return ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      onTap: onTap,
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
          if (showGroup && entry.groupName != null) entry.groupName!,
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

/// Entry action sheet (edit / view source statement / delete). Resolves to
/// true when the ledger changed (an edit was saved or the entry deleted).
Future<bool> showHarmonyEntryActions({
  required BuildContext context,
  required HarmonyApi api,
  required List<HarmonyGroup> groups,
  required HarmonyEntry entry,
}) async {
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
          if (entry.importStatementId != null)
            ListTile(
              leading: const Icon(Icons.attachment_rounded),
              title: const Text('View source statement'),
              onTap: () => Navigator.of(sheetContext).pop('source'),
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
  if (action == null || !context.mounted) return false;

  switch (action) {
    case 'edit':
      final updated = await showHarmonyEntrySheet(
        context: context,
        api: api,
        groups: groups,
        initialEntry: entry,
      );
      if (updated != null && context.mounted) {
        showAppSnackBar(context, 'Entry updated.', success: true);
        return true;
      }
      return false;

    case 'source':
      final statementId = entry.importStatementId;
      if (statementId == null) return false;
      try {
        final url = await api.getStatementFileUrl(statementId);
        if (!context.mounted) return false;
        final launched = await launchUrl(
          Uri.parse(url),
          mode: LaunchMode.externalApplication,
        );
        if (!launched && context.mounted) {
          showAppSnackBar(context, 'Could not open the file.', error: true);
        }
      } on ApiException catch (error) {
        if (context.mounted) {
          showAppSnackBar(context, error.message, error: true);
        }
      }
      return false;

    case 'delete':
      final proceed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Delete this entry?'),
          content: Text(
            '${formatCurrency(entry.amount, entry.currency)} '
            '${entry.description ?? entry.type.toLowerCase()} will be '
            'removed from the ledger.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.danger,
              ),
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('Delete'),
            ),
          ],
        ),
      );
      if (proceed != true || !context.mounted) return false;
      try {
        await api.deleteEntry(entry.entryId, entry.recordedAt);
        if (context.mounted) {
          showAppSnackBar(context, 'Entry deleted.', success: true);
        }
        return true;
      } on ApiException catch (error) {
        if (context.mounted) {
          showAppSnackBar(context, error.message, error: true);
        }
        return false;
      }
  }
  return false;
}
