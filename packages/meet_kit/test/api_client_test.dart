import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:meet_kit/meet_kit.dart';

const _eventJson = <String, dynamic>{
  'eventId': 'evt_1',
  'slug': 'mt_abc',
  'organizerId': 'user_1',
  'title': 'Dinner',
  'mode': 'time-grid',
  'timezone': 'UTC',
  'dates': ['2026-07-10'],
  'startMinute': 540,
  'endMinute': 660,
  'slotMinutes': 30,
  'status': 'open',
  'version': 1,
  'createdAt': '',
  'updatedAt': '',
};

const _participantJson = <String, dynamic>{
  'eventId': 'evt_1',
  'participantId': 'part_1',
  'displayName': 'Sam',
  'role': 'participant',
  'availability': {'2026-07-10': '2200'},
  'createdAt': '',
  'updatedAt': '',
};

void main() {
  test('authed routes carry the bearer token and hit /meet paths', () async {
    http.Request? seen;
    final client = MeetApiClient(
      baseUrl: 'https://api.test',
      getAuthToken: () async => 'token-123',
      httpClient: MockClient((request) async {
        seen = request;
        return http.Response(jsonEncode({'event': _eventJson}), 201);
      }),
    );

    final event = await client.createEvent(
      title: 'Dinner',
      mode: MeetMode.timeGrid,
      timezone: 'UTC',
      dates: ['2026-07-10'],
      startMinute: 540,
      endMinute: 660,
      slotMinutes: 30,
    );

    expect(event.eventId, 'evt_1');
    expect(seen!.method, 'POST');
    expect(seen!.url.toString(), 'https://api.test/meet/events');
    expect(seen!.headers['Authorization'], 'Bearer token-123');
    final body = jsonDecode(seen!.body) as Map<String, dynamic>;
    expect(body['mode'], 'time-grid');
    expect(body['slotMinutes'], 30);
    expect(body.containsKey('description'), isFalse);
  });

  test('missing token fails fast with a 401', () async {
    final client = MeetApiClient(
      baseUrl: 'https://api.test',
      httpClient: MockClient((_) async => http.Response('{}', 200)),
    );
    expect(
      () => client.listEvents(),
      throwsA(
        isA<MeetApiException>().having((e) => e.statusCode, 'statusCode', 401),
      ),
    );
  });

  test('error bodies surface the API message', () async {
    final client = MeetApiClient(
      baseUrl: 'https://api.test',
      getAuthToken: () async => 'token',
      httpClient: MockClient(
        (_) async =>
            http.Response(jsonEncode({'message': 'Organizer only'}), 403),
      ),
    );
    expect(
      () => client.deleteEvent('evt_1'),
      throwsA(
        isA<MeetApiException>()
            .having((e) => e.message, 'message', 'Organizer only')
            .having((e) => e.statusCode, 'statusCode', 403),
      ),
    );
  });

  test('public routes send no Authorization header', () async {
    http.Request? seen;
    final client = MeetApiClient(
      baseUrl: 'https://api.test',
      httpClient: MockClient((request) async {
        seen = request;
        return http.Response(
          jsonEncode({
            'event': _eventJson,
            'participants': [_participantJson],
            'suggestions': <dynamic>[],
            'version': 4,
          }),
          200,
        );
      }),
    );

    final snapshot = await client.getPublicEvent('mt_abc', since: 3);
    expect(seen!.url.toString(), 'https://api.test/meet-public/mt_abc?since=3');
    expect(seen!.headers.containsKey('Authorization'), isFalse);
    expect(snapshot.version, 4);
    expect(snapshot.unchanged, isFalse);
    expect(snapshot.participants, hasLength(1));
  });

  test('unchanged public polls skip the payload', () async {
    final client = MeetApiClient(
      baseUrl: 'https://api.test',
      httpClient: MockClient(
        (_) async =>
            http.Response(jsonEncode({'version': 4, 'unchanged': true}), 200),
      ),
    );
    final snapshot = await client.getPublicEvent('mt_abc', since: 4);
    expect(snapshot.unchanged, isTrue);
    expect(snapshot.event, isNull);
    expect(snapshot.participants, isNull);
  });

  test('guest availability writes carry the secret header', () async {
    http.Request? seen;
    final client = MeetApiClient(
      baseUrl: 'https://api.test',
      httpClient: MockClient((request) async {
        seen = request;
        return http.Response(
          jsonEncode({'participant': _participantJson}),
          200,
        );
      }),
    );

    await client.submitGuestAvailability(
      'mt_abc',
      'part_1',
      secret: 's3cret',
      availability: {'2026-07-10': '2200'},
      timezone: 'UTC',
    );

    expect(
      seen!.url.path,
      '/meet-public/mt_abc/participants/part_1/availability',
    );
    expect(seen!.method, 'PUT');
    expect(seen!.headers[meetParticipantSecretHeader], 's3cret');
    expect(seen!.headers.containsKey('Authorization'), isFalse);
  });

  test('guest join returns the one-time secret', () async {
    final client = MeetApiClient(
      baseUrl: 'https://api.test',
      httpClient: MockClient(
        (_) async => http.Response(
          jsonEncode({'participant': _participantJson, 'secret': 'once'}),
          201,
        ),
      ),
    );
    final join = await client.joinAsGuest('mt_abc', displayName: 'Sam');
    expect(join.secret, 'once');
    expect(join.participant.participantId, 'part_1');
  });
}
