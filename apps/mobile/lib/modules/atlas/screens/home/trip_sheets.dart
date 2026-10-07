import 'package:flutter/material.dart';

import '../../../../core/app_theme.dart';
import '../../atlas_store.dart';
import '../../models/atlas_models.dart';
import '../../widgets/atlas_widgets.dart';

/// The draggable "Recent trips" sheet over the bottom of the map.
class RecentTripsSheet extends StatelessWidget {
  final AtlasStore store;
  final ValueChanged<AtlasTrip> onOpenTrip;

  const RecentTripsSheet({
    super.key,
    required this.store,
    required this.onOpenTrip,
  });

  @override
  Widget build(BuildContext context) {
    final trips = store.lensTrips;
    return DraggableScrollableSheet(
      initialChildSize: 0.22,
      minChildSize: 0.12,
      maxChildSize: 0.88,
      snap: true,
      snapSizes: const [0.22, 0.55],
      builder: (context, controller) => Material(
        color: const Color(0xFF141C33),
        elevation: 12,
        shadowColor: Colors.black,
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
          borderRadius: const BorderRadius.vertical(top: Radius.circular(22)),
          side: BorderSide(color: Colors.white.withValues(alpha: 0.08)),
        ),
        child: CustomScrollView(
          controller: controller,
          slivers: [
            SliverToBoxAdapter(
              child: Column(
                children: [
                  const SizedBox(height: 10),
                  Container(
                    width: 32,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.white24,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 14, 20, 6),
                    child: Row(
                      children: [
                        Text(
                          'RECENT TRIPS',
                          style: eyebrowStyle(Colors.white70),
                        ),
                        const Spacer(),
                        Text('${trips.length}', style: eyebrowStyle()),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            if (trips.isEmpty)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
                  child: Text(
                    store.lens.isFlights
                        ? 'No flights in this lens yet. Add one under Travel on a trip.'
                        : 'No trips here yet. Tap + to add your first.',
                    style: const TextStyle(color: Colors.white54),
                  ),
                ),
              )
            else
              SliverList.builder(
                itemCount: trips.length,
                itemBuilder: (context, i) => TripTile(
                  trip: trips[i],
                  store: store,
                  onTap: () => onOpenTrip(trips[i]),
                ),
              ),
            const SliverToBoxAdapter(child: SizedBox(height: 96)),
          ],
        ),
      ),
    );
  }
}

/// Bottom sheet listing the lens trips that touched a tapped country or
/// US state.
void showPlaceTripsSheet(
  BuildContext context, {
  required AtlasStore store,
  required String name,
  required List<AtlasTrip> matches,
  required ValueChanged<AtlasTrip> onOpenTrip,
}) {
  showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (sheetContext) => ConstrainedBox(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.6,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 4),
            child: Text(name, style: Theme.of(context).textTheme.headlineSmall),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
            child: Text(
              matches.isEmpty
                  ? 'Not yet. Someday?'
                  : '${matches.length} ${matches.length == 1 ? 'trip' : 'trips'}',
              style: const TextStyle(color: Colors.white54),
            ),
          ),
          Flexible(
            child: ListView(
              shrinkWrap: true,
              children: [
                for (final t in matches)
                  TripTile(
                    trip: t,
                    store: store,
                    onTap: () {
                      Navigator.of(sheetContext).pop();
                      onOpenTrip(t);
                    },
                  ),
                const SizedBox(height: 16),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}
