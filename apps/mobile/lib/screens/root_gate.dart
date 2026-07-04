import 'dart:async';

import 'package:amplify_flutter/amplify_flutter.dart' hide ApiException;
import 'package:flutter/material.dart';

import '../core/auth_service.dart';
import '../modules/group_expenses/screens/sign_in_screen.dart';
import '../modules/module_registry.dart';
import 'module_hub.dart';

/// App-level auth gate: sign-in happens at launch, before the module hub.
/// Sign-out, account deletion, and session expiry anywhere in the app pop
/// back here via Amplify's auth hub events.
class RootGate extends StatefulWidget {
  const RootGate({super.key});

  @override
  State<RootGate> createState() => _RootGateState();
}

class _RootGateState extends State<RootGate> {
  bool _checking = true;
  bool _signedIn = false;
  String? _error;
  StreamSubscription<AuthHubEvent>? _authEvents;

  @override
  void initState() {
    super.initState();
    _authEvents = Amplify.Hub.listen(HubChannel.Auth, (AuthHubEvent event) {
      if (!mounted) return;
      if (event.type == AuthHubEventType.signedOut ||
          event.type == AuthHubEventType.userDeleted ||
          event.type == AuthHubEventType.sessionExpired) {
        Navigator.of(context).popUntil((route) => route.isFirst);
        setState(() => _signedIn = false);
      } else if (event.type == AuthHubEventType.signedIn) {
        setState(() => _signedIn = true);
      }
    });
    _bootstrap();
  }

  @override
  void dispose() {
    _authEvents?.cancel();
    super.dispose();
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

  @override
  Widget build(BuildContext context) {
    if (_checking) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (_error != null) {
      return Scaffold(
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
    return ModuleHub(modules: registeredModules);
  }
}
