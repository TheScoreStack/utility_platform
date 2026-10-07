import 'package:flutter/material.dart';

import '../../../../core/app_theme.dart';

/// Step titles, in order. The indicator and the shell both read these.
const addTripStepTitles = ['Where', 'When', 'Who', 'Details'];

String twoDigits(int n) => n.toString().padLeft(2, '0');

/// Eyebrow header between groups inside a step ("STOPS", "LEGS").
class StepSection extends StatelessWidget {
  final String label;
  final Widget? trailing;

  const StepSection(this.label, {super.key, this.trailing});

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(0, 20, 0, 10),
    child: Row(
      children: [
        Text(label.toUpperCase(), style: kEyebrow),
        const Spacer(),
        ?trailing,
      ],
    ),
  );
}
