import 'package:flutter_test/flutter_test.dart';
import 'package:platform_mobile/core/auth_messages.dart';

void main() {
  group('passwordRequirementError', () {
    test('accepts a password meeting the Cognito policy', () {
      expect(passwordRequirementError('Passw0rd'), isNull);
      expect(passwordMeetsRequirements('Longer Passw0rd!'), isTrue);
    });

    test('rejects short passwords first', () {
      expect(passwordRequirementError('Ab1'), 'Use at least 8 characters.');
    });

    test('requires an uppercase letter', () {
      expect(passwordRequirementError('password1'), 'Add an uppercase letter.');
    });

    test('requires a lowercase letter', () {
      expect(passwordRequirementError('PASSWORD1'), 'Add a lowercase letter.');
    });

    test('requires a digit', () {
      expect(passwordRequirementError('Password'), 'Add a number.');
      expect(passwordMeetsRequirements('Password'), isFalse);
    });

    test('does not require symbols', () {
      expect(passwordRequirementError('NoSymbols123'), isNull);
    });
  });

  group('friendlyAuthMessageFor', () {
    test('maps existing-account errors', () {
      expect(
        friendlyAuthMessageFor('UsernameExistsException'),
        'An account with this email already exists. Try signing in.',
      );
    });

    test('maps wrong and expired codes distinctly', () {
      expect(
        friendlyAuthMessageFor('CodeMismatchException'),
        contains('code isn’t right'),
      );
      expect(
        friendlyAuthMessageFor('ExpiredCodeException'),
        contains('expired'),
      );
    });

    test('maps weak passwords to the requirements hint', () {
      expect(
        friendlyAuthMessageFor('InvalidPasswordException'),
        contains(kPasswordRequirementsHint),
      );
    });

    test('maps throttling', () {
      expect(
        friendlyAuthMessageFor('LimitExceededException'),
        contains('Too many attempts'),
      );
      expect(
        friendlyAuthMessageFor('TooManyRequestsException'),
        contains('Too many attempts'),
      );
    });

    test('maps credential and lookup failures', () {
      expect(
        friendlyAuthMessageFor('NotAuthorizedServiceException'),
        'Incorrect email or password.',
      );
      expect(
        friendlyAuthMessageFor('UserNotFoundException'),
        'No account found with that email.',
      );
    });

    test('returns null for unmapped types so callers can fall back', () {
      expect(friendlyAuthMessageFor('SomethingUnexpectedException'), isNull);
    });
  });
}
