import 'package:flutter/material.dart';

import '../theme.dart';

/// Chooses the level painted by [MeetAvailabilityGrid] in edit mode:
/// available (2) / if need be (1) / unavailable (0, the eraser). The
/// if-need-be chip is hidden when the event disables that tier.
class MeetLevelSelector extends StatelessWidget {
  final int level;
  final ValueChanged<int> onChanged;
  final bool allowIfNeedBe;

  const MeetLevelSelector({
    super.key,
    required this.level,
    required this.onChanged,
    this.allowIfNeedBe = true,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Wrap(
      spacing: 8,
      children: [
        _chip(context, 2, 'Available', MeetColors.available),
        if (allowIfNeedBe) _chip(context, 1, 'If need be', MeetColors.ifNeedBe),
        _chip(context, 0, 'Unavailable', scheme.onSurfaceVariant),
      ],
    );
  }

  Widget _chip(BuildContext context, int value, String label, Color color) {
    final selected = level == value;
    return ChoiceChip(
      selected: selected,
      onSelected: (_) => onChanged(value),
      avatar: Icon(
        Icons.circle,
        size: 12,
        color: color.withValues(alpha: selected ? 1 : 0.6),
      ),
      label: Text(label),
      showCheckmark: false,
      selectedColor: color.withValues(alpha: 0.22),
      side: BorderSide(color: color.withValues(alpha: selected ? 0.8 : 0.25)),
    );
  }
}
