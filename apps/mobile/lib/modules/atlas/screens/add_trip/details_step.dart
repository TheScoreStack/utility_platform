import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/app_theme.dart';
import '../../atlas_store.dart';
import '../../lens.dart';
import '../../models/atlas_models.dart';
import '../../models/trip_draft.dart';
import '../../widgets/atlas_widgets.dart';
import '../../widgets/place_search_sheet.dart';
import 'add_trip_widgets.dart';

/// Step 4: legs, cover photo, rating and notes. Everything here is optional.
///
/// The cover upload itself lives in the shell: it gates Save and has to
/// outlive this page when the user moves to another step mid-upload.
class DetailsStep extends StatelessWidget {
  final TripDraft draft;
  final AtlasStore store;
  final TextEditingController title;
  final TextEditingController notes;
  final bool uploading;
  final String? localCover;
  final VoidCallback onPickCover;
  final VoidCallback onClearCover;
  final VoidCallback onChanged;

  const DetailsStep({
    super.key,
    required this.draft,
    required this.store,
    required this.title,
    required this.notes,
    required this.uploading,
    required this.localCover,
    required this.onPickCover,
    required this.onClearCover,
    required this.onChanged,
  });

  void _addLeg() {
    final prev = draft.legs.isNotEmpty ? draft.legs.last : null;
    // A first flight starts at the airport you fly from most. Home is a
    // city, and a flight from a city wouldn't count toward airports or
    // routes, so with no flight history the start is left to pick.
    final usualAirport = frequentPlaces(
      store.trips,
      airports: true,
      limit: 1,
    ).firstOrNull;
    draft.legs.add(
      LegDraft(mode: prev?.mode ?? 'flight', from: prev?.to ?? usualAirport),
    );
    onChanged();
  }

  /// The last leg, if it's complete and nothing already goes back the other
  /// way. Drives the "Add return …" shortcut.
  LegDraft? get _returnable {
    if (draft.legs.isEmpty) return null;
    final last = draft.legs.last;
    if (!last.complete) return null;
    final back = draft.legs.any(
      (l) =>
          l.complete &&
          samePlace(l.from!, last.to!) &&
          samePlace(l.to!, last.from!),
    );
    return back ? null : last;
  }

  void _addReturn(LegDraft last) {
    HapticFeedback.selectionClick();
    draft.legs.add(
      LegDraft(
        mode: last.mode,
        from: last.to,
        to: last.from,
        airline: last.airline,
      ),
    );
    onChanged();
  }

