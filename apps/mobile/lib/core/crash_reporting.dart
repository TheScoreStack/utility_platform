import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/foundation.dart';

import '../app_config.dart';

/// Crash reporting via Firebase Crashlytics. Inert until the Firebase
/// client config for the current platform is baked into AppConfig — the
/// same dark-until-configured pattern as FCM pushes.
class CrashReporting {
  const CrashReporting._();

  static FirebaseOptions? _optionsForPlatform() {
    if (kIsWeb) return null;
    if (Platform.isAndroid && AppConfig.firebaseAndroidConfigured) {
      return const FirebaseOptions(
        apiKey: AppConfig.firebaseAndroidApiKey,
        appId: AppConfig.firebaseAndroidAppId,
        messagingSenderId: AppConfig.firebaseMessagingSenderId,
        projectId: AppConfig.firebaseProjectId,
      );
    }
    if (Platform.isIOS && AppConfig.firebaseIosConfigured) {
      return const FirebaseOptions(
        apiKey: AppConfig.firebaseIosApiKey,
        appId: AppConfig.firebaseIosAppId,
        messagingSenderId: AppConfig.firebaseMessagingSenderId,
        projectId: AppConfig.firebaseProjectId,
      );
    }
    return null;
  }

  /// Call before runApp. Never throws and never blocks startup.
  static Future<void> init() async {
    final options = _optionsForPlatform();
    if (options == null || kDebugMode) return;
    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp(options: options);
      }
      FlutterError.onError =
          FirebaseCrashlytics.instance.recordFlutterFatalError;
      PlatformDispatcher.instance.onError = (error, stack) {
        FirebaseCrashlytics.instance.recordError(error, stack, fatal: true);
        return true;
      };
    } catch (_) {
      // Reporting is best-effort; the app must start regardless.
    }
  }
}
