import 'package:flutter/material.dart';

import '../../../../core/app_theme.dart';

/// The add-trip step row: numbered pills joined by thin connectors, so it
/// reads as a sequence and each step obviously looks like a button.
///
/// Pills share the width in proportion to their label length, and a label
/// scales down rather than overflow when space runs out (narrow phones,
/// large text).
class AtlasStepIndicator extends StatelessWidget {
  final List<String> titles;
  final int current;

  /// Whether step [index] can be jumped to. Locked pills are dimmed and
  /// don't respond to taps.
  final bool Function(int index) isEnabled;

  /// Whether step [index] has its data filled in. Only complete steps get
  /// a check; a skipped step keeps its number so it stands out.
  final bool Function(int index) isComplete;
  final ValueChanged<int> onSelect;

  const AtlasStepIndicator({
    super.key,
    required this.titles,
    required this.current,
    required this.isEnabled,
    required this.isComplete,
    required this.onSelect,
  });

  /// Pill height plus vertical padding, for the AppBar's `bottom`.
  static const double height = 54;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 2, 12, 12),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Row(
            children: [
              for (var i = 0; i < titles.length; i++) ...[
                if (i > 0) _Connector(lit: i <= current),
                Expanded(
                  flex: titles[i].length + 6,
                  child: _StepPill(
                    index: i,
                    count: titles.length,
                    title: titles[i],
                    state: i == current
                        ? _PillState.current
                        : !isEnabled(i)
                        ? _PillState.locked
                        : isComplete(i)
                        ? _PillState.done
                        : _PillState.upcoming,
                    onTap: () => onSelect(i),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

enum _PillState { current, done, upcoming, locked }

class _StepPill extends StatelessWidget {
  final int index;
  final int count;
  final String title;
  final _PillState state;
  final VoidCallback onTap;

  const _StepPill({
    required this.index,
    required this.count,
    required this.title,
    required this.state,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final current = state == _PillState.current;
    final done = state == _PillState.done;
    final locked = state == _PillState.locked;
    final labelColor = current || done ? Colors.white : Colors.white70;
    final outline = current
        ? BorderSide.none
        : BorderSide(
            color: done ? AppColors.accent : Colors.white24,
            width: done ? 1.5 : 1,
          );
    final status = switch (state) {
      _PillState.current => 'current',
      _PillState.done => 'completed',
      _PillState.upcoming => 'not done yet',
      _PillState.locked => 'locked',
    };

    final pill = Material(
      color: current ? AppColors.accent : Colors.transparent,
      shape: StadiumBorder(side: outline),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: locked ? null : onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 40),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(6, 0, 10, 0),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _StepBadge(number: index + 1, state: state),
                const SizedBox(width: 6),
                Flexible(
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      title,
                      maxLines: 1,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: labelColor,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );

    return Semantics(
      container: true,
      button: true,
      enabled: !locked,
      selected: current,
      label: 'Step ${index + 1} of $count, $title, $status',
      onTap: locked ? null : onTap,
      excludeSemantics: true,
      child: locked ? Opacity(opacity: 0.38, child: pill) : pill,
    );
  }
}

/// The small leading circle: the step number, or a check once it's done.
class _StepBadge extends StatelessWidget {
  final int number;
  final _PillState state;

  const _StepBadge({required this.number, required this.state});

  @override
  Widget build(BuildContext context) {
    final (Color fill, Color border, Color fg) = switch (state) {
      _PillState.current => (Colors.white, Colors.white, AppColors.accent),
      _PillState.done => (AppColors.accent, AppColors.accent, Colors.white),
      _ => (Colors.transparent, Colors.white24, Colors.white70),
    };
    return Container(
      width: 20,
      height: 20,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: fill,
        shape: BoxShape.circle,
        border: Border.all(color: border),
      ),
      child: state == _PillState.done
          ? Icon(Icons.check_rounded, size: 14, color: fg)
          : Text(
              '$number',
              textScaler: TextScaler.noScaling,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: fg,
                height: 1,
              ),
            ),
    );
  }
}

class _Connector extends StatelessWidget {
  final bool lit;

  const _Connector({required this.lit});

  @override
  Widget build(BuildContext context) => Container(
    width: 10,
    height: 2,
    margin: const EdgeInsets.symmetric(horizontal: 2),
    decoration: BoxDecoration(
      color: lit ? AppColors.accent : Colors.white24,
      borderRadius: BorderRadius.circular(1),
    ),
  );
}
