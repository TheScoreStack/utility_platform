import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:meet_kit/meet_kit.dart';

void main() {
  testWidgets('timezone default is labeled as detected and editable',
      (tester) async {
    tester.view.physicalSize = const Size(800, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final api = MeetApiClient(baseUrl: 'https://api.test');
    await tester.pumpWidget(MaterialApp(home: MeetCreateScreen(api: api)));

    // The device-timezone guess is presented as an explicit "(detected)"
    // choice in the picker rather than a silent default.
    expect(find.textContaining('(detected)'), findsWidgets);
    expect(find.textContaining('Detected from this device'), findsOneWidget);
  });
}
