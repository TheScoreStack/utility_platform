// HTTP client for the Meet API contract (authed `/meet/...` routes plus the
// public `/meet-public/...` respond-page routes). Pure Dart — safe to use
// and unit-test without a Flutter binding.

import 'dart:convert';

import 'package:http/http.dart' as http;

import 'models.dart';

/// Error shape mirrors the platform API: bodies look like `{"message": ...}`.
class MeetApiException implements Exception {
  final String message;
  final int statusCode;

  const MeetApiException(this.message, this.statusCode);

  @override
  String toString() => message;
}

/// `GET /meet/events/{eventId}` response.
class MeetEventDetail {
  final MeetEvent event;
  final List<MeetParticipant> participants;
  final List<MeetSuggestion> suggestions;

  const MeetEventDetail({
    required this.event,
    required this.participants,
    required this.suggestions,
  });

  factory MeetEventDetail.fromJson(Map<String, dynamic> json) =>
      MeetEventDetail(
        event: MeetEvent.fromJson(json['event'] as Map<String, dynamic>),
        participants: (json['participants'] as List<dynamic>? ?? const [])
            .map((p) => MeetParticipant.fromJson(p as Map<String, dynamic>))
            .toList(),
        suggestions: (json['suggestions'] as List<dynamic>? ?? const [])
            .map((s) => MeetSuggestion.fromJson(s as Map<String, dynamic>))
            .toList(),
      );
}

/// `GET /meet-public/{slug}` response. When polled with `?since=` and the
/// version is unchanged, only [version] and [unchanged] are populated.
class MeetPublicSnapshot {
  final int version;
  final bool unchanged;
  final MeetEvent? event;
  final List<MeetParticipant>? participants;
  final List<MeetSuggestion>? suggestions;

  const MeetPublicSnapshot({
    required this.version,
    required this.unchanged,
    this.event,
    this.participants,
    this.suggestions,
  });

  factory MeetPublicSnapshot.fromJson(Map<String, dynamic> json) =>
      MeetPublicSnapshot(
        version: (json['version'] as num? ?? 0).toInt(),
        unchanged: json['unchanged'] as bool? ?? false,
        event: json['event'] is Map<String, dynamic>
            ? MeetEvent.fromJson(json['event'] as Map<String, dynamic>)
            : null,
        participants: json['participants'] is List
            ? (json['participants'] as List<dynamic>)
                .map((p) => MeetParticipant.fromJson(p as Map<String, dynamic>))
                .toList()
            : null,
        suggestions: json['suggestions'] is List
            ? (json['suggestions'] as List<dynamic>)
                .map((s) => MeetSuggestion.fromJson(s as Map<String, dynamic>))
                .toList()
            : null,
      );
}

/// `POST /meet-public/{slug}/participants` response. [secret] is returned
/// exactly once — persist it client-side to edit the guest response later.
class MeetGuestJoin {
  final MeetParticipant participant;
  final String secret;

  const MeetGuestJoin({required this.participant, required this.secret});
}

/// Header carrying the guest secret on public availability writes.
const String meetParticipantSecretHeader = 'x-meet-participant-secret';

class MeetApiClient {
  final String baseUrl;
  final Future<String?> Function()? getAuthToken;
  final http.Client _http;

  MeetApiClient({
    required this.baseUrl,
    this.getAuthToken,
    http.Client? httpClient,
  }) : _http = httpClient ?? http.Client();

  // ---- Authed routes (/meet/...) ----

  /// `POST /meet/events`. Time-grid events need [startMinute]/[endMinute]
  /// (multiples of [slotMinutes], 15/30/60); all-day events ignore them.
  Future<MeetEvent> createEvent({
    required String title,
    String? description,
    required MeetMode mode,
    required String timezone,
    required List<String> dates,
    int? startMinute,
    int? endMinute,
    int? slotMinutes,
    MeetEventSettings? settings,
  }) async {
    final data = await _request('POST', '/meet/events', body: {
      'title': title,
      if (description != null && description.isNotEmpty)
        'description': description,
      'mode': mode.wire,
      'timezone': timezone,
      'dates': dates,
      if (startMinute != null) 'startMinute': startMinute,
      if (endMinute != null) 'endMinute': endMinute,
      if (slotMinutes != null) 'slotMinutes': slotMinutes,
      if (settings != null) 'settings': settings.toJson(),
    });
    return MeetEvent.fromJson(_field(data, 'event'));
  }

