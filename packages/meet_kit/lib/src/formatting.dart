// Lightweight date/time formatting and a device-timezone guess. Hand-rolled
// so the package depends only on flutter + http (no intl). Phase 1 renders
// everything in the EVENT's timezone with a label — no conversion math.

const List<String> _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const List<String> _months = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/// Common IANA timezones offered by the create screen.
const List<String> meetCommonTimezones = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Kolkata',
  'Australia/Sydney',
  'UTC',
];

/// Best-effort IANA name for the device timezone. Dart only exposes an
/// abbreviation (e.g. "PST"), so common abbreviations are mapped and
/// anything unknown falls back to "UTC". Some platforms already return an
/// IANA name, which passes through unchanged.
String meetDeviceTimezoneGuess() {
  final name = DateTime.now().timeZoneName;
  if (name.contains('/')) return name;
  const abbreviations = <String, String>{
    'EST': 'America/New_York',
    'EDT': 'America/New_York',
    'CST': 'America/Chicago',
    'CDT': 'America/Chicago',
    'MST': 'America/Denver',
    'MDT': 'America/Denver',
    'PST': 'America/Los_Angeles',
    'PDT': 'America/Los_Angeles',
    'AKST': 'America/Anchorage',
    'AKDT': 'America/Anchorage',
    'HST': 'Pacific/Honolulu',
    'GMT': 'Europe/London',
    'BST': 'Europe/London',
    'CET': 'Europe/Paris',
    'CEST': 'Europe/Paris',
    'JST': 'Asia/Tokyo',
    'IST': 'Asia/Kolkata',
    'AEST': 'Australia/Sydney',
    'AEDT': 'Australia/Sydney',
    'UTC': 'UTC',
  };
  return abbreviations[name] ?? 'UTC';
}

/// "9:00 AM" from minutes-past-midnight. 1440 renders as "12:00 AM"
/// (midnight at the end of the day).
String formatMeetMinutes(int minutes) {
  final normalized = ((minutes % 1440) + 1440) % 1440;
  final hour24 = normalized ~/ 60;
  final minute = normalized % 60;
  final hour12 = hour24 % 12 == 0 ? 12 : hour24 % 12;
  final period = hour24 < 12 ? 'AM' : 'PM';
  return '$hour12:${minute.toString().padLeft(2, '0')} $period';
}

/// "9:00 – 10:30 AM" style range label; all-day windows say "All day".
String formatMeetWindow(int startMinute, int endMinute) {
  if (startMinute == 0 && endMinute == 24 * 60) return 'All day';
  return '${formatMeetMinutes(startMinute)} – ${formatMeetMinutes(endMinute)}';
}

/// Parses "YYYY-MM-DD" into a UTC DateTime, or null when malformed.
DateTime? parseMeetDate(String date) {
  final parts = date.split('-');
  if (parts.length != 3) return null;
  final year = int.tryParse(parts[0]);
  final month = int.tryParse(parts[1]);
  final day = int.tryParse(parts[2]);
  if (year == null || month == null || day == null) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return DateTime.utc(year, month, day);
}

/// "Wed, Jul 8" from "2026-07-08"; falls back to the raw string.
String formatMeetDate(String date, {bool withWeekday = true}) {
  final parsed = parseMeetDate(date);
  if (parsed == null) return date;
  final monthDay = '${_months[parsed.month - 1]} ${parsed.day}';
  if (!withWeekday) return monthDay;
  return '${_weekdays[parsed.weekday - 1]}, $monthDay';
}

/// Short weekday label ("Wed") for grid headers.
String meetWeekdayLabel(String date) {
  final parsed = parseMeetDate(date);
  return parsed == null ? '' : _weekdays[parsed.weekday - 1];
}

/// Compact "Jul 8" label for grid headers.
String meetMonthDayLabel(String date) => formatMeetDate(date, withWeekday: false);

/// "Jul 8 – Jul 12" (or a single date) for list rows.
String formatMeetDateRange(String? firstDate, String? lastDate) {
  final first = firstDate == null ? null : formatMeetDate(firstDate, withWeekday: false);
  final last = lastDate == null ? null : formatMeetDate(lastDate, withWeekday: false);
  if (first == null && last == null) return '';
  if (first != null && (last == null || last == first)) return first;
  if (first == null) return last!;
  return '$first – $last';
}

/// "YYYY-MM-DD" for a DateTime (local calendar fields).
String meetDateKey(DateTime date) =>
    '${date.year.toString().padLeft(4, '0')}-'
    '${date.month.toString().padLeft(2, '0')}-'
    '${date.day.toString().padLeft(2, '0')}';
