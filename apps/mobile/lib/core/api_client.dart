import 'dart:convert';

import 'package:http/http.dart' as http;

/// Mirrors the web app's `ApiError` (`apps/web/src/lib/api.ts`): the API
/// returns error bodies shaped like `{ "message": "..." }`.
class ApiException implements Exception {
  final String message;
  final int statusCode;

  const ApiException(this.message, this.statusCode);

  @override
  String toString() => message;
}

/// Thin JSON client for the shared backend. Every request carries a Cognito
/// bearer token resolved through [tokenProvider].
class ApiClient {
  final String baseUrl;
  final Future<String?> Function() tokenProvider;
  final http.Client _http;

  ApiClient({
    required this.baseUrl,
    required this.tokenProvider,
    http.Client? httpClient,
  }) : _http = httpClient ?? http.Client();

  Future<dynamic> get(String path) => _request('GET', path);

  Future<dynamic> post(String path, [Object? body]) =>
      _request('POST', path, body: body);

  Future<dynamic> patch(String path, [Object? body]) =>
      _request('PATCH', path, body: body);

  Future<dynamic> delete(String path, [Object? body]) =>
      _request('DELETE', path, body: body);

  /// Uploads raw bytes to an absolute (presigned) URL. No auth header — the
  /// URL itself is signed — and the Content-Type must match the presign.
  Future<void> putBytes(
    String url,
    List<int> bytes, {
    required String contentType,
  }) async {
    final response = await _http.put(
      Uri.parse(url),
      headers: {'Content-Type': contentType},
      body: bytes,
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException(
        'Upload failed (${response.statusCode})',
        response.statusCode,
      );
    }
  }

  Uri _buildUri(String path) {
    if (path.startsWith('http')) return Uri.parse(path);
    return Uri.parse('$baseUrl$path');
  }

  Future<dynamic> _request(String method, String path, {Object? body}) async {
    final token = await tokenProvider();
    if (token == null || token.isEmpty) {
      throw const ApiException('Unable to resolve auth token', 401);
    }

    final headers = <String, String>{'Authorization': 'Bearer $token'};
    String? encodedBody;
    if (body != null) {
      headers['Content-Type'] = 'application/json';
      encodedBody = jsonEncode(body);
    }

    final request = http.Request(method, _buildUri(path))
      ..headers.addAll(headers);
    if (encodedBody != null) {
      request.body = encodedBody;
    }

    final streamed = await _http.send(request);
    final response = await http.Response.fromStream(streamed);

    if (response.statusCode == 204) {
      return null;
    }

    final text = response.body;
    dynamic data;
    if (text.isNotEmpty) {
      try {
        data = jsonDecode(text);
      } catch (_) {
        data = null;
      }
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = data is Map<String, dynamic>
          ? data['message'] as String?
          : null;
      throw ApiException(
        message ?? 'Request failed (${response.statusCode})',
        response.statusCode,
      );
    }

    return data;
  }
}
