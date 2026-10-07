// Dart mirrors of the Atlas contract in packages/shared/src/atlas.ts.

const String atlasSoloCircleId = 'solo';

const List<String> atlasCircleColors = [
  'rose',
  'amber',
  'emerald',
  'sky',
  'violet',
  'coral',
  'teal',
  'slate',
];

double _num(dynamic v) => v is num ? v.toDouble() : double.tryParse('$v') ?? 0;

List<String> _strings(dynamic v) =>
    v is List ? [for (final s in v) s.toString()] : <String>[];

Map<String, dynamic> _map(dynamic v) =>
    v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

class AtlasPlace {
  final String providerId;
  final String name;

  /// city | region | country | airport | poi
  final String kind;
  final String? locality;
  final String? regionCode;
  final String? regionName;
  final String countryCode;
  final double lat;
  final double lng;
  final String? iata;

  const AtlasPlace({
    required this.providerId,
    required this.name,
    required this.kind,
    this.locality,
    this.regionCode,
    this.regionName,
    required this.countryCode,
    required this.lat,
    required this.lng,
    this.iata,
  });

  factory AtlasPlace.fromJson(Map<String, dynamic> json) => AtlasPlace(
    providerId: json['providerId'] as String? ?? '',
    name: json['name'] as String? ?? '',
    kind: json['kind'] as String? ?? 'city',
    locality: json['locality'] as String?,
    regionCode: json['regionCode'] as String?,
    regionName: json['regionName'] as String?,
    countryCode: json['countryCode'] as String? ?? '',
    lat: _num(json['lat']),
    lng: _num(json['lng']),
    iata: json['iata'] as String?,
  );

  Map<String, dynamic> toJson() => {
    'providerId': providerId,
    'name': name,
    'kind': kind,
    if (locality != null) 'locality': locality,
    if (regionCode != null) 'regionCode': regionCode,
    if (regionName != null) 'regionName': regionName,
    'countryCode': countryCode,
    'lat': lat,
    'lng': lng,
    if (iata != null) 'iata': iata,
  };

  /// Short label: "SFO" for airports, otherwise the name.
  String get shortLabel => iata ?? name;
}

class AtlasStop {
  final String stopId;
  final AtlasPlace place;

  const AtlasStop({required this.stopId, required this.place});

  factory AtlasStop.fromJson(Map<String, dynamic> json) => AtlasStop(
    stopId: json['stopId'] as String? ?? '',
    place: AtlasPlace.fromJson(_map(json['place'])),
  );

  Map<String, dynamic> toJson() => {'stopId': stopId, 'place': place.toJson()};
}

class AtlasLeg {
  final String legId;

  /// flight | drive | train | boat | other
  final String mode;
  final AtlasPlace from;
  final AtlasPlace to;
  final String? airline;
  final String? flightNumber;

  const AtlasLeg({
    required this.legId,
    required this.mode,
    required this.from,
    required this.to,
    this.airline,
    this.flightNumber,
  });

  factory AtlasLeg.fromJson(Map<String, dynamic> json) => AtlasLeg(
    legId: json['legId'] as String? ?? '',
    mode: json['mode'] as String? ?? 'other',
    from: AtlasPlace.fromJson(_map(json['from'])),
    to: AtlasPlace.fromJson(_map(json['to'])),
    airline: json['airline'] as String?,
    flightNumber: json['flightNumber'] as String?,
  );

  Map<String, dynamic> toJson() => {
    'legId': legId,
    'mode': mode,
    'from': from.toJson(),
    'to': to.toJson(),
    if (airline != null) 'airline': airline,
    if (flightNumber != null) 'flightNumber': flightNumber,
  };

  bool get isFlight => mode == 'flight';
}

class AtlasTrip {
  final String tripId;
  final String title;
  final String start;
  final String? end;

