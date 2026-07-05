import 'package:flutter/services.dart';

import 'api_client.dart';

/// Registers this device for push notifications: asks iOS for permission,
/// fetches the APNs token via the platform channel in AppDelegate, and
/// stores it server-side. Everything is best-effort — the app never blocks
/// or errors over pushes.
class PushService {
  PushService._();

  static final PushService instance = PushService._();

  static const _channel = MethodChannel('stackcore/push');

  String? _registeredToken;
  bool _attemptedThisRun = false;

  Future<void> register(ApiClient api) async {
    if (_attemptedThisRun) return;
    _attemptedThisRun = true;
    try {
      final token = await _channel.invokeMethod<String>('requestToken');
      if (token == null || token.isEmpty) return;
      await api.post('/devices', {'token': token, 'platform': 'ios'});
      _registeredToken = token;
    } catch (_) {
      // Simulator, declined permission, or offline — all fine.
    }
  }

  /// Stops pushes to this device (call on sign-out).
  Future<void> unregister(ApiClient api) async {
    final token = _registeredToken;
    _registeredToken = null;
    _attemptedThisRun = false;
    if (token == null) return;
    try {
      await api.delete('/devices/$token');
    } catch (_) {
      // Stale endpoints get cleaned up server-side on the next failed send.
    }
  }
}
