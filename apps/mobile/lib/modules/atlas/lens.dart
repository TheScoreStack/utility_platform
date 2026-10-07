// Lens + stats rules ported from packages/shared/src/atlas.ts. Keep the
// semantics identical: test/atlas_lens_test.dart checks this file against
// the shared fixtures in packages/shared/fixtures/atlas/.

import 'dart:math' as math;

import 'atlas_geo_data.dart';
import 'models/atlas_models.dart';

const double _earthRadiusMi = 3958.8;
const int earthCircumferenceMi = 24901;
const double miPerKm = 0.621371;

/// Approximates JS `localeCompare` for plain titles/codes: case-insensitive
/// first, then code-unit order as a tiebreak.
int localeCompare(String a, String b) {
  final ci = a.toLowerCase().compareTo(b.toLowerCase());
  return ci != 0 ? ci : a.compareTo(b);
}

int? tripYear(AtlasTrip trip) =>
    int.tryParse(trip.start.length >= 4 ? trip.start.substring(0, 4) : '');

bool tripMatchesLens(AtlasTrip trip, AtlasLens lens) {
  if (lens.circle != 'all' && !trip.circleIds.contains(lens.circle)) {
    return false;
  }
  final year = tripYear(trip);
  if (year != null) {
    if (lens.fromYear != null && year < lens.fromYear!) return false;
    if (lens.toYear != null && year > lens.toYear!) return false;
  }
  if (lens.mode == 'flights' && !trip.legs.any((l) => l.mode == 'flight')) {
    return false;
  }
  return true;
}

/// Newest first; trips with the same start keep title order.
List<AtlasTrip> sortTrips(Iterable<AtlasTrip> trips) {
  final list = [...trips];
  list.sort((a, b) {
    final byStart = localeCompare(b.start, a.start);
    return byStart != 0 ? byStart : localeCompare(a.title, b.title);
  });
  return list;
}

List<AtlasTrip> applyLens(List<AtlasTrip> trips, AtlasLens lens) =>
    sortTrips(trips.where((t) => tripMatchesLens(t, lens)));

// ------------------------------------------------------------------ geography

double greatCircleMiles(AtlasPlace a, AtlasPlace b) =>
    greatCircleMilesLatLng(a.lat, a.lng, b.lat, b.lng);

double greatCircleMilesLatLng(
  double aLat,
  double aLng,
  double bLat,
  double bLng,
) {
  double rad(double d) => d * math.pi / 180;
  final dLat = rad(bLat - aLat);
  final dLng = rad(bLng - aLng);
  final h =
      math.pow(math.sin(dLat / 2), 2) +
      math.cos(rad(aLat)) *
          math.cos(rad(bLat)) *
          math.pow(math.sin(dLng / 2), 2);
  return 2 * _earthRadiusMi * math.asin(math.min(1, math.sqrt(h)));
}

String? continentOf(String countryCode) =>
    atlasCountries[countryCode.toUpperCase()]?.continent;

String countryName(String countryCode) =>
    atlasCountries[countryCode.toUpperCase()]?.name ?? countryCode;

/// "US-CA" -> "California"; other regions fall back to the code.
String regionName(String regionCode) {
  final parts = regionCode.split('-');
  if (parts.length > 1 && parts[0] == 'US') {
    final name = atlasUsStates[parts[1]];
    if (name != null) return name;
  }
  return regionCode;
}

/// Every place a trip touched: its stops plus both ends of every leg.
List<AtlasPlace> tripPlaces(AtlasTrip trip) => [
  for (final s in trip.stops) s.place,
  for (final l in trip.legs) ...[l.from, l.to],
];

String? _cityKey(AtlasPlace p) {
  if (p.kind == 'country' || p.kind == 'region') return null;
  final locality = p.locality;
  final city = ((locality != null && locality.isNotEmpty) ? locality : p.name)
      .trim()
      .toLowerCase();
  return city.isEmpty ? null : '${p.countryCode}|$city';
}

// ------------------------------------------------------------------ stats

class AtlasRouteStat {
  final String route;
  final int count;
  const AtlasRouteStat(this.route, this.count);
}

class AtlasAirlineStat {
  final String airline;
  final int count;
  const AtlasAirlineStat(this.airline, this.count);
}

class AtlasStats {
  final int trips;
  final int countries;
  final int usStates;
  final int cities;
  final int continents;
  final Map<String, int> countryVisits;
  final Map<String, int> regionVisits;
  final int flights;
  final int flightMiles;
  final int airports;
  final AtlasRouteStat? topRoute;
  final AtlasAirlineStat? topAirline;
  final int? firstYear;
  final int? lastYear;

  /// Set of continent codes touched (handy for the stats screen).
  final Set<String> continentCodes;

