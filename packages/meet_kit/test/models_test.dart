import 'package:flutter_test/flutter_test.dart';
import 'package:meet_kit/meet_kit.dart';

void main() {
  group('MeetEvent JSON', () {
    final full = <String, dynamic>{
      'eventId': 'evt_1',
      'slug': 'mt_abc123',
      'organizerId': 'user_1',
      'organizerName': 'Hunter',
      'title': 'Team dinner',
      'description': 'Pick a night',
      'mode': 'time-grid',
      'timezone': 'America/New_York',
      'dates': ['2026-07-10', '2026-07-11'],
      'startMinute': 540,
      'endMinute': 1020,
      'slotMinutes': 30,
      'settings': {'quorum': 3, 'allowIfNeedBe': true, 'locked': false},
      'status': 'finalized',
      'finalizedSlot': {
        'date': '2026-07-10',
        'startMinute': 600,
        'endMinute': 660,
      },
      'version': 7,
      'createdAt': '2026-07-01T00:00:00Z',
      'updatedAt': '2026-07-02T00:00:00Z',
    };

    test('round-trips every field', () {
      final event = MeetEvent.fromJson(full);
      expect(event.mode, MeetMode.timeGrid);
      expect(event.status, MeetStatus.finalized);
      expect(event.finalizedSlot!.startMinute, 600);
      expect(event.settings!.quorum, 3);
      expect(event.version, 7);
      expect(event.toJson(), full);
    });

    test('wire values match the TS contract', () {
      expect(MeetMode.timeGrid.wire, 'time-grid');
      expect(MeetMode.allDay.wire, 'all-day');
      expect(MeetStatus.open.wire, 'open');
      expect(MeetStatus.finalized.wire, 'finalized');
      expect(MeetMode.fromWire('all-day'), MeetMode.allDay);
      expect(MeetStatus.fromWire('finalized'), MeetStatus.finalized);
    });

    test('optional fields are omitted, not null, in JSON', () {
      final minimal = MeetEvent.fromJson({
        ...full,
        'status': 'open',
      }..remove('organizerName')
        ..remove('description')
        ..remove('settings')
        ..remove('finalizedSlot'));
      final json = minimal.toJson();
      expect(json.containsKey('organizerName'), isFalse);
      expect(json.containsKey('description'), isFalse);
      expect(json.containsKey('settings'), isFalse);
      expect(json.containsKey('finalizedSlot'), isFalse);
      expect(json['status'], 'open');
    });
  });

  group('MeetParticipant JSON', () {
    test('round-trips including the availability map', () {
      final json = <String, dynamic>{
        'eventId': 'evt_1',
        'participantId': 'part_1',
        'displayName': 'Sam',
        'userId': 'user_2',
        'timezone': 'America/Chicago',
        'role': 'organizer',
        'availability': {'2026-07-10': '2210', '2026-07-11': '0000'},
        'respondedAt': '2026-07-03T00:00:00Z',
        'createdAt': '2026-07-01T00:00:00Z',
        'updatedAt': '2026-07-03T00:00:00Z',
      };
      final participant = MeetParticipant.fromJson(json);
      expect(participant.role, MeetRole.organizer);
      expect(participant.availability['2026-07-10'], '2210');
      expect(participant.toJson(), json);
    });

    test('sanitized public rows parse (no userId/email)', () {
      final participant = MeetParticipant.fromJson({
        'participantId': 'part_2',
        'displayName': 'Guest',
        'role': 'participant',
        'availability': <String, dynamic>{},
      });
      expect(participant.userId, isNull);
      expect(participant.email, isNull);
      expect(participant.availability, isEmpty);
    });
  });

  test('MeetEventSettings round-trips and omits nulls', () {
    const settings = MeetEventSettings(quorum: 2, locked: true);
    final json = settings.toJson();
    expect(json, {'quorum': 2, 'locked': true});
    final parsed = MeetEventSettings.fromJson(json);
    expect(parsed.quorum, 2);
    expect(parsed.locked, true);
    expect(parsed.allowIfNeedBe, isNull);
    expect(parsed.responseDeadline, isNull);
  });

  test('MeetSuggestion parses fractional scores', () {
    final json = <String, dynamic>{
      'date': '2026-07-10',
      'startMinute': 600,
      'endMinute': 720,
      'availableIds': ['a', 'b'],
      'ifNeedBeIds': ['c'],
      'score': 2.5,
      'meetsQuorum': true,
    };
    final suggestion = MeetSuggestion.fromJson(json);
    expect(suggestion.score, 2.5);
    expect(suggestion.meetsQuorum, isTrue);
    expect(suggestion.slot.endMinute, 720);
    expect(suggestion.toJson(), json);
  });

  test('MeetSlotRef round-trips', () {
    final json = <String, dynamic>{
      'date': '2026-07-10',
      'startMinute': 0,
      'endMinute': 1440,
    };
    expect(MeetSlotRef.fromJson(json).toJson(), json);
  });

  test('MeetEventSummary parses denormalized list rows', () {
    final summary = MeetEventSummary.fromJson({
      'eventId': 'evt_1',
      'title': 'Team dinner',
      'status': 'open',
      'mode': 'all-day',
      'firstDate': '2026-07-10',
      'lastDate': '2026-07-12',
      'role': 'organizer',
    });
    expect(summary.mode, MeetMode.allDay);
    expect(summary.role, MeetRole.organizer);
    expect(summary.firstDate, '2026-07-10');
  });
}