  /// day | month | year
  final String datePrecision;
  final List<String> circleIds;
  final List<String> personIds;
  final List<AtlasStop> stops;
  final List<AtlasLeg> legs;
  final int? rating;
  final String? notes;
  final String? coverKey;
  final String? coverUrl;
  final String? expenseTripId;
  final String createdAt;
  final String updatedAt;

  const AtlasTrip({
    required this.tripId,
    required this.title,
    required this.start,
    this.end,
    required this.datePrecision,
    this.circleIds = const [],
    this.personIds = const [],
    this.stops = const [],
    this.legs = const [],
    this.rating,
    this.notes,
    this.coverKey,
    this.coverUrl,
    this.expenseTripId,
    this.createdAt = '',
    this.updatedAt = '',
  });

  factory AtlasTrip.fromJson(Map<String, dynamic> json) => AtlasTrip(
    tripId: json['tripId'] as String? ?? '',
    title: json['title'] as String? ?? '',
    start: json['start'] as String? ?? '',
    end: json['end'] as String?,
    datePrecision:
        json['datePrecision'] as String? ??
        precisionOf(json['start'] as String? ?? ''),
    circleIds: _strings(json['circleIds']),
    personIds: _strings(json['personIds']),
    stops: [
      for (final s in (json['stops'] as List? ?? const []))
        AtlasStop.fromJson(_map(s)),
    ],
    legs: [
      for (final l in (json['legs'] as List? ?? const []))
        AtlasLeg.fromJson(_map(l)),
    ],
    rating: (json['rating'] as num?)?.toInt(),
    notes: json['notes'] as String?,
    coverKey: json['coverKey'] as String?,
    coverUrl: json['coverUrl'] as String?,
    expenseTripId: json['expenseTripId'] as String?,
    createdAt: json['createdAt'] as String? ?? '',
    updatedAt: json['updatedAt'] as String? ?? '',
  );

  Map<String, dynamic> toJson() => {
    'tripId': tripId,
    'title': title,
    'start': start,
    if (end != null) 'end': end,
    'datePrecision': datePrecision,
    'circleIds': circleIds,
    'personIds': personIds,
    'stops': [for (final s in stops) s.toJson()],
    'legs': [for (final l in legs) l.toJson()],
    if (rating != null) 'rating': rating,
    if (notes != null) 'notes': notes,
    if (coverKey != null) 'coverKey': coverKey,
    if (coverUrl != null) 'coverUrl': coverUrl,
    if (expenseTripId != null) 'expenseTripId': expenseTripId,
    'createdAt': createdAt,
    'updatedAt': updatedAt,
  };

  static String precisionOf(String start) => start.length >= 10
      ? 'day'
      : start.length >= 7
      ? 'month'
      : 'year';
}

class AtlasCircle {
  final String circleId;
  final String name;
  final String color;
  final int sortOrder;
  final bool builtIn;
  final String createdAt;

  const AtlasCircle({
    required this.circleId,
    required this.name,
    required this.color,
    this.sortOrder = 0,
    this.builtIn = false,
    this.createdAt = '',
  });

  factory AtlasCircle.fromJson(Map<String, dynamic> json) => AtlasCircle(
    circleId: json['circleId'] as String? ?? '',
    name: json['name'] as String? ?? '',
    color: json['color'] as String? ?? 'slate',
    sortOrder: (json['sortOrder'] as num?)?.toInt() ?? 0,
    builtIn: json['builtIn'] as bool? ?? false,
    createdAt: json['createdAt'] as String? ?? '',
  );

  Map<String, dynamic> toJson() => {
    'circleId': circleId,
    'name': name,
    'color': color,
    'sortOrder': sortOrder,
    if (builtIn) 'builtIn': true,
    'createdAt': createdAt,
  };

  AtlasCircle copyWith({String? name, String? color}) => AtlasCircle(
    circleId: circleId,
    name: name ?? this.name,
    color: color ?? this.color,
    sortOrder: sortOrder,
    builtIn: builtIn,
    createdAt: createdAt,
  );
}

class AtlasPerson {
  final String personId;
  final String name;
  final List<String> circleIds;
  final String createdAt;

