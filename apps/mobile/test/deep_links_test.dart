import 'package:flutter_test/flutter_test.dart';
import 'package:platform_mobile/core/deep_links.dart';

void main() {
  group('inviteIdFromUri', () {
    test('parses the web join URL', () {
      expect(
        inviteIdFromUri(
          Uri.parse('https://thestackcore.com/group-expenses/join/inv_abc123'),
        ),
        'inv_abc123',
      );
    });

    test('accepts www and query strings', () {
      expect(
        inviteIdFromUri(
          Uri.parse(
            'https://www.thestackcore.com/group-expenses/join/xyz?utm=1',
          ),
        ),
        'xyz',
      );
    });

    test('rejects other hosts', () {
      expect(
        inviteIdFromUri(Uri.parse('https://evil.com/group-expenses/join/xyz')),
        isNull,
      );
    });

    test('rejects non-join paths and missing ids', () {
      expect(
        inviteIdFromUri(Uri.parse('https://thestackcore.com/group-expenses')),
        isNull,
      );
      expect(
        inviteIdFromUri(
          Uri.parse('https://thestackcore.com/group-expenses/join/'),
        ),
        isNull,
      );
    });
  });
}
