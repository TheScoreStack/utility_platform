import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:platform_mobile/modules/module_registry.dart';
import 'package:platform_mobile/screens/module_hub.dart';

void main() {
  testWidgets('renders the module catalog', (tester) async {
    // The app root is now an auth gate (RootGate) that needs Amplify, which
    // isn't available in widget tests — exercise the hub directly.
    await tester.pumpWidget(
      MaterialApp(home: ModuleHub(modules: registeredModules)),
    );

    expect(find.text('The Stack Core'), findsOneWidget);
    expect(find.text('Group Expenses'), findsOneWidget);
  });
}
