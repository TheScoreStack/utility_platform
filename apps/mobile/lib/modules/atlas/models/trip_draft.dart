import 'atlas_models.dart';

/// Mutable leg being edited in the add/edit flow.
class LegDraft {
  String mode;
  AtlasPlace? from;
  AtlasPlace? to;
  String airline;
  String flightNumber;
  final String? legId;

  LegDraft({
    this.mode = 'flight',
    this.from,
    this.to,
    this.airline = '',
    this.flightNumber = '',
    this.legId,
  });

  factory LegDraft.fromLeg(AtlasLeg leg) => LegDraft(
    mode: leg.mode,
    from: leg.from,
    to: leg.to,
    airline: leg.airline ?? '',
    flightNumber: leg.flightNumber ?? '',
    legId: leg.legId,
  );

  bool get complete => from != null && to != null;

  Map<String, dynamic> toJson() => {
    'legId': ?legId,
    'mode': mode,
    'from': from!.toJson(),
    'to': to!.toJson(),
    if (mode == 'flight' && airline.trim().isNotEmpty)
      'airline': airline.trim(),
    if (mode == 'flight' && flightNumber.trim().isNotEmpty)
      'flightNumber': flightNumber.trim(),
  };
}

/// Everything the add/edit flow collects. Builds both the request body and
/// an optimistic [AtlasTrip].
class TripDraft {
  String title;
  String start;
  String? end;
  List<String> circleIds;
  List<String> personIds;
  List<AtlasPlace> stops;
  List<String?> stopIds;
  List<LegDraft> legs;
  int? rating;
  String? notes;
  String? coverKey;
  String? coverUrl;

  TripDraft({
    this.title = '',
    required this.start,
    this.end,
    List<String>? circleIds,
    List<String>? personIds,
    List<AtlasPlace>? stops,
    List<String?>? stopIds,
    List<LegDraft>? legs,
    this.rating,
    this.notes,
    this.coverKey,
    this.coverUrl,
  }) : circleIds = circleIds ?? [],
       personIds = personIds ?? [],
       stops = stops ?? [],
       stopIds = stopIds ?? [],
       legs = legs ?? [];

  factory TripDraft.fromTrip(AtlasTrip t) => TripDraft(
    title: t.title,
    start: t.start,
    end: t.end,
    circleIds: [...t.circleIds],
    personIds: [...t.personIds],
    stops: [for (final s in t.stops) s.place],
    stopIds: [for (final s in t.stops) s.stopId],
    legs: [for (final l in t.legs) LegDraft.fromLeg(l)],
    rating: t.rating,
    notes: t.notes,
    coverKey: t.coverKey,
    coverUrl: t.coverUrl,
  );

  String get datePrecision => AtlasTrip.precisionOf(start);

  /// "Lisbon" / "Lisbon & Porto" / "Lisbon, Porto +2" when no title typed.
  String get effectiveTitle {
    final t = title.trim();
    if (t.isNotEmpty) return t;
    final names = <String>[
      for (final p in stops)
        p.locality?.isNotEmpty == true ? p.locality! : p.name,
    ];
    if (names.isEmpty) {
      for (final l in legs.where((l) => l.complete)) {
        names.add(l.to!.locality ?? l.to!.name);
      }
    }
    if (names.isEmpty) return 'Trip';
    if (names.length == 1) return names.first;
    if (names.length == 2) return '${names[0]} & ${names[1]}';
    return '${names[0]}, ${names[1]} +${names.length - 2}';
  }

  bool get hasPlaces => stops.isNotEmpty || legs.any((l) => l.complete);

  String? get _validEnd =>
      datePrecision == 'day' && end != null && end!.length == 10 && end != start
      ? end
      : null;

  Map<String, dynamic> toBody({bool forPatch = false}) {
    final completeLegs = legs.where((l) => l.complete).toList();
    final body = <String, dynamic>{
      'title': effectiveTitle,
      'start': start,
      'circleIds': circleIds,
      'personIds': personIds,
      'stops': [
        for (var i = 0; i < stops.length; i++)
          {
            if (i < stopIds.length && stopIds[i] != null) 'stopId': stopIds[i],
            'place': stops[i].toJson(),
          },
      ],
      'legs': [for (final l in completeLegs) l.toJson()],
    };
    final n = notes?.trim();
    if (forPatch) {
      body['end'] = _validEnd;
      body['rating'] = rating;
      body['notes'] = (n == null || n.isEmpty) ? null : n;
      body['coverKey'] = coverKey;
    } else {
      if (_validEnd != null) body['end'] = _validEnd;
      if (rating != null) body['rating'] = rating;
      if (n != null && n.isNotEmpty) body['notes'] = n;
      if (coverKey != null) body['coverKey'] = coverKey;
    }
    return body;
  }

  AtlasTrip toTrip({required String tripId, AtlasTrip? base}) {
    final now = DateTime.now().toUtc().toIso8601String();
    var j = 0;
    return AtlasTrip(
      tripId: tripId,
      title: effectiveTitle,
      start: start,
      end: _validEnd,
      datePrecision: datePrecision,
      circleIds: [...circleIds],
      personIds: [...personIds],
      stops: [
        for (var k = 0; k < stops.length; k++)
          AtlasStop(
            stopId: (k < stopIds.length ? stopIds[k] : null) ?? 'tmp_s$k',
            place: stops[k],
          ),
      ],
      legs: [
        for (final l in legs.where((l) => l.complete))
          AtlasLeg(
            legId: l.legId ?? 'tmp_l${j++}',
            mode: l.mode,
            from: l.from!,
            to: l.to!,
            airline: l.mode == 'flight' && l.airline.trim().isNotEmpty
                ? l.airline.trim()
                : null,
            flightNumber: l.mode == 'flight' && l.flightNumber.trim().isNotEmpty
                ? l.flightNumber.trim()
                : null,
          ),
      ],
      rating: rating,
      notes: notes?.trim().isNotEmpty == true ? notes!.trim() : null,
      coverKey: coverKey,
      coverUrl: coverUrl ?? base?.coverUrl,
      expenseTripId: base?.expenseTripId,
      createdAt: base?.createdAt ?? now,
      updatedAt: now,
    );
  }
}
