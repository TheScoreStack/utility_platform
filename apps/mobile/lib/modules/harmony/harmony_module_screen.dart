import 'package:flutter/material.dart';

import '../../app_config.dart';
import '../../core/api_client.dart';
import '../../core/auth_service.dart';
import 'harmony_api.dart';
import 'models/harmony_models.dart';
import 'screens/harmony_home_screen.dart';

/// Module entry point. Auth is handled by the app-level RootGate; this gates
/// on ledger access (`GET /harmony-ledger/access`), mirroring the web app.
class HarmonyModuleScreen extends StatefulWidget {
  const HarmonyModuleScreen({super.key});

  @override
  State<HarmonyModuleScreen> createState() => _HarmonyModuleScreenState();
}

class _HarmonyModuleScreenState extends State<HarmonyModuleScreen> {
  late final HarmonyApi _api;
  late Future<HarmonyAccess> _accessFuture;

  @override
  void initState() {
    super.initState();
    _api = HarmonyApi(
      ApiClient(
        baseUrl: AppConfig.apiBaseUrl,
        tokenProvider: AuthService.instance.getToken,
      ),
    );
    _accessFuture = _api.getAccess();
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<HarmonyAccess>(
      future: _accessFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        if (snapshot.hasError) {
          return _message(
            icon: Icons.cloud_off_rounded,
            title: 'Could not reach the ledger',
            body: snapshot.error is ApiException
                ? (snapshot.error as ApiException).message
                : 'Check your connection and try again.',
            retry: () => setState(() => _accessFuture = _api.getAccess()),
          );
        }
        final access = snapshot.data;
        if (access == null || !access.allowed) {
          return _message(
            icon: Icons.lock_outline_rounded,
            title: 'Private ledger',
            body:
                'Harmony Collective is invite-only. Ask an admin to add your '
                'account, then come back.',
          );
        }
        return HarmonyHomeScreen(api: _api);
      },
    );
  }

  Widget _message({
    required IconData icon,
    required String title,
    required String body,
    VoidCallback? retry,
  }) {
    return Scaffold(
      appBar: AppBar(title: const Text('Harmony Collective')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 44, color: Colors.white38),
              const SizedBox(height: 12),
              Text(title, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 6),
              Text(
                body,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white70),
              ),
              if (retry != null) ...[
                const SizedBox(height: 14),
                OutlinedButton(onPressed: retry, child: const Text('Retry')),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
