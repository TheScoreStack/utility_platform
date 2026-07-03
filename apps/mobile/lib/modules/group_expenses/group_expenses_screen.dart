import 'package:flutter/material.dart';

import '../../app_config.dart';
import '../../core/api_client.dart';
import '../../core/auth_service.dart';
import 'screens/sign_in_screen.dart';
import 'screens/trip_list_screen.dart';

/// Module entry point: configures Amplify, then routes to either the sign-in
/// screen or the trip list depending on the current session.
class GroupExpensesScreen extends StatefulWidget {
  const GroupExpensesScreen({super.key});

  @override
  State<GroupExpensesScreen> createState() => _GroupExpensesScreenState();
}

class _GroupExpensesScreenState extends State<GroupExpensesScreen> {
  late final ApiClient _api;
  bool _checking = true;
  bool _signedIn = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _api = ApiClient(
      baseUrl: AppConfig.apiBaseUrl,
      tokenProvider: AuthService.instance.getToken,
    );
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    setState(() {
      _checking = true;
      _error = null;
    });
    try {
      await AuthService.instance.configure();
      final signedIn = await AuthService.instance.isSignedIn;
      if (!mounted) return;
      setState(() {
        _signedIn = signedIn;
        _checking = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not start the session. Check your connection.';
        _checking = false;
      });
    }
  }

  Future<void> _handleSignOut() async {
    await AuthService.instance.signOut();
    if (!mounted) return;
    setState(() => _signedIn = false);
  }

  @override
  Widget build(BuildContext context) {
    if (_checking) {
      return Scaffold(
        appBar: AppBar(title: const Text('Group Expenses'), centerTitle: false),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    if (_error != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Group Expenses'), centerTitle: false),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.cloud_off_rounded,
                  size: 40,
                  color: Colors.white38,
                ),
                const SizedBox(height: 12),
                Text(
                  _error!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white70),
                ),
                const SizedBox(height: 16),
                OutlinedButton.icon(
                  onPressed: _bootstrap,
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text('Try again'),
                ),
              ],
            ),
          ),
        ),
      );
    }
    if (!_signedIn) {
      return SignInScreen(onSignedIn: () => setState(() => _signedIn = true));
    }
    return TripListScreen(api: _api, onSignOut: _handleSignOut);
  }
}