  const AtlasPerson({
    required this.personId,
    required this.name,
    this.circleIds = const [],
    this.createdAt = '',
  });

  factory AtlasPerson.fromJson(Map<String, dynamic> json) => AtlasPerson(
    personId: json['personId'] as String? ?? '',
    name: json['name'] as String? ?? '',
    circleIds: _strings(json['circleIds']),
    createdAt: json['createdAt'] as String? ?? '',
  );

  Map<String, dynamic> toJson() => {
    'personId': personId,
    'name': name,
    'circleIds': circleIds,
    'createdAt': createdAt,
  };
}

class AtlasWish {
  final String wishId;
  final AtlasPlace place;
  final List<String> circleIds;
  final String? note;
  final String? fulfilledByTripId;
  final String createdAt;

  const AtlasWish({
    required this.wishId,
    required this.place,
    this.circleIds = const [],
    this.note,
    this.fulfilledByTripId,
    this.createdAt = '',
  });

  factory AtlasWish.fromJson(Map<String, dynamic> json) => AtlasWish(
    wishId: json['wishId'] as String? ?? '',
    place: AtlasPlace.fromJson(_map(json['place'])),
    circleIds: _strings(json['circleIds']),
    note: json['note'] as String?,
    fulfilledByTripId: json['fulfilledByTripId'] as String?,
    createdAt: json['createdAt'] as String? ?? '',
  );

  Map<String, dynamic> toJson() => {
    'wishId': wishId,
    'place': place.toJson(),
    'circleIds': circleIds,
    if (note != null) 'note': note,
    if (fulfilledByTripId != null) 'fulfilledByTripId': fulfilledByTripId,
    'createdAt': createdAt,
  };

  bool get fulfilled => fulfilledByTripId != null;
}

class AtlasLens {
  /// footprint | flights
  final String mode;

  /// "all" or a circle id.
  final String circle;
  final int? fromYear;
  final int? toYear;

  const AtlasLens({
    this.mode = 'footprint',
    this.circle = 'all',
    this.fromYear,
    this.toYear,
  });

  factory AtlasLens.fromJson(Map<String, dynamic> json) => AtlasLens(
    mode: json['mode'] as String? ?? 'footprint',
    circle: json['circle'] as String? ?? 'all',
    fromYear: (json['fromYear'] as num?)?.toInt(),
    toYear: (json['toYear'] as num?)?.toInt(),
  );

  Map<String, dynamic> toJson() => {
    'mode': mode,
    'circle': circle,
    if (fromYear != null) 'fromYear': fromYear,
    if (toYear != null) 'toYear': toYear,
  };

  bool get isFlights => mode == 'flights';

  AtlasLens copyWith({String? mode, String? circle}) => AtlasLens(
    mode: mode ?? this.mode,
    circle: circle ?? this.circle,
    fromYear: fromYear,
    toYear: toYear,
  );

  @override
  bool operator ==(Object other) =>
      other is AtlasLens &&
      other.mode == mode &&
      other.circle == circle &&
      other.fromYear == fromYear &&
      other.toYear == toYear;

  @override
  int get hashCode => Object.hash(mode, circle, fromYear, toYear);
}

class AtlasProfile {
  final AtlasPlace? homePlace;
  final String units;
  final AtlasLens? lastLens;

  const AtlasProfile({this.homePlace, this.units = 'mi', this.lastLens});

  factory AtlasProfile.fromJson(Map<String, dynamic> json) => AtlasProfile(
    homePlace: json['homePlace'] is Map
        ? AtlasPlace.fromJson(_map(json['homePlace']))
        : null,
    units: json['units'] as String? ?? 'mi',
    lastLens: json['lastLens'] is Map
        ? AtlasLens.fromJson(_map(json['lastLens']))
        : null,
  );

  Map<String, dynamic> toJson() => {
    if (homePlace != null) 'homePlace': homePlace!.toJson(),
    'units': units,
    if (lastLens != null) 'lastLens': lastLens!.toJson(),
  };

