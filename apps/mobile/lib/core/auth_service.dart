import 'dart:convert';

import 'package:amplify_auth_cognito/amplify_auth_cognito.dart';
import 'package:amplify_flutter/amplify_flutter.dart';

import '../app_config.dart';

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
