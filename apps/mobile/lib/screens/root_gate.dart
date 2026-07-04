import 'dart:async';

import 'package:amplify_flutter/amplify_flutter.dart' hide ApiException;
import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';

import '../core/auth_service.dart';
import '../core/deep_links.dart';
import '../modules/group_expenses/group_expenses_screen.dart';
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
  StreamSubscription<Uri>? _linkEvents;

  /// Invite id from a universal link, held until the user is signed in.
  String? _pendingInviteId;

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
        _maybeOpenPendingInvite();
      }
    });
    _watchLinks();
    _bootstrap();
  }

  Future<void> _watchLinks() async {
    final appLinks = AppLinks();
    _linkEvents = appLinks.uriLinkStream.listen(_handleUri);
    // Cold start via a universal link.
    try {
      final initial = await appLinks.getInitialLink();
      if (initial != null) _handleUri(initial);
    } catch (_) {
      // No initial link — normal launch.
    }
  }

  void _handleUri(Uri uri) {
    final inviteId = inviteIdFromUri(uri);
    if (inviteId == null) return;
    _pendingInviteId = inviteId;
    _maybeOpenPendingInvite();
  }

  /// Pushes into Group Expenses with the invite prefilled once we're both
  /// signed in and past the bootstrap check.
  void _maybeOpenPendingInvite() {
    final inviteId = _pendingInviteId;
    if (inviteId == null || !_signedIn || _checking || !mounted) return;
    _pendingInviteId = null;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      Navigator.of(context).popUntil((route) => route.isFirst);
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => GroupExpensesScreen(initialInviteId: inviteId),
        ),
      );
    });
  }

  @override
  void dispose() {
    _authEvents?.cancel();
    _linkEvents?.cancel();
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
      _maybeOpenPendingInvite();
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
