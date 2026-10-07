import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../atlas_colors.dart';
import '../atlas_geo_data.dart';
import '../atlas_store.dart';
import '../lens.dart';
import '../models/atlas_models.dart';
import '../widgets/atlas_widgets.dart';
import '../widgets/place_search_sheet.dart';

/// Places you want to go, grouped by continent, with a "been there"
/// section for wishes checked off by a trip.
class WishlistScreen extends StatelessWidget {
  final AtlasStore store;

  const WishlistScreen({super.key, required this.store});

  Future<void> _run(
    BuildContext context,
    Future<void> Function() action,
  ) async {
    try {
      await action();
    } catch (e) {
      if (context.mounted) {
        showAppSnackBar(
          context,
          e is ApiException ? e.message : 'Something went wrong',
          error: true,
        );
      }
    }
  }

  Future<void> _add(BuildContext context) async {
    final place = await showPlaceSearch(
      context,
      store: store,
      title: 'Where do you want to go?',
    );
    if (place == null || !context.mounted) return;
    final selected = <String>{
      if (store.lens.circle != 'all') store.lens.circle,
    };
    final note = TextEditingController();
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => Padding(
          padding: EdgeInsets.fromLTRB(
            20,
            0,
            20,
            20 + MediaQuery.viewInsetsOf(ctx).bottom,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(place.name, style: Theme.of(ctx).textTheme.headlineSmall),
              Text(
                countryName(place.countryCode),
                style: const TextStyle(color: Colors.white54),
              ),
              const SizedBox(height: 16),
              Text('WITH', style: kEyebrow),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final c in store.circles)
                    FilterChip(
                      avatar: CircleDot(color: circleHue(c.color)),
                      label: Text(c.name),
                      showCheckmark: false,
                      selected: selected.contains(c.circleId),
                      onSelected: (v) => setSheet(() {
                        if (!v) {
                          selected.remove(c.circleId);
                        } else if (c.circleId == atlasSoloCircleId) {
                          selected
                            ..clear()
                            ..add(c.circleId);
                        } else {
                          selected
                            ..remove(atlasSoloCircleId)
                            ..add(c.circleId);
                        }
                      }),
                    ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                controller: note,
                maxLength: 500,
                decoration: const InputDecoration(labelText: 'Note (optional)'),
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () => Navigator.pop(ctx, true),
                  child: const Text('Add to wishlist'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    final noteText = note.text.trim();
    note.dispose();
    if (ok != true || !context.mounted) return;
    HapticFeedback.selectionClick();
    await _run(
      context,
      () => store.createWish(
        place,
        selected.toList(),
        note: noteText.isEmpty ? null : noteText,
      ),
    );
  }

  Future<void> _checkOff(BuildContext context, AtlasWish wish) async {
    if (wish.fulfilled) {
      await _run(context, () => store.setWishFulfilled(wish, null));
      return;
    }
    final matching = [
      for (final t in store.trips)
        if (tripPlaces(t).any((p) => p.countryCode == wish.place.countryCode))
          t,
    ];
    final trips = matching.isNotEmpty ? matching : store.trips;
    if (trips.isEmpty) {
      showAppSnackBar(context, 'Log the trip first, then check this off.');
      return;
    }
    final picked = await showModalBottomSheet<AtlasTrip>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (ctx) => ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(ctx).height * 0.6,
        ),
        child: ListView(
          shrinkWrap: true,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Text('Which trip got you there?'),
            ),
            for (final t in trips)
              TripTile(
                trip: t,
                store: store,
                onTap: () => Navigator.pop(ctx, t),
              ),
          ],
        ),
      ),
    );
    if (picked == null || !context.mounted) return;
    HapticFeedback.mediumImpact();
    await _run(context, () => store.setWishFulfilled(wish, picked.tripId));
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: store,
      builder: (context, _) {
        final open = [
          for (final w in store.wishes)
            if (!w.fulfilled) w,
        ];
        final done = [
          for (final w in store.wishes)
            if (w.fulfilled) w,
        ];
        final groups = <String, List<AtlasWish>>{};
        for (final w in open) {
          final key = continentOf(w.place.countryCode) ?? '';
          groups.putIfAbsent(key, () => []).add(w);
        }
        final order = [...atlasContinents.keys, ''];

        Widget tile(AtlasWish w) {
          final circles = [for (final id in w.circleIds) ?store.circleById(id)];
          return Dismissible(
            key: ValueKey(w.wishId),
            direction: DismissDirection.endToStart,
            background: Container(
              alignment: Alignment.centerRight,
              padding: const EdgeInsets.only(right: 24),
              color: AppColors.danger.withValues(alpha: 0.25),
              child: const Icon(Icons.delete_outline_rounded),
            ),
            onDismissed: (_) => _run(context, () => store.deleteWish(w.wishId)),
            child: ListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 20),
              leading: IconButton(
                icon: Icon(
                  w.fulfilled
                      ? Icons.check_circle_rounded
                      : Icons.radio_button_unchecked_rounded,
                  color: w.fulfilled ? AppColors.positive : Colors.white38,
                ),
                onPressed: () => _checkOff(context, w),
              ),
              title: Text(
                w.place.name,
                style: w.fulfilled
                    ? const TextStyle(
                        decoration: TextDecoration.lineThrough,
                        color: Colors.white54,
                      )
                    : null,
              ),
              subtitle: Text(
                [
                  if (w.place.kind != 'country')
                    countryName(w.place.countryCode),
                  if (w.note != null && w.note!.isNotEmpty) w.note!,
                ].join('  ·  '),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  for (final c in circles)
                    Padding(
                      padding: const EdgeInsets.only(left: 3),
                      child: CircleDot(color: circleHue(c.color), size: 8),
                    ),
                ],
              ),
            ),
          );
        }

        return Scaffold(
          appBar: AppBar(title: const Text('Wishlist')),
          floatingActionButton: FloatingActionButton.extended(
            onPressed: () => _add(context),
            icon: const Icon(Icons.bookmark_add_outlined),
            label: const Text('Add a place'),
          ),
          body: store.wishes.isEmpty
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(32),
                    child: Text(
                      'Places you want to go show up as dashed pins on your '
                      'map when "Want to go" is on.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.white54),
                    ),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.only(bottom: 96),
                  children: [
                    for (final key in order)
                      if (groups[key] != null) ...[
                        Padding(
                          padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
                          child: Text(
                            (atlasContinents[key] ?? 'Elsewhere').toUpperCase(),
                            style: kEyebrow,
                          ),
                        ),
                        for (final w in groups[key]!) tile(w),
                      ],
                    if (done.isNotEmpty) ...[
                      Padding(
                        padding: const EdgeInsets.fromLTRB(20, 24, 20, 4),
                        child: Text(
                          'BEEN THERE',
                          style: eyebrowStyle(AppColors.positive),
                        ),
                      ),
                      for (final w in done) tile(w),
                    ],
                  ],
                ),
        );
      },
    );
  }
}
