import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import '../../../core/app_theme.dart';
import '../atlas_colors.dart';
import '../atlas_store.dart';
import '../lens.dart';
import '../models/atlas_models.dart';

bool reduceMotion(BuildContext context) =>
    MediaQuery.maybeDisableAnimationsOf(context) ?? false;

final NumberFormat _grouped = NumberFormat.decimalPattern();

String formatCount(num n) => _grouped.format(n);

/// Odometer-style number: each digit rolls to its new value.
class RollingNumber extends StatelessWidget {
  final int value;
  final TextStyle style;

  /// No thousands separator (for years: "2019", not "2,019").
  final bool plain;

  const RollingNumber({
    super.key,
    required this.value,
    required this.style,
    this.plain = false,
  });

  @override
  Widget build(BuildContext context) {
    final reduce = reduceMotion(context);
    final duration = reduce ? Duration.zero : const Duration(milliseconds: 900);
    final effective = style.copyWith(fontFeatures: kTabularFigures);
    return TweenAnimationBuilder<double>(
      tween: Tween<double>(
        begin: reduce ? value.toDouble() : 0,
        end: value.toDouble(),
      ),
      duration: duration,
      curve: Curves.easeOutCubic,
      builder: (context, v, _) {
        final target = plain ? '$value' : formatCount(value);
        final digits = target.replaceAll(RegExp(r'[^0-9]'), '').length;
        final children = <Widget>[];
        var place = digits - 1;
        for (final ch in target.split('')) {
          if (RegExp(r'[0-9]').hasMatch(ch)) {
            children.add(_DigitWheel(value: v, place: place, style: effective));
            place--;
          } else {
            children.add(Text(ch, style: effective));
          }
        }
        return Semantics(
          label: target,
          excludeSemantics: true,
          child: Row(mainAxisSize: MainAxisSize.min, children: children),
        );
      },
    );
  }
}

/// How far the digit at [place] (0 = ones) has rolled toward the next
/// digit, 0 to 1, for a counter currently showing [value]. The ones digit
/// spins continuously; a higher digit moves only while everything below it
/// rolls over (e.g. tens move between 9 and 10, 19 and 20), like an
/// odometer. At a whole number every digit is at rest (0).
@visibleForTesting
double wheelFraction(double value, int place) {
  if (place == 0) return value - value.floor();
  var divisor = 1.0;
  for (var i = 0; i < place; i++) {
    divisor *= 10;
  }
  final lower = value % divisor;
  return (lower - (divisor - 1)).clamp(0.0, 1.0).toDouble();
}

class _DigitWheel extends StatelessWidget {
  final double value;
  final int place;
  final TextStyle style;

  const _DigitWheel({
    required this.value,
    required this.place,
    required this.style,
  });

  @override
  Widget build(BuildContext context) {
    var divisor = 1.0;
    for (var i = 0; i < place; i++) {
      divisor *= 10;
    }
    final whole = (value / divisor).floor();
    final frac = wheelFraction(value, place);
    final digit = whole % 10;
    final next = (digit + 1) % 10;
    final height = (style.fontSize ?? 20) * (style.height ?? 1.2);
    return ClipRect(
      child: SizedBox(
        height: height,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Transform.translate(
              offset: Offset(0, -frac * height),
              child: Text('$digit', style: style),
            ),
            Transform.translate(
              offset: Offset(0, (1 - frac) * height),
              child: Text('$next', style: style),
            ),
          ],
        ),
      ),
    );
  }
}

/// Label + rolling value, used in the home header.
class AtlasCounter extends StatelessWidget {
  final String label;
  final int value;
  final Color color;

  /// Show the number without grouping, e.g. a year.
  final bool plain;

  const AtlasCounter({
    super.key,
    required this.label,
    required this.value,
    required this.color,
    this.plain = false,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        RollingNumber(
          value: value,
          plain: plain,
          style: const TextStyle(
            fontSize: 24,
            height: 1.15,
            fontWeight: FontWeight.w700,
            color: Colors.white,
          ),
        ),
        const SizedBox(height: 2),
        Text(label.toUpperCase(), style: eyebrowStyle(color)),
      ],
    );
  }
}

class CircleDot extends StatelessWidget {
  final Color color;
  final double size;

  const CircleDot({super.key, required this.color, this.size = 10});

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(color: color, shape: BoxShape.circle),
  );
}

/// Read-only or tappable 1-5 star rating.
class StarRating extends StatelessWidget {
  final int? value;
  final ValueChanged<int?>? onChanged;
  final double size;

  const StarRating({super.key, this.value, this.onChanged, this.size = 22});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 1; i <= 5; i++)
          GestureDetector(
            onTap: onChanged == null
                ? null
                : () => onChanged!(value == i ? null : i),
            child: Padding(
              padding: EdgeInsets.all(onChanged == null ? 1 : 4),
              child: Icon(
                (value ?? 0) >= i
                    ? Icons.star_rounded
                    : Icons.star_outline_rounded,
                size: size,
                color: (value ?? 0) >= i
                    ? const Color(0xFFFBBF24)
                    : Colors.white24,
              ),
            ),
          ),
      ],
    );
  }
}

