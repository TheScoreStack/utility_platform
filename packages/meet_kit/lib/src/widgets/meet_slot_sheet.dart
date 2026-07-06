import 'package:flutter/material.dart';

import '../availability.dart';
import '../formatting.dart';
import '../models.dart';
import '../theme.dart';

/// "Who's free" bottom sheet for one grid slot: available / if-need-be /
/// no-response name lists, plus an optional organizer finalize action.
Future<void> showMeetSlotSheet({
  required BuildContext context,
  required MeetEvent event,
  required List<MeetParticipant> participants,
  required MeetHeatmap heatmap,
  required String date,
  required int slotIndex,
  Future<void> Function(MeetSlotRef slot)? onFinalize,
}) {
  return showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (_) => _MeetSlotSheet(
      event: event,
      participants: participants,
      heatmap: heatmap,
      date: date,
      slotIndex: slotIndex,
      onFinalize: onFinalize,
    ),
  );
}

class _MeetSlotSheet extends StatelessWidget {
  final MeetEvent event;
  final List<MeetParticipant> participants;
  final MeetHeatmap heatmap;
  final String date;
  final int slotIndex;
  final Future<void> Function(MeetSlotRef slot)? onFinalize;

  const _MeetSlotSheet({
    required this.event,
    required this.participants,
    required this.heatmap,
    required this.date,
    required this.slotIndex,
    required this.onFinalize,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final slot = meetSlotRef(event, date, slotIndex);
    final tally = heatmap.tally[date];
    final availableIds =
        tally != null && slotIndex < tally.available.length
            ? tally.available[slotIndex]
            : const <String>[];
    final ifNeedBeIds =
        tally != null && slotIndex < tally.ifNeedBe.length
            ? tally.ifNeedBe[slotIndex]
            : const <String>[];
    final byId = {for (final p in participants) p.participantId: p};
    String nameOf(String id) => byId[id]?.displayName ?? 'Someone';
    final responded = {...availableIds, ...ifNeedBeIds};
    final others = participants
        .where((p) => !responded.contains(p.participantId))
        .map((p) => p.displayName)
        .toList();

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(formatMeetDate(date), style: text.titleMedium),
              const SizedBox(height: 2),
              Text(
                '${formatMeetWindow(slot.startMinute, slot.endMinute)} · ${event.timezone}',
                style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
              ),
              const SizedBox(height: 16),
              _section(
                context,
                'AVAILABLE (${availableIds.length})',
                MeetColors.available,
                availableIds.map(nameOf).toList(),
                emptyLabel: 'No one yet',
              ),
              if (ifNeedBeIds.isNotEmpty) ...[
                const SizedBox(height: 14),
                _section(
                  context,
                  'IF NEED BE (${ifNeedBeIds.length})',
                  MeetColors.ifNeedBe,
                  ifNeedBeIds.map(nameOf).toList(),
                ),
              ],
              if (others.isNotEmpty) ...[
                const SizedBox(height: 14),
                _section(
                  context,
                  'UNAVAILABLE / NO RESPONSE (${others.length})',
                  scheme.onSurfaceVariant,
                  others,
                ),
              ],
              if (onFinalize != null) ...[
                const SizedBox(height: 20),
                FilledButton.icon(
                  icon: const Icon(Icons.check_circle_outline_rounded),
                  label: const Text('Finalize this time'),
                  onPressed: () async {
                    final navigator = Navigator.of(context);
                    await onFinalize!(slot);
                    if (navigator.mounted) navigator.pop();
                  },
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _section(
    BuildContext context,
    String title,
    Color color,
    List<String> names, {
    String? emptyLabel,
  }) {
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: text.labelSmall?.copyWith(
            color: color,
            letterSpacing: 1.2,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 6),
        if (names.isEmpty)
          Text(
            emptyLabel ?? '—',
            style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
          )
        else
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final name in names)
                Chip(
                  avatar: Icon(Icons.circle, size: 10, color: color),
                  label: Text(name),
                  visualDensity: VisualDensity.compact,
                ),
            ],
          ),
      ],
    );
  }
}
