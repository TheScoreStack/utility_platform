import 'package:flutter_test/flutter_test.dart';
import 'package:platform_mobile/core/payment_links.dart';

void main() {
  group('buildPaymentLink', () {
    test('venmo USD includes the amount and strips a leading @', () {
      expect(
        buildPaymentLink(
          'venmo',
          '@alice',
          amount: 12.5,
          currency: 'USD',
          note: 'Trip dinner',
        ),
        'https://venmo.com/alice?txn=pay&amount=12.50&note=Trip+dinner',
      );
    });

    test('venmo omits the amount for non-USD currencies', () {
      expect(
        buildPaymentLink('venmo', 'alice', amount: 12.5, currency: 'EUR'),
        'https://venmo.com/alice?txn=pay',
      );
    });

    test('paypal USD appends the amount with no currency suffix', () {
      expect(
        buildPaymentLink('paypal', 'bob', amount: 20, currency: 'USD'),
        'https://paypal.me/bob/20.00',
      );
    });

    test('paypal accepts a pasted paypal.me URL and adds an EUR suffix', () {
      expect(
        buildPaymentLink(
          'paypal',
          'https://paypal.me/bob',
          amount: 20,
          currency: 'EUR',
        ),
        'https://paypal.me/bob/20.00EUR',
      );
    });

    test('zelle has no universal link and returns null', () {
      expect(buildPaymentLink('zelle', 'bob@example.com', amount: 20), isNull);
    });

    test('blank handles return null', () {
      expect(buildPaymentLink('venmo', '  @  '), isNull);
    });
  });

  group('buildVenmoAppLink', () {
    test('builds the native scheme with recipient, amount, and note', () {
      expect(
        buildVenmoAppLink(
          '@Hunter-Adam-123',
          amount: 58.96,
          currency: 'USD',
          note: 'Settling up: Trip',
        ),
        'venmo://paycharge?txn=pay&recipients=Hunter-Adam-123'
        '&amount=58.96&note=Settling+up%3A+Trip',
      );
    });

    test('omits the amount for non-USD settlements', () {
      expect(
        buildVenmoAppLink('@bob', amount: 10, currency: 'EUR'),
        'venmo://paycharge?txn=pay&recipients=bob',
      );
    });

    test('blank handle returns null', () {
      expect(buildVenmoAppLink('  @  '), isNull);
    });
  });
}
