import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/services.dart';

import '../app_config.dart';
import 'api_client.dart';

/// Registers this device for push notifications and stores the token
/// server-side. iOS goes through the hand-rolled APNs channel in
/// AppDelegate; Android goes through Firebase Messaging (FCM). Everything
/// is best-effort — the app never blocks or errors over pushes.
class PushService {
  PushService._();

  static final PushService instance = PushService._();

  static const _iosChannel = MethodChannel('stackcore/push');

  String? _registeredToken;
  String? _registeredPlatform;
  bool _attemptedThisRun = false;
  bool _tapHandlersInstalled = false;

  /// Called with a tripId when the user taps a notification. Set by the
  /// trip list screen, which owns navigation.
  void Function(String tripId)? onOpenTrip;

  /// Installs tap handlers and drains any notification that launched the
  /// app. Safe to call repeatedly; call after [onOpenTrip] is set.
  Future<void> attachTapHandlers() async {
    if (_tapHandlersInstalled || kIsWeb) return;
    _tapHandlersInstalled = true;
    try {
      if (Platform.isIOS) {
        _iosChannel.setMethodCallHandler((call) async {
          if (call.method == 'onNotificationTap') {
            final tripId = call.arguments as String?;
            if (tripId != null && tripId.isNotEmpty) onOpenTrip?.call(tripId);
          }
          return null;
        });
        final launchTripId = await _iosChannel.invokeMethod<String>(
          'getLaunchTripId',
        );
        if (launchTripId != null && launchTripId.isNotEmpty) {
          onOpenTrip?.call(launchTripId);
        }
      } else if (Platform.isAndroid && AppConfig.firebaseAndroidConfigured) {
        await _ensureFirebase();
        FirebaseMessaging.onMessageOpenedApp.listen((message) {
          final tripId = message.data['tripId'];
          if (tripId is String && tripId.isNotEmpty) onOpenTrip?.call(tripId);
        });
        final initial = await FirebaseMessaging.instance.getInitialMessage();
        final tripId = initial?.data['tripId'];
        if (tripId is String && tripId.isNotEmpty) onOpenTrip?.call(tripId);
      }
    } catch (_) {
      // Deep links are polish — never let them break startup.
    }
  }

  Future<void> register(ApiClient api) async {
    if (_attemptedThisRun || kIsWeb) return;
    _attemptedThisRun = true;
    try {
      final (token, platform) = await _fetchToken();
      if (token == null || token.isEmpty) return;
      await api.post('/devices', {'token': token, 'platform': platform});
      _registeredToken = token;
      _registeredPlatform = platform;
    } catch (_) {
      // Simulator, declined permission, or offline — all fine.
    }
  }

  Future<void> _ensureFirebase() async {
    if (Firebase.apps.isNotEmpty) return;
    await Firebase.initializeApp(
      options: const FirebaseOptions(
        apiKey: AppConfig.firebaseAndroidApiKey,
        appId: AppConfig.firebaseAndroidAppId,
        messagingSenderId: AppConfig.firebaseMessagingSenderId,
        projectId: AppConfig.firebaseProjectId,
      ),
    );
  }

  Future<(String?, String)> _fetchToken() async {
    if (Platform.isIOS) {
      final token = await _iosChannel.invokeMethod<String>('requestToken');
      return (token, 'ios');
    }
    if (Platform.isAndroid && AppConfig.firebaseAndroidConfigured) {
      // Initialized from baked-in public config — no google-services.json
      // or Gradle plugin needed.
      await _ensureFirebase();
      final messaging = FirebaseMessaging.instance;
      final settings = await messaging.requestPermission();
      if (settings.authorizationStatus == AuthorizationStatus.denied) {
        return (null, 'android');
      }
      return (await messaging.getToken(), 'android');
    }
    return (null, 'unsupported');
  }

  /// Stops pushes to this device (call on sign-out).
  Future<void> unregister(ApiClient api) async {
    final token = _registeredToken;
    final platform = _registeredPlatform;
    _registeredToken = null;
    _registeredPlatform = null;
    _attemptedThisRun = false;
    if (token == null) return;
    try {
      await api.delete('/devices/${Uri.encodeComponent(token)}');
      if (platform == 'android' && Firebase.apps.isNotEmpty) {
        await FirebaseMessaging.instance.deleteToken();
      }
    } catch (_) {
      // Stale endpoints get cleaned up server-side on the next failed send.
    }
  }
}
