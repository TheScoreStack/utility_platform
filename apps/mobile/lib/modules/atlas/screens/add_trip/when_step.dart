import 'package:flutter/material.dart';

import '../../lens.dart';
import '../../models/trip_draft.dart';
import 'add_trip_widgets.dart';

/// The When step's pickers. Kept apart from [TripDraft] because the draft
/// only stores the resulting strings; switching precision back and forth
/// shouldn't lose the year or day the user already picked.
class TripDates {
  String precision;
  int year;
  int month;
  DateTime? startDay;
  DateTime? endDay;

  /// False until the user picks something on a new trip: the default
  /// (this month) is a placeholder, not an answer.
  bool touched = false;

  TripDates._(this.precision, this.year, this.month);

  /// New trips ([editing] false) open on Exact with no days picked yet.
  factory TripDates.fromDraft(TripDraft draft, {required bool editing}) {
    final now = DateTime.now();
    final parts = draft.start.split('-');
    final dates = TripDates._(
      editing ? draft.datePrecision : 'day',
      int.tryParse(parts[0]) ?? now.year,
      parts.length > 1 ? int.tryParse(parts[1]) ?? now.month : now.month,
    );
    dates.touched = editing;
    if (editing && dates.precision == 'day') {
      dates.startDay = DateTime.tryParse(draft.start);
      dates.endDay = draft.end != null ? DateTime.tryParse(draft.end!) : null;
    }
    return dates;
  }

  /// The When pill's check: the user (or the saved trip) set a real date.
  bool get isSet => touched && (precision != 'day' || startDay != null);

  static String _ymd(DateTime d) =>
      '${d.year}-${twoDigits(d.month)}-${twoDigits(d.day)}';

  /// Writes the picked dates back onto [draft] as start/end strings. Exact
  /// with no days picked yet keeps the month placeholder rather than
  /// inventing a day.
  void applyTo(TripDraft draft) {
    final s = startDay;
    if (precision == 'year') {
      draft.start = '$year';
      draft.end = null;
    } else if (precision == 'month' || s == null) {
      draft.start = '$year-${twoDigits(month)}';
      draft.end = null;
    } else {
      draft.start = _ymd(s);
      draft.end = endDay != null && endDay!.isAfter(s) ? _ymd(endDay!) : null;
    }
  }
}

/// Step 2: exact days, a month, or just a year.
class WhenStep extends StatelessWidget {
  final TripDraft draft;
  final TripDates dates;
  final VoidCallback onChanged;

  const WhenStep({
    super.key,
    required this.draft,
    required this.dates,
    required this.onChanged,
  });

  void _update(void Function() fn) {
    fn();
    dates.touched = true;
    dates.applyTo(draft);
    onChanged();
  }

  /// One range picker for both ends; a one-day trip is start == end.
  Future<void> _pickRange(BuildContext context) async {
    final now = DateTime.now();
    final first = DateTime(1940);
    final last = DateTime(now.year, now.month, now.day);
    final start = dates.startDay;
    final end = dates.endDay ?? start;
    final picked = await showDateRangePicker(
      context: context,
      firstDate: first,
      lastDate: last,
      initialEntryMode: DatePickerEntryMode.calendarOnly,
      // Only pass a range the picker accepts (a future trip wouldn't be).
      initialDateRange:
          start != null &&
              end != null &&
              !start.isBefore(first) &&
              !end.isAfter(last) &&
              !end.isBefore(start)
          ? DateTimeRange(start: start, end: end)
          : null,
    );
    if (picked == null) return;
    _update(() {
      dates.startDay = picked.start;
      dates.endDay = picked.end == picked.start ? null : picked.end;
    });
  }

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final years = [for (var y = now.year; y >= 1940; y--) y];
    return ListView(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
      children: [
        Text('When?', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 6),
        const Text(
          'Only remember the year? That works.',
          style: TextStyle(color: Colors.white54),
        ),
        const SizedBox(height: 16),
        SegmentedButton<String>(
          showSelectedIcon: false,
          segments: const [
            ButtonSegment(value: 'day', label: Text('Exact')),
            ButtonSegment(value: 'month', label: Text('Month')),
            ButtonSegment(value: 'year', label: Text('Year')),
          ],
          selected: {dates.precision},
          onSelectionChanged: (s) => _update(() => dates.precision = s.first),
        ),
        const SizedBox(height: 20),
        if (dates.precision == 'day')
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.date_range_rounded),
            title: const Text('Dates'),
            subtitle: Text(
              dates.startDay == null
                  ? 'Pick dates'
                  : formatTripDates(
                      start: draft.start,
                      end: draft.end,
                      datePrecision: 'day',
                    ),
            ),
            onTap: () => _pickRange(context),
          )
        else
          Row(
            children: [
              if (dates.precision == 'month') ...[
                Expanded(
                  child: DropdownButtonFormField<int>(
                    initialValue: dates.month,
                    decoration: const InputDecoration(labelText: 'Month'),
                    items: [
                      for (var m = 1; m <= 12; m++)
                        DropdownMenuItem(
                          value: m,
                          child: Text(atlasMonths[m - 1]),
                        ),
                    ],
                    onChanged: (m) =>
                        _update(() => dates.month = m ?? dates.month),
                  ),
                ),
                const SizedBox(width: 12),
              ],
              Expanded(
                child: DropdownButtonFormField<int>(
                  initialValue: years.contains(dates.year)
                      ? dates.year
                      : now.year,
                  decoration: const InputDecoration(labelText: 'Year'),
                  menuMaxHeight: 320,
                  items: [
                    for (final y in years)
                      DropdownMenuItem(value: y, child: Text('$y')),
                  ],
                  onChanged: (y) => _update(() => dates.year = y ?? dates.year),
                ),
              ),
            ],
          ),
        if (dates.precision != 'day') ...[
          const SizedBox(height: 20),
          Center(
            child: Text(
              formatTripDates(
                start: draft.start,
                end: draft.end,
                datePrecision: draft.datePrecision,
              ),
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ],
    );
  }
}
