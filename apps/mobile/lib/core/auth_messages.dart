/// Pure helpers for the auth flows: the password-policy validator (mirrors
/// the Cognito pool policy in infra/src/stacks/group-expenses-stack.ts) and
/// the Amplify-exception → friendly-message mapping. No Amplify imports so
/// both are unit-testable.
library;

/// Human hint shown next to password fields.
const String kPasswordRequirementsHint =
    '8+ characters with an uppercase letter and a number';

/// Returns null when [password] satisfies the Cognito policy (min 8,
/// uppercase, lowercase, digit — symbols not required), otherwise the first
/// unmet requirement as a friendly message.
String? passwordRequirementError(String password) {
  if (password.length < 8) {
    return 'Use at least 8 characters.';
  }
  if (!password.contains(RegExp('[A-Z]'))) {
    return 'Add an uppercase letter.';
  }
  if (!password.contains(RegExp('[a-z]'))) {
    return 'Add a lowercase letter.';
  }
  if (!password.contains(RegExp('[0-9]'))) {
    return 'Add a number.';
  }
  return null;
}

bool passwordMeetsRequirements(String password) =>
    passwordRequirementError(password) == null;

/// Maps a Cognito/Amplify exception *type name* to a friendly message, or
/// null when there is no specific mapping. Kept string-based so it stays a
/// pure function (see [friendlyAuthMessageFor] tests).
String? friendlyAuthMessageFor(String exceptionTypeName) {
  if (exceptionTypeName.contains('UsernameExists')) {
    return 'An account with this email already exists. Try signing in.';
  }
  if (exceptionTypeName.contains('AliasExists')) {
    return 'An account with this email already exists. Try signing in.';
  }
  if (exceptionTypeName.contains('CodeMismatch')) {
    return 'That code isn’t right — double-check and try again.';
  }
  if (exceptionTypeName.contains('ExpiredCode')) {
    return 'That code has expired. Request a new one.';
  }
  if (exceptionTypeName.contains('CodeDeliveryFailure')) {
    return 'Couldn’t send the code. Check the email address.';
  }
  if (exceptionTypeName.contains('InvalidPassword')) {
    return 'Passwords need $kPasswordRequirementsHint.';
  }
  if (exceptionTypeName.contains('LimitExceeded') ||
      exceptionTypeName.contains('TooManyRequests')) {
    return 'Too many attempts. Wait a few minutes and try again.';
  }
  if (exceptionTypeName.contains('UserNotFound')) {
    return 'No account found with that email.';
  }
  if (exceptionTypeName.contains('UserNotConfirmed')) {
    return 'This account isn’t confirmed yet. Check your email for the code.';
  }
  if (exceptionTypeName.contains('NotAuthorized')) {
    return 'Incorrect email or password.';
  }
  if (exceptionTypeName.contains('Network')) {
    return 'No connection. Check your network and try again.';
  }
  return null;
}
