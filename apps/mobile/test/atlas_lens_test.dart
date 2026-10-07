import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:platform_mobile/modules/atlas/equal_earth.dart';
import 'package:platform_mobile/modules/atlas/lens.dart';
import 'package:platform_mobile/modules/atlas/models/atlas_models.dart';

/// flutter test runs with cwd = apps/mobile.
const _fixtures = '../../packages/shared/fixtures/atlas';

Map<String, dynamic> _readJson(String name) =>
    jsonDecode(File('$_fixtures/$name').readAsStringSync())
        as Map<String, dynamic>;

void main() {
  final sample = _readJson('sample-atlas.json');
  final expected = _readJson('expected-stats.json');
  final trips = [
    for (final t in sample['trips'] as List)
      AtlasTrip.fromJson(t as Map<String, dynamic>),
  ];

  group('applyLens + computeStats match the shared fixtures', () {
    for (final entry in expected.entries) {
      test(entry.key, () {
        final spec = entry.value as Map<String, dynamic>;
        final lens = AtlasLens.fromJson(spec['lens'] as Map<String, dynamic>);
        final filtered = applyLens(trips, lens);
        expect(
          filtered.map((t) => t.tripId).toList(),
          (spec['tripIds'] as List).cast<String>(),
        );

        final want = spec['stats'] as Map<String, dynamic>;
        final got = computeStats(filtered);
        expect(got.trips, want['trips']);
        expect(got.countries, want['countries']);
        expect(got.usStates, want['usStates']);
        expect(got.cities, want['cities']);
        expect(got.continents, want['continents']);
        expect(
          got.countryVisits,
          (want['countryVisits'] as Map).cast<String, int>(),
        );
        expect(
          got.regionVisits,
          (want['regionVisits'] as Map).cast<String, int>(),
        );
        expect(got.flights, want['flights']);
        expect(got.flightMiles, want['flightMiles']);
        expect(got.airports, want['airports']);

        final topRoute = want['topRoute'] as Map<String, dynamic>?;
        expect(got.topRoute?.route, topRoute?['route']);
        expect(got.topRoute?.count, topRoute?['count']);
        final topAirline = want['topAirline'] as Map<String, dynamic>?;
        expect(got.topAirline?.airline, topAirline?['airline']);
        expect(got.topAirline?.count, topAirline?['count']);

        expect(got.firstYear, want['firstYear']);
        expect(got.lastYear, want['lastYear']);
      });
    }
  });

  test('tripsByCircle counts a trip once per circle', () {
    final counts = tripsByCircle(trips);
    expect(counts['circle_wife'], 2);
    expect(counts['solo'], 1);
  });

  test('firstsForTrip finds new countries and regions', () {
    final lisbon = trips.firstWhere((t) => t.tripId == 't_lis');
    final firsts = firstsForTrip(lisbon, trips);
    expect(firsts.countries, ['PT']);
    expect(firsts.regions, isEmpty);
  });

  test('formatTripDates mirrors the shared formatter', () {
    expect(
      formatTripDates(
        start: '2025-06-12',
        end: '2025-06-15',
        datePrecision: 'day',
      ),
      'Jun 12 to 15, 2025',
    );
    expect(
      formatTripDates(start: '2018-07', datePrecision: 'month'),
      'Jul 2018',
    );
    expect(formatTripDates(start: '2018', datePrecision: 'year'), '2018');
    expect(
      formatTripDates(
        start: '2024-12-30',
        end: '2025-01-02',
        datePrecision: 'day',
      ),
      'Dec 30, 2024 to Jan 2, 2025',
    );
    expect(
      formatTripDates(
        start: '2025-05-30',
        end: '2025-06-02',
        datePrecision: 'day',
      ),
      'May 30 to Jun 2, 2025',
    );
    expect(
      formatTripDates(start: '2025-06-12', datePrecision: 'day'),
      'Jun 12, 2025',
    );
  });

  test('tripDays is inclusive and day-precision only', () {
    expect(
      tripDays(start: '2025-06-12', end: '2025-06-15', datePrecision: 'day'),
      4,
    );
    expect(tripDays(start: '2025-06-12', datePrecision: 'day'), 1);
    expect(tripDays(start: '2025-06', datePrecision: 'month'), isNull);
  });

  test('greatCircleMiles SFO-JFK is about 2,580 miles', () {
    final miles = greatCircleMilesLatLng(37.619, -122.375, 40.6398, -73.7789);
    expect(miles, closeTo(2580, 10));
  });

  test('Equal Earth projection is symmetric and bounded', () {
    final origin = EqualEarth.project(0, 0);
    expect(origin.dx, closeTo(0, 1e-9));
    expect(origin.dy, closeTo(0, 1e-9));
    final east = EqualEarth.project(180, 0);
    final west = EqualEarth.project(-180, 0);
    expect(east.dx, closeTo(-west.dx, 1e-9));
    expect(east.dx, closeTo(EqualEarth.maxX, 1e-9));
    final north = EqualEarth.project(0, 90);
    expect(north.dy, closeTo(EqualEarth.maxY, 1e-9));
  });
}
