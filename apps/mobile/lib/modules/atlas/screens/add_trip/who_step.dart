import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/api_client.dart';
import '../../../../core/app_theme.dart';
import '../../atlas_colors.dart';
import '../../atlas_store.dart';
import '../../models/atlas_models.dart';
import '../../models/trip_draft.dart';
import '../../widgets/atlas_widgets.dart';
import 'add_trip_widgets.dart';

/// Step 3: circles and people. Solo clears everyone else.
class WhoStep extends StatelessWidget {
  final TripDraft draft;
  final AtlasStore store;
  final VoidCallback onChanged;

  const WhoStep({
    super.key,
    required this.draft,
    required this.store,
    required this.onChanged,
  });

  void _toggleCircle(String id, bool on) {
    HapticFeedback.selectionClick();
    if (!on) {
      draft.circleIds.remove(id);
    } else if (id == atlasSoloCircleId) {
      draft.circleIds
        ..clear()
        ..add(id);
      draft.personIds.clear();
    } else {
      draft.circleIds.remove(atlasSoloCircleId);
      if (!draft.circleIds.contains(id)) draft.circleIds.add(id);
    }
    onChanged();
  }

  Future<void> _newCircle(BuildContext context) async {
    final result = await showCircleEditor(
      context,
      suggestedColor: nextCircleColor(store.circles),
    );
    if (result == null) return;
    try {
      final circle = await store.createCircle(result.name, result.color);
      _toggleCircle(circle.circleId, true);
    } catch (e) {
      if (context.mounted) {
        showAppSnackBar(
          context,
          e is ApiException ? e.message : 'Could not create circle',
          error: true,
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: store,
      builder: (context, _) {
        final circles = store.circles;
        final solo = draft.circleIds.contains(atlasSoloCircleId);
        final people = [
          for (final p in store.people)
            if (draft.circleIds.isEmpty ||
                p.circleIds.any(draft.circleIds.contains) ||
                draft.personIds.contains(p.personId))
              p,
        ];
        return ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
          children: [
            Text('Who with?', style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 6),
            const Text(
              'Circles let you see the map you share with each group.',
              style: TextStyle(color: Colors.white54),
            ),
            const StepSection('Circles'),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final c in circles)
                  FilterChip(
                    avatar: CircleDot(color: circleHue(c.color)),
                    label: Text(c.name),
                    selected: draft.circleIds.contains(c.circleId),
                    selectedColor: circleHue(c.color).withValues(alpha: 0.22),
                    showCheckmark: false,
                    side: BorderSide(
                      color: draft.circleIds.contains(c.circleId)
                          ? circleHue(c.color)
                          : Colors.white12,
                    ),
                    onSelected: (v) => _toggleCircle(c.circleId, v),
                  ),
                ActionChip(
                  avatar: const Icon(Icons.add_rounded, size: 18),
                  label: const Text('New circle'),
                  onPressed: () => _newCircle(context),
                ),
              ],
            ),
            if (!solo && people.isNotEmpty) ...[
              const StepSection('People'),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final p in people)
                    FilterChip(
                      label: Text(p.name),
                      selected: draft.personIds.contains(p.personId),
                      onSelected: (v) {
                        v
                            ? draft.personIds.add(p.personId)
                            : draft.personIds.remove(p.personId);
                        onChanged();
                      },
                    ),
                ],
              ),
            ],
          ],
        );
      },
    );
  }
}
