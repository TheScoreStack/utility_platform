import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

import 'atlas_api.dart';
import 'lens.dart';
import 'models/atlas_models.dart';
import 'models/trip_draft.dart';

/// Holds the Atlas snapshot for every Atlas screen. The snapshot is cached
/// as JSON in the documents directory so the map opens instantly (offline
/// too) and refreshes in the background. Mutations are optimistic: the local
/// snapshot changes first and rolls back if the API rejects the write.
class AtlasStore extends ChangeNotifier {
  final AtlasApi api;

  AtlasStore(this.api);

  AtlasSnapshot? _snapshot;
  AtlasLens _lens = const AtlasLens();
  bool _refreshing = false;
  bool _showWishes = false;
  String? _error;
  int _tmpSeq = 0;
  Timer? _lensSave;

  AtlasSnapshot? get snapshot => _snapshot;
  bool get hasData => _snapshot != null;
  bool get refreshing => _refreshing;
  String? get error => _error;
  AtlasLens get lens => _lens;
  bool get showWishes => _showWishes;

  List<AtlasTrip> get trips => _snapshot?.trips ?? const [];
  List<AtlasWish> get wishes => _snapshot?.wishes ?? const [];
  List<AtlasPerson> get people => _snapshot?.people ?? const [];
  AtlasProfile get profile => _snapshot?.profile ?? const AtlasProfile();

  /// Circles in display order; Solo always last.
  List<AtlasCircle> get circles {
    final list = [...?_snapshot?.circles];
    list.sort((a, b) {
      if (a.builtIn != b.builtIn) return a.builtIn ? 1 : -1;
      final byOrder = a.sortOrder.compareTo(b.sortOrder);
      return byOrder != 0 ? byOrder : localeCompare(a.name, b.name);
    });
    return list;
  }

  AtlasCircle? circleById(String id) {
    for (final c in _snapshot?.circles ?? const <AtlasCircle>[]) {
      if (c.circleId == id) return c;
    }
    return null;
  }

  AtlasTrip? tripById(String id) {
    for (final t in trips) {
      if (t.tripId == id) return t;
    }
    return null;
  }

  // ---------------------------------------------------------------- derived

  List<AtlasTrip>? _lensTripsCache;
  AtlasStats? _statsCache;

  List<AtlasTrip> get lensTrips => _lensTripsCache ??= applyLens(trips, _lens);
  AtlasStats get stats => _statsCache ??= computeStats(lensTrips);

  /// Footprint stats for the current circle, regardless of mode — the map
  /// still needs country fills while in Flights mode for hit-testing.
  List<AtlasTrip> tripsForLens(AtlasLens lens) => applyLens(trips, lens);

  List<AtlasWish> get lensWishes => [
    for (final w in wishes)
      if (!w.fulfilled &&
          (_lens.circle == 'all' || w.circleIds.contains(_lens.circle)))
        w,
  ];

  void _invalidate() {
    _lensTripsCache = null;
    _statsCache = null;
  }

  void _set(AtlasSnapshot snapshot) {
    _snapshot = snapshot.copyWith(trips: sortTrips(snapshot.trips));
    _invalidate();
    notifyListeners();
    unawaited(_persist());
  }

  // ---------------------------------------------------------------- load

  Future<File?> _cacheFile() async {
    try {
      final dir = await getApplicationDocumentsDirectory();
      return File('${dir.path}/atlas_snapshot.json');
    } catch (_) {
      return null;
    }
  }

  Future<void> _persist() async {
    final snap = _snapshot;
    if (snap == null) return;
    try {
      final file = await _cacheFile();
      await file?.writeAsString(jsonEncode(snap.toJson()));
    } catch (_) {
      // Cache is best-effort.
    }
  }

  /// Loads the cached snapshot (instant), then refreshes from the API.
  Future<void> load() async {
    if (_snapshot == null) {
      try {
        final file = await _cacheFile();
        if (file != null && await file.exists()) {
          final json = jsonDecode(await file.readAsString());
          final snap = AtlasSnapshot.fromJson(json as Map<String, dynamic>);
          _snapshot = snap;
          _lens = snap.profile.lastLens ?? _lens;
          _invalidate();
          notifyListeners();
        }
      } catch (_) {
        // Corrupt cache: ignore and fetch.
      }
    }
    await refresh();
  }

  Future<void> refresh() async {
    _refreshing = true;
    _error = null;
    notifyListeners();
    try {
      final snap = await api.getSnapshot();
      final firstLoad = _snapshot == null;
      if (firstLoad && snap.profile.lastLens != null) {
        _lens = snap.profile.lastLens!;
      }
      if (_lens.circle != 'all' &&
          !snap.circles.any((c) => c.circleId == _lens.circle)) {
        _lens = _lens.copyWith(circle: 'all');
      }
      _refreshing = false;
      _set(snap);
    } catch (e) {
      _refreshing = false;
      _error = e.toString();
      notifyListeners();
    }
  }

