import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../../../core/formatters.dart';
import '../harmony_api.dart';
import '../models/harmony_models.dart';
import 'staged_txn_tile.dart' show kEntryTypeLabels;

const _sourceOptions = [
  'Cash',
  'Debit',
  'Check',
  'Direct deposit',
  'Venmo',
  'PayPal',
  'Other',
];

/// Quick ledger-entry sheet. Without [initialEntry] it records a new money
/// movement (any of the four entry types, with a source chip — cash, check,
/// direct deposit, …); with it, it edits the entry in place via PATCH
/// (source left untouched). Resolves to the created/updated entry, or null
/// when dismissed.
Future<HarmonyEntry?> showHarmonyEntrySheet({
  required BuildContext context,
  required HarmonyApi api,
  required List<HarmonyGroup> groups,
  HarmonyEntry? initialEntry,
  /// Preselects a group when creating (e.g. recording from a group screen).
  String? initialGroupId,
}) {
  return showModalBottomSheet<HarmonyEntry>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _EntrySheet(
      api: api,
      groups: groups,
      initialEntry: initialEntry,
      initialGroupId: initialGroupId,
    ),
  );
}

class _EntrySheet extends StatefulWidget {
  final HarmonyApi api;
  final List<HarmonyGroup> groups;
  final HarmonyEntry? initialEntry;
  final String? initialGroupId;

  const _EntrySheet({
    required this.api,
    required this.groups,
    this.initialEntry,
    this.initialGroupId,
  });

  @override
  State<_EntrySheet> createState() => _EntrySheetState();
}

class _EntrySheetState extends State<_EntrySheet> {
  final _amountController = TextEditingController();
  final _descriptionController = TextEditingController();
  late String _type;
  String? _groupId;
  String _source = 'Cash';
  bool _saving = false;
  String? _error;

  /// 'none' | 'weekly' | 'monthly' — creates a recurring template alongside
  /// the entry. Only offered when creating.
  String _cadence = 'none';

  bool get _isEditing => widget.initialEntry != null;

  /// Chips shown in the VIA row — the standard options plus, when editing
  /// an entry whose source isn't one of them (e.g. "Bank import"), that
  /// source so it stays selectable.
  late final List<String> _sourceChips;

  @override
  void initState() {
    super.initState();
    final initial = widget.initialEntry;
    _type = initial?.type ?? 'DONATION';
    _groupId = initial?.groupId ?? widget.initialGroupId;
    final initialSource = initial?.source;
    if (initial != null) {
      _amountController.text = initial.amount.toStringAsFixed(2);
      _descriptionController.text = initial.description ?? '';
      _source = initialSource ?? 'Other';
    }
    _sourceChips = [
      if (initialSource != null && !_sourceOptions.contains(initialSource))
        initialSource,
      ..._sourceOptions,
    ];
  }

