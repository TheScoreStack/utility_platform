import '../../core/api_client.dart';
import 'models/atlas_models.dart';

/// Typed wrapper over the shared [ApiClient] for the Atlas endpoints
/// (`/atlas/*`). Contract: packages/shared/src/atlas.ts.
class AtlasApi {
  final ApiClient _api;

  const AtlasApi(this._api);

  ApiClient get client => _api;

  Future<AtlasSnapshot> getSnapshot() async {
    final data = await _api.get('/atlas/snapshot');
    return AtlasSnapshot.fromJson(data as Map<String, dynamic>);
  }

  // ---------------------------------------------------------------- trips

  Future<AtlasTrip> createTrip(Map<String, dynamic> body) async {
    final data = await _api.post('/atlas/trips', body);
    return AtlasTrip.fromJson(data as Map<String, dynamic>);
  }

  /// Partial update; `null` values clear optional fields.
  Future<AtlasTrip> updateTrip(String tripId, Map<String, dynamic> body) async {
    final data = await _api.patch('/atlas/trips/$tripId', body);
    return AtlasTrip.fromJson(data as Map<String, dynamic>);
  }

  Future<void> deleteTrip(String tripId) => _api.delete('/atlas/trips/$tripId');

  // ---------------------------------------------------------------- circles

  Future<AtlasCircle> createCircle({
    required String name,
    required String color,
  }) async {
    final data = await _api.post('/atlas/circles', {
      'name': name,
      'color': color,
    });
    return AtlasCircle.fromJson(data as Map<String, dynamic>);
  }

  Future<AtlasCircle> updateCircle(
    String circleId, {
    String? name,
    String? color,
  }) async {
    final data = await _api.patch('/atlas/circles/$circleId', {
      'name': ?name,
      'color': ?color,
    });
    return AtlasCircle.fromJson(data as Map<String, dynamic>);
  }

  Future<void> deleteCircle(String circleId) =>
      _api.delete('/atlas/circles/$circleId');

  // ---------------------------------------------------------------- people

  Future<AtlasPerson> createPerson({
    required String name,
    required List<String> circleIds,
  }) async {
    final data = await _api.post('/atlas/people', {
      'name': name,
      'circleIds': circleIds,
    });
    return AtlasPerson.fromJson(data as Map<String, dynamic>);
  }

  Future<AtlasPerson> updatePerson(
    String personId, {
    String? name,
    List<String>? circleIds,
  }) async {
    final data = await _api.patch('/atlas/people/$personId', {
      'name': ?name,
      'circleIds': ?circleIds,
    });
    return AtlasPerson.fromJson(data as Map<String, dynamic>);
  }

  Future<void> deletePerson(String personId) =>
      _api.delete('/atlas/people/$personId');

  // ---------------------------------------------------------------- wishes

  Future<AtlasWish> createWish({
    required AtlasPlace place,
    required List<String> circleIds,
    String? note,
  }) async {
    final data = await _api.post('/atlas/wishes', {
      'place': place.toJson(),
      'circleIds': circleIds,
      if (note != null && note.isNotEmpty) 'note': note,
    });
    return AtlasWish.fromJson(data as Map<String, dynamic>);
  }

  Future<AtlasWish> updateWish(String wishId, Map<String, dynamic> body) async {
    final data = await _api.patch('/atlas/wishes/$wishId', body);
    return AtlasWish.fromJson(data as Map<String, dynamic>);
  }

  Future<void> deleteWish(String wishId) =>
      _api.delete('/atlas/wishes/$wishId');

  // ---------------------------------------------------------------- profile

  Future<AtlasProfile> updateProfile(Map<String, dynamic> body) async {
    final data = await _api.patch('/atlas/profile', body);
    return AtlasProfile.fromJson(data as Map<String, dynamic>);
  }

  // ---------------------------------------------------------------- places

  Future<List<AtlasPlaceSuggestion>> searchPlaces(
    String query, {
    double? lat,
    double? lng,
  }) async {
    final params = <String, String>{
      'q': query,
      if (lat != null) 'lat': '$lat',
      if (lng != null) 'lng': '$lng',
    };
    final qs = Uri(queryParameters: params).query;
    final data = await _api.get('/atlas/places/search?$qs') as Map;
    return [
      for (final r in (data['results'] as List? ?? const []))
        AtlasPlaceSuggestion.fromJson(Map<String, dynamic>.from(r as Map)),
    ];
  }

  Future<AtlasPlace> getPlace(String providerId) async {
    final data =
        await _api.get('/atlas/places/${Uri.encodeComponent(providerId)}')
            as Map;
    return AtlasPlace.fromJson(Map<String, dynamic>.from(data['place'] as Map));
  }

  /// Resolves a suggestion into a complete place (no call when it already
  /// carries one — airports, countries, US states).
  Future<AtlasPlace> resolve(AtlasPlaceSuggestion s) async =>
      s.place ?? await getPlace(s.providerId);

  // ---------------------------------------------------------------- photos

  Future<({String coverKey, String uploadUrl})> photoUploadUrl({
    required String fileName,
    required String contentType,
  }) async {
    final data =
        await _api.post('/atlas/photos/upload-url', {
              'fileName': fileName,
              'contentType': contentType,
            })
            as Map;
    return (
      coverKey: data['coverKey'] as String,
      uploadUrl: data['uploadUrl'] as String,
    );
  }

  /// Presigns, uploads, and returns the cover key to save on the trip.
  Future<String> uploadCover({
    required String fileName,
    required String contentType,
    required List<int> bytes,
  }) async {
    final target = await photoUploadUrl(
      fileName: fileName,
      contentType: contentType,
    );
    await _api.putBytes(target.uploadUrl, bytes, contentType: contentType);
    return target.coverKey;
  }

  // ---------------------------------------------------------------- quick add

  Future<List<AtlasDraftTrip>> quickAdd(String text) async {
    final data = await _api.post('/atlas/quick-add', {'text': text}) as Map;
    return [
      for (final d in (data['drafts'] as List? ?? const []))
        AtlasDraftTrip.fromJson(Map<String, dynamic>.from(d as Map)),
    ];
  }
}
