// Mirrors the slot math in packages/shared/src/meet.ts — if these fail after
// a contract change, update availability.dart to match the TS source.

import 'package:flutter_test/flutter_test.dart';
import 'package:meet_kit/meet_kit.dart';

MeetEvent buildEvent({
  MeetMode mode = MeetMode.timeGrid,
  List<String> dates = const ['2026-07-10', '2026-07-11'],
  int startMinute = 540,
  int endMinute = 1020,
  int slotMinutes = 30,
  MeetEventSettings? settings,
}) {
  return MeetEvent(
    eventId: 'evt_1',
    slug: 'mt_test',
    organizerId: 'user_1',
    title: 'Test meet',
    mode: mode,
    timezone: 'America/New_York',
    dates: dates,
    startMinute: startMinute,
    endMinute: endMinute,
    slotMinutes: slotMinutes,
    settings: settings,
    status: MeetStatus.open,
    version: 1,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
  );
}

MeetParticipant buildParticipant(String id, MeetAvailability availability) {
  return MeetParticipant(
    eventId: 'evt_1',
    participantId: id,
    displayName: id,
    role: MeetRole.participant,
    availability: availability,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
  );
}

void main() {
  group('meetSlotsPerDay', () {
    test('divides the window by the granularity', () {
      expect(meetSlotsPerDay(buildEvent()), 16); // 9:00–17:00 / 30 min
      expect(meetSlotsPerDay(buildEvent(slotMinutes: 60)), 8);
      expect(meetSlotsPerDay(buildEvent(slotMinutes: 15)), 32);
    });

    test('all-day mode is one slot per date', () {
      expect(meetSlotsPerDay(buildEvent(mode: MeetMode.allDay)), 1);
    });

    test('degenerate grids yield zero slots', () {
      expect(meetSlotsPerDay(buildEvent(slotMinutes: 0)), 0);
      expect(
        meetSlotsPerDay(buildEvent(startMinute: 600, endMinute: 600)),
        0,
      );
      expect(
        meetSlotsPerDay(buildEvent(startMinute: 600, endMinute: 540)),
        0,
      );
    });

    test('floors partial slots', () {
      expect(
        meetSlotsPerDay(buildEvent(startMinute: 0, endMinute: 100, slotMinutes: 30)),
        3,
      );
    });
  });

  group('meetSlotRef', () {
    test('offsets from the window start', () {
      final ref = meetSlotRef(buildEvent(), '2026-07-10', 2);
      expect(ref.date, '2026-07-10');
      expect(ref.startMinute, 600);
      expect(ref.endMinute, 630);
    });

    test('all-day covers midnight to midnight', () {
      final ref = meetSlotRef(buildEvent(mode: MeetMode.allDay), '2026-07-10', 0);
      expect(ref.startMinute, 0);
      expect(ref.endMinute, 1440);
    });
  });

  group('normalizeMeetAvailability', () {
    test('pads short days and fills missing dates with zeros', () {
      final event = buildEvent(slotMinutes: 60); // 8 slots
      final result = normalizeMeetAvailability(event, {'2026-07-10': '22'});
      expect(result['2026-07-10'], '22000000');
      expect(result['2026-07-11'], '00000000');
    });

    test('truncates long days and drops unknown dates', () {
      final event = buildEvent(slotMinutes: 60);
      final result = normalizeMeetAvailability(event, {
        '2026-07-10': '2222222222222222',
        '2026-12-25': '22222222',
      });
      expect(result['2026-07-10'], '22222222');
      expect(result.containsKey('2026-12-25'), isFalse);
      expect(result.length, 2);
    });

    test('clamps invalid characters to 0', () {
      final event = buildEvent(slotMinutes: 60);
      final result = normalizeMeetAvailability(event, {'2026-07-10': '2x91?12a'});
      expect(result['2026-07-10'], '20010120');
    });

    test('degrades level 1 to 0 when if-need-be is disabled', () {
      final event = buildEvent(
        slotMinutes: 60,
        settings: const MeetEventSettings(allowIfNeedBe: false),
      );
      final result = normalizeMeetAvailability(event, {'2026-07-10': '12121212'});
      expect(result['2026-07-10'], '02020202');
    });

    test('null input yields all-zero days', () {
      final event = buildEvent(mode: MeetMode.allDay);
      final result = normalizeMeetAvailability(event, null);
      expect(result, {'2026-07-10': '0', '2026-07-11': '0'});
    });
  });

  group('meetLevelAt', () {
    const availability = {'2026-07-10': '210'};

    test('reads the character per slot', () {
      expect(meetLevelAt(availability, '2026-07-10', 0), 2);
      expect(meetLevelAt(availability, '2026-07-10', 1), 1);
      expect(meetLevelAt(availability, '2026-07-10', 2), 0);
    });

    test('missing date or out-of-range index reads as 0', () {
      expect(meetLevelAt(availability, '2026-07-11', 0), 0);
      expect(meetLevelAt(availability, '2026-07-10', 3), 0);
      expect(meetLevelAt(availability, '2026-07-10', -1), 0);
    });
  });

  group('setMeetLevel', () {
    test('sets one slot and keeps the rest', () {
      final event = buildEvent(slotMinutes: 60);
      final result = setMeetLevel(
        event,
        {'2026-07-10': '22000000'},
        '2026-07-10',
        3,
        1,
      );
      expect(result['2026-07-10'], '22010000');
      expect(result['2026-07-11'], '00000000');
    });

    test('respects allowIfNeedBe=false', () {
      final event = buildEvent(
        slotMinutes: 60,
        settings: const MeetEventSettings(allowIfNeedBe: false),
      );
      final result = setMeetLevel(event, {}, '2026-07-10', 0, 1);
      expect(result['2026-07-10'], '00000000');
    });
  });

  group('buildMeetHeatmap', () {
    test('aggregates attendee ids per slot', () {
      final event = buildEvent(slotMinutes: 60); // 8 slots, 2 dates
      final heatmap = buildMeetHeatmap(event, [
        buildParticipant('a', {'2026-07-10': '22000000'}),
        buildParticipant('b', {'2026-07-10': '21000000', '2026-07-11': '00000002'}),
        buildParticipant('c', {'2026-07-10': '10000000'}),
      ]);

      expect(heatmap.participantCount, 3);
      expect(heatmap.maxAvailable, 2);

      final day1 = heatmap.tally['2026-07-10']!;
      expect(day1.available[0], ['a', 'b']);
      expect(day1.ifNeedBe[0], ['c']);
      expect(day1.available[1], ['a']);
      expect(day1.ifNeedBe[1], ['b']);
      expect(day1.available[2], isEmpty);

      final day2 = heatmap.tally['2026-07-11']!;
      expect(day2.available[7], ['b']);
    });

    test('empty participants produce zeroed tallies for every date', () {
      final event = buildEvent();
      final heatmap = buildMeetHeatmap(event, []);
      expect(heatmap.participantCount, 0);
      expect(heatmap.maxAvailable, 0);
      expect(heatmap.tally.keys, ['2026-07-10', '2026-07-11']);
      expect(heatmap.tally['2026-07-10']!.available.length, 16);
    });
  });
}