/// Short places summary: "Lisbon · Porto" or "SFO → LIS".
String tripPlacesSummary(AtlasTrip trip) {
  final names = <String>[];
  for (final s in trip.stops) {
    final n = s.place.locality?.isNotEmpty == true
        ? s.place.locality!
        : s.place.name;
    if (!names.contains(n)) names.add(n);
  }
  if (names.isNotEmpty) {
    final head = names.take(3).join(' · ');
    return names.length > 3 ? '$head +${names.length - 3}' : head;
  }
  final flights = trip.legs;
  if (flights.isNotEmpty) {
    return [
      flights.first.from.shortLabel,
      for (final l in flights) l.to.shortLabel,
    ].join(' → ');
  }
  return '';
}

class TripTile extends StatelessWidget {
  final AtlasTrip trip;
  final AtlasStore store;
  final VoidCallback? onTap;

  const TripTile({
    super.key,
    required this.trip,
    required this.store,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final circles = [for (final id in trip.circleIds) ?store.circleById(id)];
    final hue = circles.isEmpty
        ? AppColors.accent
        : circleHue(circles.first.color);
    final country = trip.stops.isNotEmpty
        ? trip.stops.first.place.countryCode
        : (trip.legs.isNotEmpty ? trip.legs.last.to.countryCode : '');
    final pending = trip.tripId.startsWith('tmp_');
    return ListTile(
      onTap: onTap,
      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 2),
      leading: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: SizedBox(
          width: 46,
          height: 46,
          child: trip.coverUrl != null
              ? Image.network(
                  trip.coverUrl!,
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => _CountryBadge(country, hue),
                )
              : _CountryBadge(country, hue),
        ),
      ),
      title: Text(
        trip.title,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontWeight: FontWeight.w600),
      ),
      subtitle: Text(
        [
          formatTrip(trip),
          tripPlacesSummary(trip),
        ].where((s) => s.isNotEmpty).join('  ·  '),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(color: Colors.white54, fontSize: 13),
      ),
      trailing: pending
          ? const SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 1.6),
            )
          : Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final c in circles.take(3))
                  Padding(
                    padding: const EdgeInsets.only(left: 3),
                    child: CircleDot(color: circleHue(c.color), size: 8),
                  ),
              ],
            ),
    );
  }
}

class _CountryBadge extends StatelessWidget {
  final String code;
  final Color hue;
  const _CountryBadge(this.code, this.hue);

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      gradient: LinearGradient(
        colors: [hue.withValues(alpha: 0.5), hue.withValues(alpha: 0.15)],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      ),
    ),
    child: Center(
      child: Text(
        code,
        style: const TextStyle(
          fontWeight: FontWeight.w700,
          letterSpacing: 1,
          color: Colors.white,
        ),
      ),
    ),
  );
}

/// Name + color editor for a circle. Resolves to (name, color) or null.
Future<({String name, String color})?> showCircleEditor(
  BuildContext context, {
  AtlasCircle? circle,
  String? suggestedColor,
}) {
  final controller = TextEditingController(text: circle?.name ?? '');
  var color = circle?.color ?? suggestedColor ?? atlasCircleColors.first;
  return showModalBottomSheet<({String name, String color})>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheetContext) => StatefulBuilder(
      builder: (context, setSheet) {
        void submit() {
          final name = controller.text.trim();
          if (name.isEmpty) return;
          Navigator.of(context).pop((name: name, color: color));
        }

        return KeyboardSafeSheet(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                circle == null ? 'New circle' : 'Edit circle',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 14),
              TextField(
                controller: controller,
                autofocus: circle == null,
                maxLength: 40,
                textCapitalization: TextCapitalization.words,
                textInputAction: TextInputAction.done,
                onChanged: (_) => setSheet(() {}),
                onSubmitted: (_) => submit(),
                decoration: const InputDecoration(
                  labelText: 'Name',
                  hintText: 'Wife, Barbershop, College friends…',
                ),
              ),
              const SizedBox(height: 8),
              Text('COLOR', style: kEyebrow),
              const SizedBox(height: 10),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  for (final key in atlasCircleColors)
                    GestureDetector(
                      onTap: () => setSheet(() => color = key),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 160),
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          color: circleHue(key),
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: color == key
                                ? Colors.white
                                : Colors.transparent,
                            width: 3,
                          ),
                        ),
                        child: color == key
                            ? const Icon(
                                Icons.check_rounded,
                                size: 18,
                                color: Color(0xFF0B1224),
                              )
                            : null,
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: controller.text.trim().isEmpty ? null : submit,
                  child: Text(circle == null ? 'Create circle' : 'Save'),
                ),
              ),
            ],
          ),
        );
      },
    ),
  ).whenComplete(controller.dispose);
}

/// A color not yet used by another circle, for new-circle defaults.
String nextCircleColor(List<AtlasCircle> circles) {
  final used = {for (final c in circles) c.color};
  return atlasCircleColors.firstWhere(
    (c) => !used.contains(c),
    orElse: () => atlasCircleColors[circles.length % atlasCircleColors.length],
  );
}

/// Flight numbers: letters and digits only, upper-cased, e.g. "UA 837" ->
/// "UA837". Matches the API's 16-char cap with room to spare.
class FlightNumberFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final cleaned = newValue.text.toUpperCase().replaceAll(
      RegExp(r'[^A-Z0-9]'),
      '',
    );
    final text = cleaned.length > 8 ? cleaned.substring(0, 8) : cleaned;
    return TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: text.length),
    );
  }
}

/// Wraps a modal sheet's content so it scrolls instead of overflowing when
/// the keyboard takes most of a small screen.
class KeyboardSafeSheet extends StatelessWidget {
  const KeyboardSafeSheet({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        child: child,
      ),
    );
  }
}
