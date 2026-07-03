import 'package:intl/intl.dart';

/// Formats an amount in the trip's currency, e.g. `$12.34` / `€12.34`.
String formatCurrency(double amount, String currencyCode) {
  final format = NumberFormat.simpleCurrency(
    name: currencyCode.isEmpty ? 'USD' : currencyCode,
  );
  return format.format(amount);
}

/// Just the currency symbol (`$`, `€`, …), for muted amount-field prefixes.
String currencySymbol(String currencyCode) {
  return NumberFormat.simpleCurrency(
    name: currencyCode.isEmpty ? 'USD' : currencyCode,
  ).currencySymbol;
}

DateTime? _tryParseDate(String? value) {
  if (value == null || value.isEmpty) return null;
  return DateTime.tryParse(value);
}

/// `2026-07-02T...` → `Jul 2, 2026`. Returns null when unparseable.
String? formatShortDate(String? isoDate) {
  final parsed = _tryParseDate(isoDate);
  if (parsed == null) return null;
  return DateFormat.yMMMd().format(parsed.toLocal());
}

/// Compact trip date range: `Jun 3 – Jun 9, 2026`, or a single date when only
/// one bound is present. Returns null when neither is set.
String? formatDateRange(String? startDate, String? endDate) {
  final start = _tryParseDate(startDate);
  final end = _tryParseDate(endDate);
  if (start == null && end == null) return null;
  if (start != null && end != null) {
    final startLabel = DateFormat.MMMd().format(start);
    final endLabel = DateFormat.yMMMd().format(end);
    return '$startLabel – $endLabel';
  }
  return DateFormat.yMMMd().format((start ?? end)!);
}

/// First word of a display name, for compact chips ("Hunter Adam" → "Hunter").
String firstName(String displayName) {
  final trimmed = displayName.trim();
  if (trimmed.isEmpty) return '?';
  return trimmed.split(RegExp(r'\s+')).first;
}