  /// `GET /meet/events` — my meets, denormalized summaries.
  Future<List<MeetEventSummary>> listEvents() async {
    final data = await _request('GET', '/meet/events');
    final events = data is Map<String, dynamic> ? data['events'] : null;
    return (events as List<dynamic>? ?? const [])
        .map((e) => MeetEventSummary.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// `GET /meet/events/{eventId}` — event + participants + top suggestions.
  Future<MeetEventDetail> getEvent(String eventId) async {
    final data = await _request('GET', '/meet/events/$eventId');
    if (data is! Map<String, dynamic>) {
      throw const MeetApiException('Malformed event response', 500);
    }
    return MeetEventDetail.fromJson(data);
  }

  /// `PATCH /meet/events/{eventId}` — organizer only; title, description,
  /// settings are the editable fields.
  Future<MeetEvent> updateEvent(
    String eventId, {
    String? title,
    String? description,
    MeetEventSettings? settings,
  }) async {
    final data = await _request('PATCH', '/meet/events/$eventId', body: {
      if (title != null) 'title': title,
      if (description != null) 'description': description,
      if (settings != null) 'settings': settings.toJson(),
    });
    return MeetEvent.fromJson(_field(data, 'event'));
  }

  /// `DELETE /meet/events/{eventId}` — organizer only.
  Future<void> deleteEvent(String eventId) async {
    await _request('DELETE', '/meet/events/$eventId');
  }

  /// `POST /meet/events/{eventId}/finalize` — organizer only. Returns the
  /// updated event when the response includes one, else null (callers should
  /// refetch either way to pick up the bumped version).
  Future<MeetEvent?> finalizeEvent(String eventId, MeetSlotRef slot) async {
    final data = await _request(
      'POST',
      '/meet/events/$eventId/finalize',
      body: slot.toJson(),
    );
    return _optionalEvent(data);
  }

  /// `POST /meet/events/{eventId}/reopen` — organizer only.
  Future<MeetEvent?> reopenEvent(String eventId) async {
    final data = await _request('POST', '/meet/events/$eventId/reopen');
    return _optionalEvent(data);
  }

  /// `PUT /meet/events/{eventId}/availability` — upserts the caller's
  /// participant row. The server normalizes availability to the grid.
  Future<MeetParticipant> submitAvailability(
    String eventId, {
    required MeetAvailability availability,
    String? displayName,
    String? timezone,
  }) async {
    final data = await _request(
      'PUT',
      '/meet/events/$eventId/availability',
      body: {
        'availability': availability,
        if (displayName != null && displayName.isNotEmpty)
          'displayName': displayName,
        if (timezone != null && timezone.isNotEmpty) 'timezone': timezone,
      },
    );
    return MeetParticipant.fromJson(_field(data, 'participant'));
  }

  // ---- Public routes (/meet-public/..., no auth) ----

  /// `GET /meet-public/{slug}`; pass [since] to skip unchanged payloads.
  Future<MeetPublicSnapshot> getPublicEvent(String slug, {int? since}) async {
    final query = since != null ? '?since=$since' : '';
    final data = await _request(
      'GET',
      '/meet-public/$slug$query',
      authed: false,
    );
    if (data is! Map<String, dynamic>) {
      throw const MeetApiException('Malformed event response', 500);
    }
    return MeetPublicSnapshot.fromJson(data);
  }

  /// `POST /meet-public/{slug}/participants` — guest join. The returned
  /// secret is shown exactly once.
  Future<MeetGuestJoin> joinAsGuest(
    String slug, {
    required String displayName,
    String? timezone,
  }) async {
    final data = await _request(
      'POST',
      '/meet-public/$slug/participants',
      body: {
        'displayName': displayName,
        if (timezone != null && timezone.isNotEmpty) 'timezone': timezone,
      },
      authed: false,
    );
    return MeetGuestJoin(
      participant: MeetParticipant.fromJson(_field(data, 'participant')),
      secret: data is Map<String, dynamic> ? data['secret'] as String? ?? '' : '',
    );
  }

  /// `PUT /meet-public/{slug}/participants/{participantId}/availability` —
  /// guest write, authenticated via the participant secret header.
  Future<MeetParticipant> submitGuestAvailability(
    String slug,
    String participantId, {
    required String secret,
    required MeetAvailability availability,
    String? displayName,
    String? timezone,
  }) async {
    final data = await _request(
      'PUT',
      '/meet-public/$slug/participants/$participantId/availability',
      body: {
        'availability': availability,
        if (displayName != null && displayName.isNotEmpty)
          'displayName': displayName,
        if (timezone != null && timezone.isNotEmpty) 'timezone': timezone,
      },
      authed: false,
      headers: {meetParticipantSecretHeader: secret},
    );
    return MeetParticipant.fromJson(_field(data, 'participant'));
  }

  void close() => _http.close();

  // ---- Internals ----

  Map<String, dynamic> _field(dynamic data, String key) {
    final value = data is Map<String, dynamic> ? data[key] : null;
    if (value is Map<String, dynamic>) return value;
    throw MeetApiException('Malformed response (missing "$key")', 500);
  }

  MeetEvent? _optionalEvent(dynamic data) {
    final value = data is Map<String, dynamic> ? data['event'] : null;
    return value is Map<String, dynamic> ? MeetEvent.fromJson(value) : null;
  }

  Future<dynamic> _request(
    String method,
    String path, {
    Object? body,
    bool authed = true,
    Map<String, String>? headers,
  }) async {
    final requestHeaders = <String, String>{...?headers};
    if (authed) {
      final token = await getAuthToken?.call();
      if (token == null || token.isEmpty) {
        throw const MeetApiException('Unable to resolve auth token', 401);
      }
      requestHeaders['Authorization'] = 'Bearer $token';
    }

    String? encodedBody;
    if (body != null) {
      requestHeaders['Content-Type'] = 'application/json';
      encodedBody = jsonEncode(body);
    }

    final request = http.Request(method, Uri.parse('$baseUrl$path'))
      ..headers.addAll(requestHeaders);
    if (encodedBody != null) {
      request.body = encodedBody;
    }

    final streamed = await _http.send(request);
    final response = await http.Response.fromStream(streamed);

    if (response.statusCode == 204) return null;

    dynamic data;
    if (response.body.isNotEmpty) {
      try {
        data = jsonDecode(response.body);
      } catch (_) {
        data = null;
      }
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message =
          data is Map<String, dynamic> ? data['message'] as String? : null;
      throw MeetApiException(
        message ?? 'Request failed (${response.statusCode})',
        response.statusCode,
      );
    }

    return data;
  }
}