  // ---------------------------------------------------------------- lens

  void setLens(AtlasLens lens) {
    if (lens == _lens) return;
    _lens = lens;
    _invalidate();
    notifyListeners();
    final snap = _snapshot;
    if (snap != null) {
      _snapshot = snap.copyWith(profile: snap.profile.copyWith(lastLens: lens));
      unawaited(_persist());
    }
    _lensSave?.cancel();
    _lensSave = Timer(const Duration(seconds: 2), () {
      api.updateProfile({'lastLens': lens.toJson()}).ignore();
    });
  }

  void setShowWishes(bool value) {
    if (value == _showWishes) return;
    _showWishes = value;
    notifyListeners();
  }

  @override
  void dispose() {
    _lensSave?.cancel();
    super.dispose();
  }

  // ---------------------------------------------------------------- helpers

  String _tmpId(String prefix) => 'tmp_${prefix}_${_tmpSeq++}';

  Future<T> _optimistic<T>(
    AtlasSnapshot Function(AtlasSnapshot s) apply,
    Future<T> Function() call,
    AtlasSnapshot Function(AtlasSnapshot s, T result)? reconcile,
  ) async {
    final before = _snapshot ?? const AtlasSnapshot();
    _set(apply(before));
    try {
      final result = await call();
      if (reconcile != null) _set(reconcile(_snapshot ?? before, result));
      return result;
    } catch (e) {
      _set(before);
      rethrow;
    }
  }

  static List<T> _replace<T>(List<T> list, bool Function(T) match, T value) => [
    for (final x in list) match(x) ? value : x,
  ];

  // ---------------------------------------------------------------- trips

  /// Creates or updates a trip. Returns the saved trip from the server.
  Future<AtlasTrip> saveTrip(TripDraft draft, {AtlasTrip? existing}) {
    if (existing == null) {
      final tmpId = _tmpId('trip');
      final local = draft.toTrip(tripId: tmpId);
      return _optimistic<AtlasTrip>(
        (s) => s.copyWith(trips: [local, ...s.trips]),
        () => api.createTrip(draft.toBody()),
        (s, saved) => s.copyWith(
          trips: _replace(s.trips, (t) => t.tripId == tmpId, saved),
        ),
      );
    }
    final local = draft.toTrip(tripId: existing.tripId, base: existing);
    return _optimistic<AtlasTrip>(
      (s) => s.copyWith(
        trips: _replace(s.trips, (t) => t.tripId == existing.tripId, local),
      ),
      () => api.updateTrip(existing.tripId, draft.toBody(forPatch: true)),
      (s, saved) => s.copyWith(
        trips: _replace(s.trips, (t) => t.tripId == existing.tripId, saved),
      ),
    );
  }

  Future<void> deleteTrip(String tripId) => _optimistic<void>(
    (s) => s.copyWith(
      trips: [...s.trips.where((t) => t.tripId != tripId)],
      wishes: [
        for (final w in s.wishes)
          w.fulfilledByTripId == tripId
              ? AtlasWish(
                  wishId: w.wishId,
                  place: w.place,
                  circleIds: w.circleIds,
                  note: w.note,
                  createdAt: w.createdAt,
                )
              : w,
      ],
    ),
    () => api.deleteTrip(tripId),
    null,
  );

  // ---------------------------------------------------------------- circles

  Future<AtlasCircle> createCircle(String name, String color) {
    final tmpId = _tmpId('circle');
    final maxOrder = circles
        .where((c) => !c.builtIn)
        .fold<int>(-1, (m, c) => c.sortOrder > m ? c.sortOrder : m);
    final local = AtlasCircle(
      circleId: tmpId,
      name: name,
      color: color,
      sortOrder: maxOrder + 1,
    );
    return _optimistic<AtlasCircle>(
      (s) => s.copyWith(circles: [...s.circles, local]),
      () => api.createCircle(name: name, color: color),
      (s, saved) => s.copyWith(
        circles: _replace(s.circles, (c) => c.circleId == tmpId, saved),
      ),
    );
  }

  Future<AtlasCircle> updateCircle(
    AtlasCircle circle, {
    String? name,
    String? color,
  }) {
    final local = circle.copyWith(name: name, color: color);
    return _optimistic<AtlasCircle>(
      (s) => s.copyWith(
        circles: _replace(
          s.circles,
          (c) => c.circleId == circle.circleId,
          local,
        ),
      ),
      () => api.updateCircle(circle.circleId, name: name, color: color),
      (s, saved) => s.copyWith(
        circles: _replace(
          s.circles,
          (c) => c.circleId == circle.circleId,
          saved,
        ),
      ),
    );
  }