  @override
  Widget build(BuildContext context) {
    final returnable = _returnable;
    return ListView(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
      children: [
        Text(
          'Anything else?',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: 6),
        const Text(
          'All optional. Flights add arcs and miles to your map.',
          style: TextStyle(color: Colors.white54),
        ),
        const SizedBox(height: 16),
        TextField(
          controller: title,
          // A trip name is a title: "Napa Anniversary".
          textCapitalization: TextCapitalization.words,
          textInputAction: TextInputAction.done,
          maxLength: 120,
          onChanged: (_) => onChanged(),
          decoration: InputDecoration(
            labelText: 'Trip name',
            hintText: draft.hasPlaces
                ? draft.effectiveTitle
                : 'Napa Anniversary',
            counterText: '',
          ),
        ),
        const StepSection('Travel'),
        for (var i = 0; i < draft.legs.length; i++)
          _LegCard(
            // Keyed by leg so the airline / flight no. fields follow their
            // leg when legs move or are removed.
            key: ObjectKey(draft.legs[i]),
            draft: draft,
            index: i,
            store: store,
            onChanged: onChanged,
          ),
        // The return leg is the usual next step, so it leads.
        if (returnable != null) ...[
          FilledButton.tonalIcon(
            onPressed: () => _addReturn(returnable),
            icon: const Icon(Icons.u_turn_left_rounded),
            label: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Add return ${returnable.mode}'),
                Text(
                  '${_short(returnable.to!)} → ${_short(returnable.from!)}',
                  style: const TextStyle(fontSize: 12, color: Colors.white54),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
        ],
        OutlinedButton.icon(
          onPressed: _addLeg,
          icon: const Icon(Icons.add_rounded),
          label: Text(
            draft.legs.isEmpty ? 'Add a flight or drive' : 'Add another leg',
          ),
        ),
        const StepSection('Cover photo'),
        _cover(),
        const StepSection('Rating'),
        StarRating(
          value: draft.rating,
          size: 32,
          onChanged: (v) {
            HapticFeedback.selectionClick();
            draft.rating = v;
            onChanged();
          },
        ),
        const StepSection('Notes'),
        TextField(
          controller: notes,
          minLines: 3,
          maxLines: 8,
          maxLength: 4000,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(
            hintText: 'The pastel de nata place by the tram stop…',
            border: OutlineInputBorder(),
            counterText: '',
          ),
        ),
      ],
    );
  }

  Widget _cover() {
    final Widget? image = localCover != null
        ? Image.file(File(localCover!), fit: BoxFit.cover)
        : (draft.coverKey != null && draft.coverUrl != null)
        ? Image.network(draft.coverUrl!, fit: BoxFit.cover)
        : null;
    return InkWell(
      onTap: uploading ? null : onPickCover,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        height: 150,
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.04),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white12),
        ),
        child: Stack(
          fit: StackFit.expand,
          children: [
            ?image,
            if (image == null)
              const Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.add_photo_alternate_outlined, size: 32),
                    SizedBox(height: 6),
                    Text(
                      'Add a cover photo',
                      style: TextStyle(color: Colors.white60),
                    ),
                  ],
                ),
              ),
            if (uploading)
              const ColoredBox(
                color: Colors.black45,
                child: Center(child: CircularProgressIndicator()),
              ),
            if (image != null && !uploading)
              Positioned(
                right: 8,
                top: 8,
                child: IconButton.filledTonal(
                  icon: const Icon(Icons.close_rounded, size: 18),
                  onPressed: onClearCover,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

String _short(AtlasPlace p) => p.iata ?? p.name;

const _modes = [
  ('flight', Icons.flight_rounded, 'Flight'),
  ('drive', Icons.directions_car_rounded, 'Drive'),
  ('train', Icons.train_rounded, 'Train'),
  ('boat', Icons.directions_boat_rounded, 'Boat'),
];

/// One leg: mode, from → to, and airline / flight number for flights.
class _LegCard extends StatelessWidget {
  final TripDraft draft;
  final int index;
  final AtlasStore store;
  final VoidCallback onChanged;

  const _LegCard({
    super.key,
    required this.draft,
    required this.index,
    required this.store,
    required this.onChanged,
  });

  void _move(int to) {
    final leg = draft.legs.removeAt(index);
    draft.legs.insert(to, leg);
    onChanged();
  }

  /// Flights: your most-used airports. Otherwise: this trip's stops, then
  /// home. Never the leg's other end.
  List<QuickPick> _quickPicks(LegDraft leg, bool from) {
    final other = from ? leg.to : leg.from;
    bool skip(AtlasPlace p) => other != null && samePlace(p, other);
    if (leg.mode == 'flight') {
      final airports = frequentPlaces(
        store.trips,
        airports: true,
        limit: 1 << 30,
      ).where((p) => !skip(p));
      return [for (final p in airports.take(6)) QuickPick.place(p)];
    }
    final picks = <QuickPick>[];
    for (final p in draft.stops) {
      if (skip(p) || picks.any((q) => samePlace(q.place, p))) continue;
      picks.add(QuickPick.place(p));
    }
    final home = store.profile.homePlace;
    if (home != null &&
        !skip(home) &&
        !picks.any((q) => samePlace(q.place, home))) {
      picks.add(QuickPick.home(home));
    }
    return picks;
  }

  Future<void> _pickPlace(BuildContext context, LegDraft leg, bool from) async {
    final place = await showPlaceSearch(
      context,
      store: store,
      title: from ? 'From' : 'To',
      hint: leg.mode == 'flight' ? 'Airport or city (e.g. SFO)' : 'City',
      quickPicks: _quickPicks(leg, from),
    );
    if (place == null) return;
    from ? leg.from = place : leg.to = place;
    onChanged();
  }

  @override
  Widget build(BuildContext context) {
    final leg = draft.legs[index];
    Widget endpoint(String label, AtlasPlace? p, bool from) => Expanded(
      child: InkWell(
        onTap: () => _pickPlace(context, leg, from),
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.04),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label.toUpperCase(), style: kEyebrow),
              const SizedBox(height: 4),
              Text(
                p == null ? 'Choose' : (p.iata ?? p.name),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: p?.iata != null ? 22 : 15,
                  fontWeight: FontWeight.w700,
                  color: p == null ? Colors.white38 : Colors.white,
                ),
              ),
              if (p?.iata != null)
                Text(
                  p!.locality ?? p.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12, color: Colors.white54),
                ),
            ],
          ),
        ),
      ),
    );

    final miles = leg.complete
        ? greatCircleMiles(leg.from!, leg.to!).round()
        : null;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                for (final (mode, icon, label) in _modes)
                  Padding(
                    padding: const EdgeInsets.only(right: 2),
                    child: IconButton(
                      tooltip: label,
                      visualDensity: VisualDensity.compact,
                      isSelected: leg.mode == mode,
                      icon: Icon(icon),
                      style: IconButton.styleFrom(
                        backgroundColor: leg.mode == mode
                            ? AppColors.accent.withValues(alpha: 0.25)
                            : null,
                      ),
                      onPressed: () {
                        leg.mode = mode;
                        onChanged();
                      },
                    ),
                  ),
                const Spacer(),
                IconButton(
                  tooltip: 'Move up',
                  visualDensity: VisualDensity.compact,
                  icon: const Icon(Icons.arrow_upward_rounded),
                  onPressed: index == 0 ? null : () => _move(index - 1),
                ),
                IconButton(
                  tooltip: 'Move down',
                  visualDensity: VisualDensity.compact,
                  icon: const Icon(Icons.arrow_downward_rounded),
                  onPressed: index == draft.legs.length - 1
                      ? null
                      : () => _move(index + 1),
                ),
                IconButton(
                  tooltip: 'Remove leg',
                  visualDensity: VisualDensity.compact,
                  icon: const Icon(Icons.delete_outline_rounded),
                  onPressed: () {
                    draft.legs.removeAt(index);
                    onChanged();
                  },
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                endpoint('From', leg.from, true),
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 8),
                  child: Icon(
                    Icons.arrow_forward_rounded,
                    color: Colors.white38,
                  ),
                ),
                endpoint('To', leg.to, false),
              ],
            ),
            // A half-filled leg isn't saved; say so instead of dropping it
            // silently when the trip saves.
            if (!leg.complete)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text(
                  'Pick both ends, or remove this leg. It won\u2019t be saved half-filled.',
                  style: TextStyle(color: AppColors.warning, fontSize: 12),
                ),
              ),
            if (miles != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  '${formatCount(miles)} mi',
                  style: const TextStyle(color: Colors.white54, fontSize: 12),
                ),
              ),
            if (leg.mode == 'flight') ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    flex: 3,
                    child: TextFormField(
                      initialValue: leg.airline,
                      decoration: const InputDecoration(
                        labelText: 'Airline',
                        counterText: '',
                      ),
                      maxLength: 80,
                      textCapitalization: TextCapitalization.words,
                      // Brand names ("JetBlue", "easyJet") get mangled by
                      // autocorrect.
                      autocorrect: false,
                      textInputAction: TextInputAction.next,
                      onChanged: (v) => leg.airline = v.trim(),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    flex: 2,
                    child: TextFormField(
                      initialValue: leg.flightNumber,
                      decoration: const InputDecoration(
                        labelText: 'Flight no.',
                        hintText: 'UA837',
                      ),
                      textCapitalization: TextCapitalization.characters,
                      autocorrect: false,
                      enableSuggestions: false,
                      keyboardType: TextInputType.visiblePassword,
                      inputFormatters: [FlightNumberFormatter()],
                      textInputAction: TextInputAction.done,
                      onChanged: (v) => leg.flightNumber = v,
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
