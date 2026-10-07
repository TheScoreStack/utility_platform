import 'package:flutter/material.dart';

import '../../../core/app_theme.dart';
import '../atlas_colors.dart';
import '../atlas_geo_data.dart';
import '../atlas_store.dart';
import '../lens.dart';
import '../widgets/atlas_widgets.dart';

/// Progress toward the whole world, trips by circle, and flight totals.
/// Follows the current lens (circle + year bounds).
class StatsScreen extends StatelessWidget {
  final AtlasStore store;

  const StatsScreen({super.key, required this.store});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: store,
      builder: (context, _) {
        final lens = store.lens;
        final hue = lensColor(lens, store.circles);
        // Footprint numbers ignore the flights-only filter.
        final footprintTrips = store.tripsForLens(
          lens.copyWith(mode: 'footprint'),
        );
        final stats = computeStats(footprintTrips);
        final byCircle = tripsByCircle(footprintTrips);
        final circleName = lens.circle == 'all'
            ? 'All trips'
            : store.circleById(lens.circle)?.name ?? 'Circle';
        final maxCircle = byCircle.values.fold<int>(1, (m, v) => v > m ? v : m);
        final years = stats.firstYear == null
            ? null
            : stats.firstYear == stats.lastYear
            ? '${stats.firstYear}'
            : '${stats.firstYear} – ${stats.lastYear}';

        return Scaffold(
          appBar: AppBar(title: const Text('Stats')),
          body: ListView(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 40),
            children: [
              Row(
                children: [
                  CircleDot(color: hue),
                  const SizedBox(width: 8),
                  Text(
                    circleName,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const Spacer(),
                  if (years != null)
                    Text(years, style: const TextStyle(color: Colors.white54)),
                ],
              ),
              const SizedBox(height: 16),
              _Progress(
                label: 'Countries',
                value: stats.countries,
                total: 195,
                color: hue,
              ),
              _Progress(
                label: 'US states',
                value: stats.usStates,
                total: 50,
                color: hue,
              ),
              _Progress(
                label: 'Continents',
                value: stats.continents,
                total: 7,
                color: hue,
              ),
              if (stats.continentCodes.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      for (final code in atlasContinents.keys)
                        Chip(
                          visualDensity: VisualDensity.compact,
                          label: Text(atlasContinents[code]!),
                          backgroundColor: stats.continentCodes.contains(code)
                              ? hue.withValues(alpha: 0.22)
                              : null,
                          side: BorderSide(
                            color: stats.continentCodes.contains(code)
                                ? hue
                                : Colors.white10,
                          ),
                        ),
                    ],
                  ),
                ),
              const SizedBox(height: 12),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      AtlasCounter(
                        label: 'Trips',
                        value: stats.trips,
                        color: hue,
                      ),
                      AtlasCounter(
                        label: 'Cities',
                        value: stats.cities,
                        color: hue,
                      ),
                      AtlasCounter(
                        label: 'Countries',
                        value: stats.countries,
                        color: hue,
                      ),
                    ],
                  ),
                ),
              ),
              if (lens.circle == 'all' && byCircle.isNotEmpty) ...[
                const SizedBox(height: 24),
                Text('TRIPS BY CIRCLE', style: kEyebrow),
                const SizedBox(height: 10),
                for (final c in store.circles)
                  if ((byCircle[c.circleId] ?? 0) > 0)
                    _Bar(
                      label: c.name,
                      value: byCircle[c.circleId]!,
                      fraction: byCircle[c.circleId]! / maxCircle,
                      color: circleHue(c.color),
                    ),
              ],
              const SizedBox(height: 24),
              Text('FLIGHTS', style: kEyebrow),
              const SizedBox(height: 10),
              _FlightsCard(stats: stats, color: hue),
            ],
          ),
        );
      },
    );
  }
}

class _Progress extends StatelessWidget {
  final String label;
  final int value;
  final int total;
  final Color color;

  const _Progress({
    required this.label,
    required this.value,
    required this.total,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final fraction = (value / total).clamp(0.0, 1.0);
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
              const Spacer(),
              Text(
                '$value of $total  ·  ${(fraction * 100).round()}%',
                style: const TextStyle(
                  color: Colors.white60,
                  fontFeatures: kTabularFigures,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: fraction),
            duration: reduceMotion(context)
                ? Duration.zero
                : const Duration(milliseconds: 800),
            curve: Curves.easeOutCubic,
            builder: (context, v, _) => ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                value: v,
                minHeight: 10,
                color: color,
                backgroundColor: Colors.white.withValues(alpha: 0.06),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Bar extends StatelessWidget {
  final String label;
  final int value;
  final double fraction;
  final Color color;

  const _Bar({
    required this.label,
    required this.value,
    required this.fraction,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          SizedBox(
            width: 96,
            child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
          Expanded(
            child: LayoutBuilder(
              builder: (context, c) => Align(
                alignment: Alignment.centerLeft,
                child: AnimatedContainer(
                  duration: reduceMotion(context)
                      ? Duration.zero
                      : const Duration(milliseconds: 500),
                  height: 14,
                  width: (c.maxWidth * fraction).clamp(6, c.maxWidth),
                  decoration: BoxDecoration(
                    color: color,
                    borderRadius: BorderRadius.circular(7),
                  ),
                ),
              ),
            ),
          ),
          SizedBox(
            width: 36,
            child: Text(
              '$value',
              textAlign: TextAlign.right,
              style: const TextStyle(fontFeatures: kTabularFigures),
            ),
          ),
        ],
      ),
    );
  }
}

class _FlightsCard extends StatelessWidget {
  final AtlasStats stats;
  final Color color;

  const _FlightsCard({required this.stats, required this.color});

  @override
  Widget build(BuildContext context) {
    if (stats.flights == 0) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(20),
          child: Text(
            'No flights logged in this lens yet.',
            style: TextStyle(color: Colors.white54),
          ),
        ),
      );
    }
    final laps = stats.flightMiles / earthCircumferenceMi;
    Widget row(String label, String value) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Text(label, style: const TextStyle(color: Colors.white60)),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                AtlasCounter(
                  label: 'Flights',
                  value: stats.flights,
                  color: color,
                ),
                AtlasCounter(
                  label: 'Miles',
                  value: stats.flightMiles,
                  color: color,
                ),
                AtlasCounter(
                  label: 'Airports',
                  value: stats.airports,
                  color: color,
                ),
              ],
            ),
            const SizedBox(height: 12),
            const Divider(),
            row(
              'Around the Earth',
              '${laps.toStringAsFixed(laps < 10 ? 2 : 1)}×',
            ),
            if (stats.topRoute != null)
              row(
                'Top route',
                '${stats.topRoute!.route.replaceAll('-', ' ⇄ ')}  ·  ${stats.topRoute!.count}×',
              ),
            if (stats.topAirline != null)
              row(
                'Top airline',
                '${stats.topAirline!.airline}  ·  ${stats.topAirline!.count}×',
              ),
          ],
        ),
      ),
    );
  }
}
