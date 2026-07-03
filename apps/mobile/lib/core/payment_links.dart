/// Dart port of `apps/web/src/lib/paymentLinks.ts`.
///
/// Builds "tap to pay" web links from a member's stored payment handles.
/// Returns null when the method has no universal link (e.g. Zelle) so the
/// caller can fall back to copy-to-clipboard.
library;

String? buildPaymentLink(
  String method,
  String value, {
  double? amount,
  String? currency,
  String? note,
}) {
  final handle = value.trim().replaceFirst(RegExp(r'^@'), '');
  if (handle.isEmpty) return null;

  if (method == 'venmo') {
    // Match the web's URLSearchParams behavior (space → '+').
    final params = <String, String>{'txn': 'pay'};
    // Venmo is USD-only; don't prefill a number that's in another currency.
    if (amount != null &&
        amount > 0 &&
        (currency == null || currency.toUpperCase() == 'USD')) {
      params['amount'] = amount.toStringAsFixed(2);
    }
    if (note != null && note.isNotEmpty) {
      params['note'] = note;
    }
    final query = params.entries
        .map(
          (entry) =>
              '${Uri.encodeQueryComponent(entry.key)}='
              '${Uri.encodeQueryComponent(entry.value)}',
        )
        .join('&');
    return 'https://venmo.com/${Uri.encodeComponent(handle)}?$query';
  }

  if (method == 'paypal') {
    // Accept either a bare handle or a pasted paypal.me URL.
    const marker = 'paypal.me/';
    final afterHost = handle.contains(marker)
        ? handle.substring(handle.indexOf(marker) + marker.length)
        : handle;
    final user = afterHost.split('/').first.trim();
    if (user.isEmpty) return null;
    if (amount != null && amount > 0) {
      final currencySuffix = currency != null && currency.toUpperCase() != 'USD'
          ? currency.toUpperCase()
          : '';
      return 'https://paypal.me/${Uri.encodeComponent(user)}/'
          '${amount.toStringAsFixed(2)}$currencySuffix';
    }
    return 'https://paypal.me/${Uri.encodeComponent(user)}';
  }

  return null;
}
