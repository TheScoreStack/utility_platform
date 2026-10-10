import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:platform_mobile/core/api_client.dart';
import 'package:platform_mobile/modules/atlas/atlas_api.dart';

void main() {
  // Regression: the server answers {"profile": {...}}; reading that wrapper
  // as the profile dropped a newly picked home right after saving it.
  test('updateProfile reads the profile out of the response', () async {
    final api = AtlasApi(
      ApiClient(
        baseUrl: 'https://example.test',
        tokenProvider: () async => 'token',
        httpClient: MockClient(
          (request) async => http.Response(
            jsonEncode({
              'profile': {
                'units': 'mi',
                'homePlace': {
                  'providerId': 'p_sf',
                  'name': 'San Francisco',
                  'kind': 'city',
                  'countryCode': 'US',
                  'lat': 37.77,
                  'lng': -122.42,
                },
              },
            }),
            200,
          ),
        ),
      ),
    );
    final profile = await api.updateProfile({'units': 'mi'});
    expect(profile.homePlace?.name, 'San Francisco');
  });
}
