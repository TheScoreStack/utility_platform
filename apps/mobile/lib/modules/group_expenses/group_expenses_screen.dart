import 'package:flutter/material.dart';

import '../../app_config.dart';
import '../../core/api_client.dart';
import '../../core/auth_service.dart';
import 'screens/trip_list_screen.dart';

/// Module entry point. Authentication is handled by the app-level RootGate
/// before the hub is reachable, so this goes straight to the trips.
class GroupExpensesScreen extends StatefulWidget {
  /// When set (universal link), the trips screen opens the join sheet with
  /// this invite prefilled.
  final String? initialInviteId;

  const GroupExpensesScreen({super.key, this.initialInviteId});

  @override
  State<GroupExpensesScreen> createState() => _GroupExpensesScreenState();
}

class _GroupExpensesScreenState extends State<GroupExpensesScreen> {
  late final ApiClient _api;

  @override
  void initState() {
    super.initState();
    _api = ApiClient(
      baseUrl: AppConfig.apiBaseUrl,
      tokenProvider: AuthService.instance.getToken,
    );
  }

  @override
  Widget build(BuildContext context) {
    // Sign-out pops back to the RootGate's sign-in via the auth hub event.
    return TripListScreen(
      api: _api,
      onSignOut: AuthService.instance.signOut,
      initialInviteId: widget.initialInviteId,
    );
  }
}
