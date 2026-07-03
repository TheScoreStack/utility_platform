import 'dart:convert';

import 'package:amplify_auth_cognito/amplify_auth_cognito.dart';
// amplify_flutter also exports an `ApiException`; ours (api_client.dart) is
// the one auth flows care about, so hide theirs.
import 'package:amplify_flutter/amplify_flutter.dart' hide ApiException;

import '../app_config.dart';
import 'api_client.dart';
import 'auth_messages.dart';

/// Sign-in completed a step but did not produce a session (e.g. the account
/// still needs confirmation or a new password). Handled like [AuthException].
class AuthFlowException implements Exception {
  final String message;

  const AuthFlowException(this.message);

  @override
  String toString() => message;
}

/// Wraps Amplify Auth so the rest of the app never touches Amplify directly.
/// Configuration is built at runtime from `--dart-define` values (see
/// [AppConfig]); nothing is hardcoded or committed.
class AuthService {
  AuthService._();

  static final AuthService instance = AuthService._();

  bool _configured = false;

  Future<void> configure() async {
    if (_configured || Amplify.isConfigured) {
      _configured = true;
      return;
    }
    await Amplify.addPlugin(AmplifyAuthCognito());
    await Amplify.configure(_buildAmplifyConfig());
    _configured = true;
  }

  static String _buildAmplifyConfig() {
    return jsonEncode({
      'UserAgent': 'aws-amplify-cli/2.0',
      'Version': '1.0',
      'auth': {
        'plugins': {
          'awsCognitoAuthPlugin': {
            'UserAgent': 'aws-amplify-cli/0.1.0',
            'Version': '0.1.0',
            'CognitoUserPool': {
              'Default': {
                'PoolId': AppConfig.userPoolId,
                'AppClientId': AppConfig.userPoolClientId,
                'Region': AppConfig.region,
              },
            },
            'Auth': {
              'Default': {'authenticationFlowType': 'USER_SRP_AUTH'},
            },
          },
        },
      },
    });
  }

  Future<bool> get isSignedIn async {
    final session = await Amplify.Auth.fetchAuthSession();
    return session.isSignedIn;
  }

  Future<void> signIn(String email, String password) async {
    // A stale half-completed session blocks signIn; clear it first.
    final session = await Amplify.Auth.fetchAuthSession();
    if (session.isSignedIn) {
      await Amplify.Auth.signOut();
    }
    final result = await Amplify.Auth.signIn(
      username: email,
      password: password,
    );
    if (!result.isSignedIn) {
      throw AuthFlowException(
        'Additional sign-in steps are required '
        '(${result.nextStep.signInStep.name}). Complete them on the web app first.',
      );
    }
  }

  Future<void> signOut() => Amplify.Auth.signOut();

  /// Registers a new account. The postConfirmation Lambda reads the `name`
  /// standard attribute for the display name (falling back to the email
  /// prefix), so it is sent alongside `email`.
  Future<void> signUp({
    required String email,
    required String password,
    required String name,
  }) {
    return _friendly(() async {
      await Amplify.Auth.signUp(
        username: email,
        password: password,
        options: SignUpOptions(
          userAttributes: {
            AuthUserAttributeKey.email: email,
            AuthUserAttributeKey.name: name,
          },
        ),
      );
    });
  }

  Future<void> confirmSignUp({required String email, required String code}) {
    return _friendly(() async {
      await Amplify.Auth.confirmSignUp(username: email, confirmationCode: code);
    });
  }

  Future<void> resendSignUpCode(String email) {
    return _friendly(() async {
      await Amplify.Auth.resendSignUpCode(username: email);
    });
  }

  Future<void> resetPassword(String email) {
    return _friendly(() async {
      await Amplify.Auth.resetPassword(username: email);
    });
  }

  Future<void> confirmResetPassword({
    required String email,
    required String code,
    required String newPassword,
  }) {
    return _friendly(() async {
      await Amplify.Auth.confirmResetPassword(
        username: email,
        newPassword: newPassword,
        confirmationCode: code,
      );
    });
  }

  Future<void> updatePassword({
    required String oldPassword,
    required String newPassword,
  }) {
    return _friendly(() async {
      await Amplify.Auth.updatePassword(
        oldPassword: oldPassword,
        newPassword: newPassword,
      );
    });
  }

  /// Deletes the account: platform data first (DELETE /profile — idempotent;
  /// shared trip history intentionally survives so balances stay coherent),
  /// then the Cognito user. If the Cognito step fails, rerunning the whole
  /// pair is safe.
  Future<void> deleteAccount(ApiClient api) async {
    await api.delete('/profile');
    await _friendly(() => Amplify.Auth.deleteUser());
  }

  /// Runs [action], rethrowing Amplify failures as [AuthFlowException] with a
  /// friendly message (see auth_messages.dart for the mapping).
  Future<void> _friendly(Future<void> Function() action) async {
    try {
      await action();
    } on AuthException catch (error) {
      final mapped = friendlyAuthMessageFor(error.runtimeType.toString());
      throw AuthFlowException(mapped ?? error.message);
    }
  }

  /// Friendly message for any error thrown by this service or Amplify.
  static String describeError(Object error) {
    if (error is AuthFlowException) return error.message;
    if (error is AuthException) {
      return friendlyAuthMessageFor(error.runtimeType.toString()) ??
          error.message;
    }
    if (error is ApiException) return error.message;
    return 'Something went wrong. Please try again.';
  }

  /// Resolves the Cognito ID token (preferred) or access token for API calls.
  Future<String?> getToken() async {
    final session = await Amplify.Auth.fetchAuthSession();
    if (session is CognitoAuthSession) {
      final tokens = session.userPoolTokensResult.valueOrNull;
      return tokens?.idToken.raw ?? tokens?.accessToken.raw;
    }
    return null;
  }
}