  const AtlasStats({
    required this.trips,
    required this.countries,
    required this.usStates,
    required this.cities,
    required this.continents,
    required this.countryVisits,
    required this.regionVisits,
    required this.flights,
    required this.flightMiles,
    required this.airports,
    this.topRoute,
    this.topAirline,
    this.firstYear,
    this.lastYear,
    this.continentCodes = const {},
  });

  static const empty = AtlasStats(
    trips: 0,
    countries: 0,
    usStates: 0,
    cities: 0,
    continents: 0,
    countryVisits: {},
    regionVisits: {},
    flights: 0,
    flightMiles: 0,
    airports: 0,
  );
}

MapEntry<String, int>? _top(Map<String, int> counts) {
  if (counts.isEmpty) return null;
  final entries = counts.entries.toList()
    ..sort((x, y) {
      final byCount = y.value - x.value;
      return byCount != 0 ? byCount : localeCompare(x.key, y.key);
    });
  return entries.first;
}

/// Stats for an already-filtered set of trips (see [applyLens]). Counts are
/// per trip: a country visited on three trips has countryVisits 3.
AtlasStats computeStats(List<AtlasTrip> trips) {
  final countryVisits = <String, int>{};
  final regionVisits = <String, int>{};
  final cities = <String>{};
  final continents = <String>{};
  final airports = <String>{};
  final routes = <String, int>{};
  final airlines = <String, int>{};
  var flights = 0;
  var flightMiles = 0.0;
  int? firstYear;
  int? lastYear;

  for (final trip in trips) {
    final year = tripYear(trip);
    if (year != null) {
      firstYear = firstYear == null ? year : math.min(firstYear, year);
      lastYear = lastYear == null ? year : math.max(lastYear, year);
    }
    final tripCountries = <String>{};
    final tripRegions = <String>{};
    for (final place in tripPlaces(trip)) {
      if (place.countryCode.isEmpty) continue;
      tripCountries.add(place.countryCode);
      final region = place.regionCode;
      if (region != null && region.isNotEmpty) tripRegions.add(region);
      final key = _cityKey(place);
      if (key != null) cities.add(key);
      final continent = continentOf(place.countryCode);
      if (continent != null) continents.add(continent);
    }
    for (final c in tripCountries) {
      countryVisits[c] = (countryVisits[c] ?? 0) + 1;
    }
    for (final r in tripRegions) {
      regionVisits[r] = (regionVisits[r] ?? 0) + 1;
    }

    for (final leg in trip.legs) {
      if (leg.mode != 'flight') continue;
      flights += 1;
      flightMiles += greatCircleMiles(leg.from, leg.to);
      final a = leg.from.iata ?? leg.from.name;
      final b = leg.to.iata ?? leg.to.name;
      if (leg.from.iata != null) airports.add(leg.from.iata!);
      if (leg.to.iata != null) airports.add(leg.to.iata!);
      final pair = [a, b]..sort();
      final route = pair.join('-');
      routes[route] = (routes[route] ?? 0) + 1;
      final airline = leg.airline;
      if (airline != null && airline.isNotEmpty) {
        airlines[airline] = (airlines[airline] ?? 0) + 1;
      }
    }
  }

  final topRoute = _top(routes);
  final topAirline = _top(airlines);

  return AtlasStats(
    trips: trips.length,
    countries: countryVisits.length,
    usStates: regionVisits.keys.where((r) => r.startsWith('US-')).length,
    cities: cities.length,
    continents: continents.length,
    countryVisits: countryVisits,
    regionVisits: regionVisits,
    flights: flights,
    flightMiles: flightMiles.round(),
    airports: airports.length,
    topRoute: topRoute == null
        ? null
        : AtlasRouteStat(topRoute.key, topRoute.value),
    topAirline: topAirline == null
        ? null
        : AtlasAirlineStat(topAirline.key, topAirline.value),
    firstYear: firstYear,
    lastYear: lastYear,
    continentCodes: continents,
  );
}

/// Trips per circle id (a trip in two circles counts for both).
Map<String, int> tripsByCircle(List<AtlasTrip> trips) {
  final counts = <String, int>{};
  for (final trip in trips) {
    for (final id in trip.circleIds) {
      counts[id] = (counts[id] ?? 0) + 1;
    }
  }
  return counts;
}

class AtlasFirsts {
  final List<String> countries;
  final List<String> regions;
  const AtlasFirsts({this.countries = const [], this.regions = const []});

  bool get isEmpty => countries.isEmpty && regions.isEmpty;
}

