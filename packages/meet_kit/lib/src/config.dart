import 'package:flutter/material.dart';

/// Host-app injected configuration. meet_kit has no dependency on any
/// specific app: the host provides the API origin, an auth token resolver,
/// and the web origin used to build share links.
class MeetKitConfig {
  /// Backend origin, e.g. `https://xyz.execute-api.us-east-1.amazonaws.com`.
  /// Authed routes are requested under `/meet/...`, public ones under
  /// `/meet-public/...`.
  final String apiBaseUrl;

  /// Resolves a bearer token for authed routes (e.g. a Cognito access
  /// token). Leave null for guest-only embedding — authed calls then fail
  /// with a 401 [MeetApiException].
  final Future<String?> Function()? getAuthToken;

  /// Base of the public respond page, e.g. `https://thestackcore.com/m/`.
  /// The event slug is appended to build share links.
  final String shareBaseUrl;

  /// Optional accent override; defaults to the host theme's primary color.
  final Color? accentColor;

  /// Optional native-share hook (e.g. share_plus in the host app). When
  /// provided, share buttons appear next to copy-link actions.
  final void Function(String url)? onShareLink;

  const MeetKitConfig({
    required this.apiBaseUrl,
    this.getAuthToken,
    required this.shareBaseUrl,
    this.accentColor,
    this.onShareLink,
  });

  /// Full share URL for an event slug.
  String shareUrlFor(String slug) =>
      shareBaseUrl.endsWith('/') ? '$shareBaseUrl$slug' : '$shareBaseUrl/$slug';

  /// Effective accent color given the ambient theme.
  Color accentOf(BuildContext context) =>
      accentColor ?? Theme.of(context).colorScheme.primary;
}
