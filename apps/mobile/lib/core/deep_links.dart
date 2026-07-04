/// Extracts a trip invite id from a universal link.
///
/// Accepts the web app's join URLs — `/group-expenses/join/<id>` (with or
/// without the module prefix) on thestackcore.com — and returns null for
/// anything else.
String? inviteIdFromUri(Uri uri) {
  final host = uri.host.toLowerCase();
  if (host != 'thestackcore.com' && host != 'www.thestackcore.com') {
    return null;
  }
  final segments = uri.pathSegments;
  final joinIndex = segments.indexOf('join');
  if (joinIndex < 0 || joinIndex + 1 >= segments.length) return null;
  final inviteId = segments[joinIndex + 1].trim();
  return inviteId.isEmpty ? null : inviteId;
}