  Future<void> deleteCircle(String circleId) {
    if (_lens.circle == circleId) setLens(_lens.copyWith(circle: 'all'));
    List<String> strip(List<String> ids) => [
      ...ids.where((id) => id != circleId),
    ];
    return _optimistic<void>(
      (s) => s.copyWith(
        circles: [...s.circles.where((c) => c.circleId != circleId)],
        trips: [
          for (final t in s.trips)
            t.circleIds.contains(circleId)
                ? AtlasTrip.fromJson({
                    ...t.toJson(),
                    'circleIds': strip(t.circleIds),
                  })
                : t,
        ],
        people: [
          for (final p in s.people)
            AtlasPerson(
              personId: p.personId,
              name: p.name,
              circleIds: strip(p.circleIds),
              createdAt: p.createdAt,
            ),
        ],
      ),
      () => api.deleteCircle(circleId),
      null,
    );
  }

  // ---------------------------------------------------------------- people

  Future<AtlasPerson> createPerson(String name, List<String> circleIds) {
    final tmpId = _tmpId('person');
    final local = AtlasPerson(
      personId: tmpId,
      name: name,
      circleIds: circleIds,
    );
    return _optimistic<AtlasPerson>(
      (s) => s.copyWith(people: [...s.people, local]),
      () => api.createPerson(name: name, circleIds: circleIds),
      (s, saved) => s.copyWith(
        people: _replace(s.people, (p) => p.personId == tmpId, saved),
      ),
    );
  }

  Future<AtlasPerson> updatePerson(
    AtlasPerson person, {
    String? name,
    List<String>? circleIds,
  }) {
    final local = AtlasPerson(
      personId: person.personId,
      name: name ?? person.name,
      circleIds: circleIds ?? person.circleIds,
      createdAt: person.createdAt,
    );
    return _optimistic<AtlasPerson>(
      (s) => s.copyWith(
        people: _replace(s.people, (p) => p.personId == person.personId, local),
      ),
      () => api.updatePerson(person.personId, name: name, circleIds: circleIds),
      (s, saved) => s.copyWith(
        people: _replace(s.people, (p) => p.personId == person.personId, saved),
      ),
    );
  }

  Future<void> deletePerson(String personId) => _optimistic<void>(
    (s) =>
        s.copyWith(people: [...s.people.where((p) => p.personId != personId)]),
    () => api.deletePerson(personId),
    null,
  );

  // ---------------------------------------------------------------- wishes

  Future<AtlasWish> createWish(
    AtlasPlace place,
    List<String> circleIds, {
    String? note,
  }) {
    final tmpId = _tmpId('wish');
    final local = AtlasWish(
      wishId: tmpId,
      place: place,
      circleIds: circleIds,
      note: note,
      createdAt: DateTime.now().toUtc().toIso8601String(),
    );
    return _optimistic<AtlasWish>(
      (s) => s.copyWith(wishes: [local, ...s.wishes]),
      () => api.createWish(place: place, circleIds: circleIds, note: note),
      (s, saved) => s.copyWith(
        wishes: _replace(s.wishes, (w) => w.wishId == tmpId, saved),
      ),
    );
  }

  /// Checks a wish off (or back on) by linking it to a trip.
  Future<AtlasWish> setWishFulfilled(AtlasWish wish, String? tripId) {
    final local = AtlasWish(
      wishId: wish.wishId,
      place: wish.place,
      circleIds: wish.circleIds,
      note: wish.note,
      fulfilledByTripId: tripId,
      createdAt: wish.createdAt,
    );
    return _optimistic<AtlasWish>(
      (s) => s.copyWith(
        wishes: _replace(s.wishes, (w) => w.wishId == wish.wishId, local),
      ),
      () => api.updateWish(wish.wishId, {'fulfilledByTripId': tripId}),
      (s, saved) => s.copyWith(
        wishes: _replace(s.wishes, (w) => w.wishId == wish.wishId, saved),
      ),
    );
  }

  Future<void> deleteWish(String wishId) => _optimistic<void>(
    (s) => s.copyWith(wishes: [...s.wishes.where((w) => w.wishId != wishId)]),
    () => api.deleteWish(wishId),
    null,
  );

  // ---------------------------------------------------------------- profile

  Future<void> setHomePlace(AtlasPlace place) => _optimistic<AtlasProfile>(
    (s) => s.copyWith(profile: s.profile.copyWith(homePlace: place)),
    () => api.updateProfile({'homePlace': place.toJson()}),
    (s, saved) => s.copyWith(profile: saved),
  );
}
