import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/app_theme.dart';
import '../../atlas_colors.dart';
import '../../atlas_store.dart';
import '../../lens.dart';
import '../../models/atlas_models.dart';
import '../../widgets/atlas_widgets.dart';

/// Footprint / Flights toggle plus the Wishlist overlay chip.
class AtlasModeRow extends StatelessWidget {
  final AtlasStore store;
  final ValueChanged<AtlasLens> onLens;

  const AtlasModeRow({super.key, required this.store, required this.onLens});

  @override
  Widget build(BuildContext context) {
    final lens = store.lens;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      child: Row(
        children: [
          Expanded(
            child: SegmentedButton<String>(
              showSelectedIcon: false,
              style: const ButtonStyle(
                visualDensity: VisualDensity.compact,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              segments: const [
                ButtonSegment(
                  value: 'footprint',
                  label: Text('Footprint'),
                  icon: Icon(Icons.public_rounded, size: 18),
                ),
                ButtonSegment(
                  value: 'flights',
                  label: Text('Flights'),
                  icon: Icon(Icons.flight_rounded, size: 18),
                ),
              ],
              selected: {lens.mode},
              onSelectionChanged: (s) => onLens(lens.copyWith(mode: s.first)),
            ),
          ),
          const SizedBox(width: 8),
          // An overlay toggle, so its label stays put and only its state
          // changes: on = dashed wishlist pins drawn over the footprint.
          FilterChip(
            label: const Text('Wishlist'),
            avatar: Icon(
              store.showWishes
                  ? Icons.bookmark_rounded
                  : Icons.bookmark_border_rounded,
              size: 16,
            ),
            tooltip: store.showWishes ? 'Hide wishlist' : 'Show wishlist',
            selected: store.showWishes,
            showCheckmark: false,
            onSelected: (v) {
              HapticFeedback.selectionClick();
              store.setShowWishes(v);
            },
          ),
        ],
      ),
    );
  }
}

/// The rolling counters under the toggle; which ones depends on the mode.
class AtlasCountersRow extends StatelessWidget {
  final AtlasLens lens;
  final AtlasStats stats;
  final Color hue;

  const AtlasCountersRow({
    super.key,
    required this.lens,
    required this.stats,
    required this.hue,
  });

  @override
  Widget build(BuildContext context) {
    final items = lens.isFlights
        ? [
            ('Flights', stats.flights),
            ('Miles', stats.flightMiles),
            ('Airports', stats.airports),
          ]
        : [
            ('Countries', stats.countries),
            ('States', stats.usStates),
            ('Cities', stats.cities),
            ('Trips', stats.trips),
          ];
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 10),
      child: AnimatedSwitcher(
        duration: reduceMotion(context)
            ? Duration.zero
            : const Duration(milliseconds: 250),
        child: Row(
          key: ValueKey(lens.mode),
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            for (final (label, value) in items)
              AtlasCounter(label: label, value: value, color: hue),
          ],
        ),
      ),
    );
  }
}

/// Horizontal All / per-circle chips that re-tint the map.
class AtlasCircleChipRow extends StatelessWidget {
  final AtlasLens lens;
  final List<AtlasCircle> circles;
  final ValueChanged<AtlasLens> onLens;

  const AtlasCircleChipRow({
    super.key,
    required this.lens,
    required this.circles,
    required this.onLens,
  });

  @override
  Widget build(BuildContext context) {
    Widget chip(String id, String label, Color color) {
      final selected = lens.circle == id;
      return Padding(
        padding: const EdgeInsets.only(right: 8),
        child: ChoiceChip(
          selected: selected,
          showCheckmark: false,
          avatar: CircleDot(color: color),
          label: Text(label),
          selectedColor: color.withValues(alpha: 0.22),
          side: BorderSide(
            color: selected ? color : Colors.white.withValues(alpha: 0.12),
          ),
          onSelected: (_) => onLens(lens.copyWith(circle: id)),
        ),
      );
    }

    // Fade the right edge so a clipped chip reads as "scroll for more".
    return SizedBox(
      height: 44,
      child: ShaderMask(
        blendMode: BlendMode.dstIn,
        shaderCallback: (rect) => const LinearGradient(
          colors: [Colors.white, Colors.white, Colors.transparent],
          stops: [0, 0.88, 1],
        ).createShader(rect),
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.fromLTRB(16, 0, 40, 0),
          children: [
            chip('all', 'All', AppColors.accent),
            for (final c in circles)
              chip(c.circleId, c.name, circleHue(c.color)),
          ],
        ),
      ),
    );
  }
}
