import 'package:flutter/material.dart';

import '../../atlas_colors.dart';
import '../../atlas_store.dart';
import '../../map/atlas_map.dart';

/// Fills, pins and arcs for the home map under the store's current lens.
/// Pure; the home screen caches the result per snapshot + lens.
AtlasMapData buildAtlasMapData(AtlasStore store) {
  final lens = store.lens;
  final hue = lensColor(lens, store.circles);
  final trips = store.lensTrips;
  final stats = store.stats;
  final wishes = !store.showWishes
      ? const <MapPin>[]
      : [
          for (final w in store.lensWishes)
            MapPin(w.place.lat, w.place.lng, hue),
        ];

  if (lens.isFlights) {
    final arcs = <MapArc>[];
    final airports = <String, MapPin>{};
    for (final t in trips) {
      for (final l in t.legs.where((l) => l.isFlight)) {
        arcs.add(MapArc(l.from.lat, l.from.lng, l.to.lat, l.to.lng, hue));
        for (final p in [l.from, l.to]) {
          airports[p.iata ?? p.providerId] = MapPin(p.lat, p.lng, Colors.white);
        }
      }
    }
    return AtlasMapData(
      arcs: arcs,
      airports: airports.values.toList(),
      wishes: wishes,
    );
  }

  final countryFills = {
    for (final e in stats.countryVisits.entries) e.key: visitFill(hue, e.value),
  };
  final home = store.profile.homePlace?.countryCode;
  if (home != null && lens.circle == 'all') {
    countryFills.putIfAbsent(home, () => visitFill(hue, 1));
  }
  final regionFills = {
    for (final e in stats.regionVisits.entries)
      if (e.key.startsWith('US-')) e.key: visitFill(hue, e.value),
  };
  final pins = <String, MapPin>{};
  for (final t in trips) {
    for (final s in t.stops) {
      final p = s.place;
      if (p.kind == 'country' || p.kind == 'region') continue;
      pins['${p.countryCode}|${(p.locality ?? p.name).toLowerCase()}'] = MapPin(
        p.lat,
        p.lng,
        hue,
      );
    }
  }
  return AtlasMapData(
    countryFills: countryFills,
    regionFills: regionFills,
    drawUsStates: regionFills.isNotEmpty,
    pins: pins.values.toList(),
    wishes: wishes,
  );
}