/// Places this trip visits for the first time, given every other trip.
AtlasFirsts firstsForTrip(AtlasTrip trip, List<AtlasTrip> others) {
  final seenCountries = <String>{};
  final seenRegions = <String>{};
  for (final other in others) {
    if (other.tripId == trip.tripId) continue;
    for (final p in tripPlaces(other)) {
      seenCountries.add(p.countryCode);
      if (p.regionCode != null && p.regionCode!.isNotEmpty) {
        seenRegions.add(p.regionCode!);
      }
    }
  }
  final countries = <String>{};
  final regions = <String>{};
  for (final p in tripPlaces(trip)) {
    if (!seenCountries.contains(p.countryCode)) countries.add(p.countryCode);
    final r = p.regionCode;
    if (r != null && r.isNotEmpty && !seenRegions.contains(r)) regions.add(r);
  }
  return AtlasFirsts(countries: [...countries], regions: [...regions]);
}

// ------------------------------------------------------------------ dates

const List<String> atlasMonths = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', //
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

String? _monthName(String? m) {
  if (m == null) return null;
  final n = int.tryParse(m);
  if (n == null || n < 1 || n > 12) return null;
  return atlasMonths[n - 1];
}

String _day(String? d) => d == null ? '' : '${int.tryParse(d) ?? d}';

/// "2025-06-12".."2025-06-15" -> "Jun 12 to 15, 2025"; "2018-07" -> "Jul 2018".
String formatTripDates({
  required String start,
  String? end,
  required String datePrecision,
}) {
  final parts = start.split('-');
  final y = parts[0];
  final m = parts.length > 1 ? parts[1] : null;
  final d = parts.length > 2 ? parts[2] : null;
  final month = _monthName(m);
  if (datePrecision == 'year' || month == null) return y;
  if (datePrecision == 'month' || d == null) return '$month $y';
  final startDay = _day(d);
  if (end == null || end.isEmpty || end == start) return '$month $startDay, $y';
  final eParts = end.split('-');
  final ey = eParts[0];
  final em = eParts.length > 1 ? eParts[1] : null;
  final ed = eParts.length > 2 ? eParts[2] : null;
  final endMonth = _monthName(em) ?? month;
  if (ey != y) return '$month $startDay, $y to $endMonth ${_day(ed)}, $ey';
  if (em != m) return '$month $startDay to $endMonth ${_day(ed)}, $y';
  return '$month $startDay to ${_day(ed)}, $y';
}

String formatTrip(AtlasTrip t) =>
    formatTripDates(start: t.start, end: t.end, datePrecision: t.datePrecision);

/// Inclusive day count for day-precision trips, else null.
int? tripDays({
  required String start,
  String? end,
  required String datePrecision,
}) {
  if (datePrecision != 'day' || start.length != 10) return null;
  final e = end != null && end.length == 10 ? end : start;
  final a = DateTime.tryParse('${start}T00:00:00Z');
  final b = DateTime.tryParse('${e}T00:00:00Z');
  if (a == null || b == null) return null;
  return (b.difference(a).inMilliseconds / 86400000).round() + 1;
}

// ------------------------------------------------------------------ quick picks

/// Identity for quick picks and return legs: IATA code, else provider id.
String placeKey(AtlasPlace p) => p.iata ?? p.providerId;

/// Same place, by [placeKey].
bool samePlace(AtlasPlace a, AtlasPlace b) => placeKey(a) == placeKey(b);

/// Places you've used most, for one-tap picks: airports from flight legs, or
/// stop places (no airports). Ranked by how many trips include the place,
/// then by the most recent of those trips, then by name; capped at [limit].
/// Mirrors `frequentPlaces` in packages/shared/src/atlas.ts.
List<AtlasPlace> frequentPlaces(
  List<AtlasTrip> trips, {
  required bool airports,
  int limit = 6,
}) {
  final seen = <String, ({AtlasPlace place, int trips, String latest})>{};
  for (final trip in trips) {
    final places = airports
        ? [
            for (final l in trip.legs.where((l) => l.mode == 'flight'))
              for (final p in [l.from, l.to])
                if (p.iata != null) p,
          ]
        : [
            for (final s in trip.stops)
              if (s.place.kind != 'airport') s.place,
          ];
    final inTrip = <String>{};
    for (final place in places) {
      final key = placeKey(place);
      if (!inTrip.add(key)) continue;
      final entry = seen[key];
      seen[key] = entry == null
          ? (place: place, trips: 1, latest: trip.start)
          : (
              place: entry.place,
              trips: entry.trips + 1,
              latest: trip.start.compareTo(entry.latest) > 0
                  ? trip.start
                  : entry.latest,
            );
    }
  }
  // Index tiebreak keeps the sort stable, like Array.prototype.sort.
  final ranked = seen.values.indexed.toList()
    ..sort((a, b) {
      final x = a.$2, y = b.$2;
      if (x.trips != y.trips) return y.trips - x.trips;
      final recent = localeCompare(y.latest, x.latest);
      if (recent != 0) return recent;
      final name = localeCompare(x.place.name, y.place.name);
      return name != 0 ? name : a.$1 - b.$1;
    });
  return [for (final e in ranked.take(limit)) e.$2.place];
}
