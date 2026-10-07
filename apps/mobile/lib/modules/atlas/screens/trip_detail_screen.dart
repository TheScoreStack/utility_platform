import 'package:flutter/material.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../atlas_colors.dart';
import '../atlas_store.dart';
import '../lens.dart';
import '../map/trip_route_map.dart';
import '../models/atlas_models.dart';
import '../widgets/atlas_widgets.dart';
import '../widgets/place_search_sheet.dart';
import 'add_trip/add_trip_flow.dart';
import 'atlas_home_screen.dart' show handleTripSaved;

class TripDetailScreen extends StatelessWidget {
  final AtlasStore store;
  final String tripId;

  const TripDetailScreen({
    super.key,
    required this.store,
    required this.tripId,
  });

  static const _legIcons = {
    'flight': Icons.flight_rounded,
    'drive': Icons.directions_car_rounded,
    'train': Icons.train_rounded,
    'boat': Icons.directions_boat_rounded,
  };

  Future<void> _edit(BuildContext context, AtlasTrip trip) async {
    final result = await Navigator.of(context).push<TripSaveResult>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => AddTripFlow(store: store, existing: trip),
      ),
    );
    if (result != null && context.mounted) {
      handleTripSaved(context, store, result);
    }
  }

  Future<void> _delete(BuildContext context, AtlasTrip trip) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete this trip?'),
        content: Text('"${trip.title}" will be removed from your map.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: AppColors.danger),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    Navigator.of(context).pop();
    try {
      await store.deleteTrip(trip.tripId);
    } catch (e) {
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            'Could not delete: ${e is ApiException ? e.message : e}',
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: store,
      builder: (context, _) {
        final trip = store.tripById(tripId);
        if (trip == null) {
          return Scaffold(
            appBar: AppBar(),
            body: const Center(child: Text('This trip is gone.')),
          );
        }
        final circles = [
          for (final id in trip.circleIds) ?store.circleById(id),
        ];
        final hue = circles.isEmpty
            ? AppColors.accent
            : circleHue(circles.first.color);
        final people = [
          for (final p in store.people)
            if (trip.personIds.contains(p.personId)) p,
        ];
        final days = tripDays(
          start: trip.start,
          end: trip.end,
          datePrecision: trip.datePrecision,
        );
        final pending = trip.tripId.startsWith('tmp_');

        return Scaffold(
          body: CustomScrollView(
            slivers: [
              SliverAppBar(
                pinned: true,
                expandedHeight: trip.coverUrl != null ? 260 : null,
                actions: [
                  IconButton(
                    tooltip: 'Edit',
                    icon: const Icon(Icons.edit_outlined),
                    onPressed: pending ? null : () => _edit(context, trip),
                  ),
                  IconButton(
                    tooltip: 'Delete',
                    icon: const Icon(Icons.delete_outline_rounded),
                    onPressed: pending ? null : () => _delete(context, trip),
                  ),
                ],
                flexibleSpace: trip.coverUrl == null
                    ? null
                    : FlexibleSpaceBar(
                        background: Stack(
                          fit: StackFit.expand,
                          children: [
                            Image.network(
                              trip.coverUrl!,
                              fit: BoxFit.cover,
                              errorBuilder: (_, _, _) =>
                                  ColoredBox(color: hue.withValues(alpha: 0.2)),
                            ),
                            const DecoratedBox(
                              decoration: BoxDecoration(
                                gradient: LinearGradient(
                                  begin: Alignment.topCenter,
                                  end: Alignment.bottomCenter,
                                  colors: [
                                    Colors.black38,
                                    Colors.transparent,
                                    AppColors.scaffold,
                                  ],
                                  stops: [0, 0.5, 1],
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
              ),
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
                sliver: SliverList.list(
                  children: [
                    Text(
                      trip.title,
                      style: Theme.of(context).textTheme.headlineMedium
                          ?.copyWith(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      [
                        formatTrip(trip),
                        if (days != null) '$days ${days == 1 ? 'day' : 'days'}',
                      ].join('  ·  '),
                      style: const TextStyle(
                        color: Colors.white60,
                        fontSize: 15,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        for (final c in circles)
                          Chip(
                            avatar: CircleDot(color: circleHue(c.color)),
                            label: Text(c.name),
                            visualDensity: VisualDensity.compact,
                          ),
                        for (final p in people)
                          Chip(
                            avatar: const Icon(Icons.person_rounded, size: 16),
                            label: Text(p.name),
                            visualDensity: VisualDensity.compact,
                          ),
                        if (trip.rating != null)
                          StarRating(value: trip.rating, size: 18),
                      ],
                    ),
                    const SizedBox(height: 18),
                    TripRouteMap(trip: trip, color: hue),
                    if (trip.stops.isNotEmpty) ...[
                      const SizedBox(height: 22),
                      Text('STOPS', style: kEyebrow),
                      const SizedBox(height: 6),
                      for (var i = 0; i < trip.stops.length; i++)
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: CircleAvatar(
                            radius: 14,
                            backgroundColor: hue,
                            child: Text(
                              '${i + 1}',
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                color: AtlasPalette.ocean,
                              ),
                            ),
                          ),
                          title: Text(trip.stops[i].place.name),
                          subtitle: Text(_where(trip.stops[i].place)),
                          trailing: Icon(
                            placeKindIcon(trip.stops[i].place.kind),
                            size: 18,
                            color: Colors.white38,
                          ),
                        ),
                    ],
                    if (trip.legs.isNotEmpty) ...[
                      const SizedBox(height: 18),
                      Text('TRAVEL', style: kEyebrow),
                      const SizedBox(height: 6),
                      for (final leg in trip.legs)
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: Icon(
                            _legIcons[leg.mode] ?? Icons.route_rounded,
                            color: hue,
                          ),
                          title: Text(
                            '${leg.from.shortLabel}  →  ${leg.to.shortLabel}',
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          subtitle: Text(
                            [
                              if (leg.airline != null) leg.airline!,
                              if (leg.flightNumber != null) leg.flightNumber!,
                              '${formatCount(greatCircleMiles(leg.from, leg.to).round())} mi',
                            ].join(' · '),
                          ),
                        ),
                    ],
                    if (trip.notes != null && trip.notes!.isNotEmpty) ...[
                      const SizedBox(height: 18),
                      Text('NOTES', style: kEyebrow),
                      const SizedBox(height: 8),
                      Text(
                        trip.notes!,
                        style: const TextStyle(fontSize: 15, height: 1.45),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  String _where(AtlasPlace p) => [
    if (p.locality != null && p.locality != p.name) p.locality!,
    if (p.regionCode != null && p.regionCode!.startsWith('US-'))
      regionName(p.regionCode!),
    countryName(p.countryCode),
  ].join(', ');
}
