import 'dart:async';

import 'package:flutter/services.dart';

/// A file shared into the app from the OS share sheet / open-with flow.
/// [path] points at a staged copy owned by the app.
class SharedFile {
  final String path;
  final String name;

  const SharedFile({required this.path, required this.name});
}

/// Bridges the native `stackcore/share` channel (see AppDelegate.swift and
/// MainActivity.kt): live events stream through [files]; a file that arrived
/// before Dart attached is drained once via [drainLaunchFile].
class ShareService {
  ShareService._();

  static final ShareService instance = ShareService._();

  static const _channel = MethodChannel('stackcore/share');
  final _controller = StreamController<SharedFile>.broadcast();
  bool _initialized = false;

  Stream<SharedFile> get files => _controller.stream;

  void init() {
    if (_initialized) return;
    _initialized = true;
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'onSharedFile') {
        final file = _parse(call.arguments);
        if (file != null) _controller.add(file);
      }
      return null;
    });
  }

  /// File shared while the app was cold-starting, if any.
  Future<SharedFile?> drainLaunchFile() async {
    try {
      final data = await _channel.invokeMethod<dynamic>('getLaunchSharedFile');
      return _parse(data);
    } catch (_) {
      return null;
    }
  }

  SharedFile? _parse(dynamic data) {
    if (data is! Map) return null;
    final path = data['path'] as String?;
    final name = data['name'] as String?;
    if (path == null || path.isEmpty) return null;
    return SharedFile(path: path, name: name ?? path.split('/').last);
  }
}

/// What kind of statement/receipt file this is, from the file name.
enum SharedFileKind { pdf, csv, image, unsupported }

SharedFileKind sharedFileKindOf(String fileName) {
  final lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return SharedFileKind.pdf;
  if (lower.endsWith('.csv')) return SharedFileKind.csv;
  for (final ext in const ['.jpg', '.jpeg', '.png', '.webp', '.gif']) {
    if (lower.endsWith(ext)) return SharedFileKind.image;
  }
  return SharedFileKind.unsupported;
}

String sharedFileContentType(SharedFileKind kind, String fileName) {
  switch (kind) {
    case SharedFileKind.pdf:
      return 'application/pdf';
    case SharedFileKind.csv:
      return 'text/csv';
    case SharedFileKind.image:
      final lower = fileName.toLowerCase();
      if (lower.endsWith('.png')) return 'image/png';
      if (lower.endsWith('.webp')) return 'image/webp';
      if (lower.endsWith('.gif')) return 'image/gif';
      return 'image/jpeg';
    case SharedFileKind.unsupported:
      return 'application/octet-stream';
  }
}
