import 'package:flutter_test/flutter_test.dart';
import 'package:platform_mobile/modules/group_expenses/widgets/payment_methods_sheet.dart';

void main() {
  group('normalizePaymentHandle', () {
    test('strips @ from venmo usernames', () {
      expect(normalizePaymentHandle('venmo', '@hunter'), 'hunter');
    });

    test('extracts handle from pasted venmo profile links', () {
      expect(
        normalizePaymentHandle('venmo', 'https://venmo.com/@hunter'),
        'hunter',
      );
      expect(
        normalizePaymentHandle('venmo', 'https://account.venmo.com/u/hunter'),
        'hunter',
      );
      expect(normalizePaymentHandle('venmo', 'venmo.com/hunter'), 'hunter');
    });

    test('drops query strings and trailing paths', () {
      expect(
        normalizePaymentHandle('venmo', 'https://venmo.com/hunter?txn=pay'),
        'hunter',
      );
    });

    test('extracts handle from paypal.me links', () {
      expect(
        normalizePaymentHandle('paypal', 'https://paypal.me/hunter'),
        'hunter',
      );
      expect(
        normalizePaymentHandle('paypal', 'paypal.com/paypalme/hunter'),
        'hunter',
      );
      expect(normalizePaymentHandle('paypal', 'hunter'), 'hunter');
    });

    test('leaves zelle emails and phones untouched', () {
      expect(
        normalizePaymentHandle('zelle', ' hunter@mail.com '),
        'hunter@mail.com',
      );
      expect(normalizePaymentHandle('zelle', '555-123-4567'), '555-123-4567');
    });

    test('returns null for blank input', () {
      expect(normalizePaymentHandle('venmo', '  '), isNull);
    });
  });
}