  AtlasProfile copyWith({AtlasPlace? homePlace, AtlasLens? lastLens}) =>
      AtlasProfile(
        homePlace: homePlace ?? this.homePlace,
        units: units,
        lastLens: lastLens ?? this.lastLens,
      );
}

class AtlasSnapshot {
  final AtlasProfile profile;
  final List<AtlasCircle> circles;
  final List<AtlasPerson> people;
  final List<AtlasTrip> trips;
  final List<AtlasWish> wishes;

  const AtlasSnapshot({
    this.profile = const AtlasProfile(),
    this.circles = const [],
    this.people = const [],
    this.trips = const [],
    this.wishes = const [],
  });

  factory AtlasSnapshot.fromJson(Map<String, dynamic> json) => AtlasSnapshot(
    profile: AtlasProfile.fromJson(_map(json['profile'])),
    circles: [
      for (final c in (json['circles'] as List? ?? const []))
        AtlasCircle.fromJson(_map(c)),
    ],
    people: [
      for (final p in (json['people'] as List? ?? const []))
        AtlasPerson.fromJson(_map(p)),
    ],
    trips: [
      for (final t in (json['trips'] as List? ?? const []))
        AtlasTrip.fromJson(_map(t)),
    ],
    wishes: [
      for (final w in (json['wishes'] as List? ?? const []))
        AtlasWish.fromJson(_map(w)),
    ],
  );

  Map<String, dynamic> toJson() => {
    'profile': profile.toJson(),
    'circles': [for (final c in circles) c.toJson()],
    'people': [for (final p in people) p.toJson()],
    'trips': [for (final t in trips) t.toJson()],
    'wishes': [for (final w in wishes) w.toJson()],
  };

  AtlasSnapshot copyWith({
    AtlasProfile? profile,
    List<AtlasCircle>? circles,
    List<AtlasPerson>? people,
    List<AtlasTrip>? trips,
    List<AtlasWish>? wishes,
  }) => AtlasSnapshot(
    profile: profile ?? this.profile,
    circles: circles ?? this.circles,
    people: people ?? this.people,
    trips: trips ?? this.trips,
    wishes: wishes ?? this.wishes,
  );
}

class AtlasPlaceSuggestion {
  final String providerId;
  final String kind;
  final String title;
  final String? subtitle;
  final AtlasPlace? place;

  const AtlasPlaceSuggestion({
    required this.providerId,
    required this.kind,
    required this.title,
    this.subtitle,
    this.place,
  });

  factory AtlasPlaceSuggestion.fromJson(Map<String, dynamic> json) =>
      AtlasPlaceSuggestion(
        providerId: json['providerId'] as String? ?? '',
        kind: json['kind'] as String? ?? 'city',
        title: json['title'] as String? ?? '',
        subtitle: json['subtitle'] as String?,
        place: json['place'] is Map
            ? AtlasPlace.fromJson(_map(json['place']))
            : null,
      );
}

class AtlasDraftTrip {
  final String line;
  final String title;
  final String? start;
  final String? datePrecision;
  final List<String> circleIds;
  final List<AtlasPlace> places;
  final List<String> unresolved;

  const AtlasDraftTrip({
    required this.line,
    required this.title,
    this.start,
    this.datePrecision,
    this.circleIds = const [],
    this.places = const [],
    this.unresolved = const [],
  });

  factory AtlasDraftTrip.fromJson(Map<String, dynamic> json) => AtlasDraftTrip(
    line: json['line'] as String? ?? '',
    title: json['title'] as String? ?? '',
    start: json['start'] as String?,
    datePrecision: json['datePrecision'] as String?,
    circleIds: _strings(json['circleIds']),
    places: [
      for (final p in (json['places'] as List? ?? const []))
        AtlasPlace.fromJson(_map(p)),
    ],
    unresolved: _strings(json['unresolved']),
  );
}
