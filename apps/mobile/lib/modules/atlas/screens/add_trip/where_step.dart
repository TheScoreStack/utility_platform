import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/app_theme.dart';
import '../../atlas_store.dart';
import '../../lens.dart';
import '../../models/atlas_models.dart';
import '../../models/trip_draft.dart';
import '../../widgets/place_search_sheet.dart';
import 'add_trip_widgets.dart';

/// Step 1: trip name and the ordered list of stops. The only required step.
class WhereStep extends StatelessWidget {
  final TripDraft draft;
  final AtlasStore store;
  final TextEditingController title;
  final VoidCallback onChanged;

  /// The trip being edited, left out of the frequent-places picks.
  final String? tripId;

  const WhereStep({
    super.key,
    required this.draft,
    required this.store,
    required this.title,
    required this.onChanged,
    this.tripId,
  });

  /// Home first (unless already a stop), then up to six places from other
  /// trips that aren't stops yet.
  List<QuickPick> _quickPicks() {
    bool taken(AtlasPlace p) => draft.stops.any((s) => samePlace(s, p));
    final home = store.profile.homePlace;
    final showHome = home != null && !taken(home);
    final frequent = frequentPlaces(
      [
        for (final t in store.trips)
          if (t.tripId != tripId) t,
      ],
      airports: false,
      limit: 1 << 30,
    ).where((p) => !taken(p) && !(showHome && samePlace(p, home)));
    return [
      if (showHome) QuickPick.home(home),
      for (final p in frequent.take(6)) QuickPick.place(p),
    ];
  }

  Future<void> _addStop(BuildContext context) async {
    final place = await showPlaceSearch(
      context,
      store: store,
      title: draft.stops.isEmpty ? 'Where did you go?' : 'Add another stop',
      quickPicks: _quickPicks(),
    );
    if (place == null) return;
    HapticFeedback.selectionClick();
    draft.stops.add(place);
    draft.stopIds.add(null);
    onChanged();
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
      children: [
        Text(
          'Where did you go?',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: 16),
        TextField(
          controller: title,
          textCapitalization: TextCapitalization.sentences,
          textInputAction: TextInputAction.done,
          maxLength: 120,
          onChanged: (_) => onChanged(),
          decoration: InputDecoration(
            labelText: 'Trip name (optional)',
            hintText: draft.hasPlaces
                ? draft.effectiveTitle
                : 'Lisbon with Ana',
          ),
        ),
        const StepSection('Stops'),
        if (draft.stops.isEmpty)
          const Padding(
            padding: EdgeInsets.only(bottom: 12),
            child: Text(
              'Add a city, country, or airport. You can add several.',
              style: TextStyle(color: Colors.white54),
            ),
          ),
        ReorderableListView(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          buildDefaultDragHandles: false,
          onReorderItem: (from, to) {
            final p = draft.stops.removeAt(from);
            final id = draft.stopIds.removeAt(from);
            draft.stops.insert(to, p);
            draft.stopIds.insert(to, id);
            onChanged();
          },
          children: [
            for (var i = 0; i < draft.stops.length; i++)
              ListTile(
                key: ValueKey('stop_${i}_${draft.stops[i].providerId}'),
                contentPadding: EdgeInsets.zero,
                leading: CircleAvatar(
                  radius: 14,
                  backgroundColor: AppColors.accent,
                  child: Text(
                    '${i + 1}',
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                    ),
                  ),
                ),
                title: Text(draft.stops[i].name),
                subtitle: Text(_placeSubtitle(draft.stops[i])),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.close_rounded, size: 20),
                      onPressed: () {
                        draft.stops.removeAt(i);
                        draft.stopIds.removeAt(i);
                        onChanged();
                      },
                    ),
                    ReorderableDragStartListener(
                      index: i,
                      child: const Icon(Icons.drag_handle_rounded),
                    ),
                  ],
                ),
              ),
          ],
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: () => _addStop(context),
          icon: const Icon(Icons.add_location_alt_outlined),
          label: Text(draft.stops.isEmpty ? 'Add a place' : 'Add another stop'),
        ),
      ],
    );
  }
}

String _placeSubtitle(AtlasPlace p) {
  final parts = <String>[
    if (p.locality != null && p.locality != p.name) p.locality!,
    if (p.regionCode != null && p.regionCode!.startsWith('US-'))
      regionName(p.regionCode!)
    else if (p.regionName != null)
      p.regionName!,
    countryName(p.countryCode),
  ];
  return parts.join(', ');
}