  @override
  void dispose() {
    _amountController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  double get _amount =>
      double.tryParse(_amountController.text.trim().replaceAll(',', '.')) ?? 0;

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final description = _descriptionController.text.trim();
      final amount = double.parse(_amount.toStringAsFixed(2));
      final HarmonyEntry entry;
      if (_isEditing) {
        final initial = widget.initialEntry!;
        final newSource = _source == 'Other' ? null : _source;
        // PATCH only what changed; null clears a previously-set field.
        final changes = <String, dynamic>{
          if (_type != initial.type) 'type': _type,
          if (amount != initial.amount) 'amount': amount,
          if (description != (initial.description ?? ''))
            'description': description.isEmpty ? null : description,
          if (newSource != initial.source) 'source': newSource,
          if (_groupId != initial.groupId) 'groupId': _groupId,
        };
        if (changes.isEmpty) {
          Navigator.of(context).pop();
          return;
        }
        entry = await widget.api.updateEntry(
          initial.entryId,
          initial.recordedAt,
          changes,
        );
      } else {
        entry = await widget.api.createEntry(
          type: _type,
          amount: amount,
          description: description.isEmpty ? null : description,
          source: _source == 'Other' ? null : _source,
          groupId: _groupId,
        );
        if (_cadence != 'none') {
          // Today's entry was just recorded; the template takes over from
          // the next cycle.
          await widget.api.createRecurringTemplate(
            type: _type,
            amount: amount,
            description: description.isEmpty ? null : description,
            groupId: _groupId,
            cadence: _cadence,
          );
        }
      }
      if (!mounted) return;
      HapticFeedback.mediumImpact();
      Navigator.of(context).pop(entry);
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
        _error = 'Could not save the entry.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final activeGroups = widget.groups
        .where((group) => group.isActive)
        .toList();
    final outflow = _type == 'EXPENSE';

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
                _isEditing ? 'Edit entry' : 'Record money',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 4),
              Text(
                _isEditing
                    ? 'Changes apply straight to the ledger.'
                    : outflow
                    ? 'Money the collective paid out.'
                    : 'Money the collective took in.',
                style: const TextStyle(fontSize: 12, color: Colors.white70),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _amountController,
                autofocus: !_isEditing,
                enabled: !_saving,
                onChanged: (_) => setState(() {}),
                textAlign: TextAlign.center,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
                ],
                style: TextStyle(
                  fontSize: 34,
                  fontWeight: FontWeight.w700,
                  fontFeatures: kTabularFigures,
                  color: outflow ? AppColors.danger : AppColors.positive,
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
              Text('TYPE', style: eyebrowStyle()),
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 2,
                children: [
                  for (final type in kEntryTypeLabels.keys)
                    ChoiceChip(
                      label: Text(kEntryTypeLabels[type]!),
                      selected: _type == type,
                      visualDensity: VisualDensity.compact,
                      onSelected: _saving
                          ? null
                          : (_) {
                              HapticFeedback.selectionClick();
                              setState(() => _type = type);
                            },
                    ),
                ],
              ),
              const SizedBox(height: 14),
              Text('VIA', style: eyebrowStyle()),
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 2,
                children: [
                  for (final source in _sourceChips)
                    ChoiceChip(
                      label: Text(source),
                      selected: _source == source,
                      visualDensity: VisualDensity.compact,
                      onSelected: _saving
                          ? null
                          : (_) {
                              HapticFeedback.selectionClick();
                              setState(() => _source = source);
                            },
                    ),
                ],
              ),
              const SizedBox(height: 14),
              Text('GROUP', style: eyebrowStyle()),
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 2,
                children: [
                  ChoiceChip(
                    label: const Text('Unallocated'),
                    selected: _groupId == null,
                    visualDensity: VisualDensity.compact,
                    onSelected: _saving
                        ? null
                        : (_) => setState(() => _groupId = null),
                  ),
                  for (final group in activeGroups)
                    ChoiceChip(
                      label: Text(group.name),
                      selected: _groupId == group.groupId,
                      visualDensity: VisualDensity.compact,
                      onSelected: _saving
                          ? null
                          : (_) {
                              HapticFeedback.selectionClick();
                              setState(() => _groupId = group.groupId);
                            },
                    ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _descriptionController,
                enabled: !_saving,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                  labelText: 'What was it for? (optional)',
                  isDense: true,
                  border: OutlineInputBorder(),
                ),
              ),
              if (!_isEditing) ...[
                const SizedBox(height: 14),
                Row(
                  children: [
                    Text('REPEATS', style: eyebrowStyle()),
                    const SizedBox(width: 12),
                    Expanded(
                      child: SegmentedButton<String>(
                        segments: const [
                          ButtonSegment(value: 'none', label: Text('Never')),
                          ButtonSegment(value: 'weekly', label: Text('Weekly')),
                          ButtonSegment(
                            value: 'monthly',
                            label: Text('Monthly'),
                          ),
                        ],
                        selected: {_cadence},
                        showSelectedIcon: false,
                        style: const ButtonStyle(
                          visualDensity: VisualDensity.compact,
                        ),
                        onSelectionChanged: _saving
                            ? null
                            : (selection) {
                                HapticFeedback.selectionClick();
                                setState(() => _cadence = selection.first);
                              },
                      ),
                    ),
                  ],
                ),
                if (_cadence != 'none') ...[
                  const SizedBox(height: 6),
                  Text(
                    'Posts this ${kEntryTypeLabels[_type]?.toLowerCase()} '
                    'automatically every '
                    '${_cadence == 'weekly' ? 'week' : 'month'}, starting '
                    'next cycle. Manage it from the web ledger.',
                    style: const TextStyle(fontSize: 12, color: Colors.white70),
                  ),
                ],
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
                onPressed: _amount > 0 && !_saving ? _save : null,
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                child: _saving
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(
                        _amount > 0
                            ? (_isEditing ? 'Save changes' : 'Record it')
                            : 'Enter an amount',
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
