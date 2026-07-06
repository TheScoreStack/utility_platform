import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../availability.dart';
import '../formatting.dart';
import '../models.dart';
import '../theme.dart';

/// Dates × slots grid, two modes:
///
/// - **Edit** ([editable] true): paints the caller's own [availability].
///   Tap toggles a single slot; long-press starts a paint session and
///   dragging sweeps a rectangle of slots (long-press-to-paint keeps normal
///   vertical scrolling working). Dragging near a scroll edge auto-scrolls
///   so a stroke can cross the fold. The painted level comes from
///   [paintLevel] (see [MeetLevelSelector]); painting over slots already at
///   that level erases them. Passing [availability] without [editable]
///   renders the same colors read-only (e.g. a finalized meet).
/// - **Heatmap** ([editable] false): renders group availability from
///   [heatmap] with opacity scaled by attendee count; tapping a slot fires
///   [onSlotTap] (who's-free sheet).
///
/// Times render in the event's timezone — no conversion math here.
class MeetAvailabilityGrid extends StatefulWidget {
  final MeetEvent event;

  /// The caller's availability (edit mode). Normalized on every change.
  final MeetAvailability? availability;

  /// Group aggregation (heatmap mode).
  final MeetHeatmap? heatmap;
  final bool editable;

  /// Level painted in edit mode: 0 unavailable, 1 if-need-be, 2 available.
  final int paintLevel;
  final ValueChanged<MeetAvailability>? onChanged;
  final void Function(String date, int slotIndex)? onSlotTap;
  final Color? accentColor;

  const MeetAvailabilityGrid({
    super.key,
    required this.event,
    this.availability,
    this.heatmap,
    this.editable = false,
    this.paintLevel = 2,
    this.onChanged,
    this.onSlotTap,
    this.accentColor,
  });

  @override
  State<MeetAvailabilityGrid> createState() => _MeetAvailabilityGridState();
}

class _MeetAvailabilityGridState extends State<MeetAvailabilityGrid> {
  static const double _timeLabelWidth = 56;
  static const double _cellWidth = 56;

  // Edge-autoscroll during a paint drag: holding the finger within this many
  // pixels of a scroll-view edge scrolls by the step every tick so a stroke
  // can cross the fold.
  static const double _autoScrollZone = 36;
  static const double _autoScrollStep = 8;

  // Paint session (long-press drag). Rectangle semantics: the drag sweeps
  // the rect between the origin cell and the current cell, applied on top of
  // the availability snapshot taken when the press started.
  MeetAvailability? _paintBase;
  (int, int)? _paintOrigin;
  (int, int)? _paintLast;
  int _activeLevel = 2;
  Offset? _paintGlobal;
  Timer? _autoScrollTimer;

  final ScrollController _hController = ScrollController();
  final GlobalKey _gridContentKey = GlobalKey();

  @override
  void dispose() {
    _autoScrollTimer?.cancel();
    _hController.dispose();
    super.dispose();
  }

  double get _cellHeight => widget.event.mode == MeetMode.allDay
      ? 44
      : widget.event.slotMinutes >= 60
          ? 36
          : 28;

  int get _slots => meetSlotsPerDay(widget.event);

  (int, int)? _cellAt(Offset local) {
    final dateIndex = (local.dx / _cellWidth).floor();
    final slotIndex = (local.dy / _cellHeight).floor();
    if (dateIndex < 0 || dateIndex >= widget.event.dates.length) return null;
    if (slotIndex < 0 || slotIndex >= _slots) return null;
    return (dateIndex, slotIndex);
  }

  MeetAvailability _applyRect(
    MeetAvailability base,
    (int, int) a,
    (int, int) b,
    int level,
  ) {
    final event = widget.event;
    final normalized = normalizeMeetAvailability(event, base);
    final allowIfNeedBe = event.settings?.allowIfNeedBe != false;
    final effective = level == 1 && !allowIfNeedBe ? 0 : level.clamp(0, 2);
    final d0 = math.min(a.$1, b.$1);
    final d1 = math.max(a.$1, b.$1);
    final s0 = math.min(a.$2, b.$2);
    final s1 = math.max(a.$2, b.$2);
    for (var d = d0; d <= d1; d++) {
      final date = event.dates[d];
      final chars = normalized[date]!.split('');
      for (var s = s0; s <= s1 && s < chars.length; s++) {
        chars[s] = '$effective';
      }
      normalized[date] = chars.join();
    }
    return normalized;
  }

  void _handleTapUp(TapUpDetails details) {
    final cell = _cellAt(details.localPosition);
    if (cell == null) return;
    final date = widget.event.dates[cell.$1];
    if (!widget.editable) {
      widget.onSlotTap?.call(date, cell.$2);
      return;
    }
    final current = normalizeMeetAvailability(widget.event, widget.availability);
    final level = meetLevelAt(current, date, cell.$2) == widget.paintLevel
        ? 0
        : widget.paintLevel;
    widget.onChanged
        ?.call(setMeetLevel(widget.event, current, date, cell.$2, level));
  }

  void _handleLongPressStart(LongPressStartDetails details) {
    if (!widget.editable) return;
    final cell = _cellAt(details.localPosition);
    if (cell == null) return;
    final base = normalizeMeetAvailability(widget.event, widget.availability);
    final date = widget.event.dates[cell.$1];
    // Starting on a cell already at the selected level turns the drag into
    // an eraser, so re-painting a region clears it.
    _activeLevel = meetLevelAt(base, date, cell.$2) == widget.paintLevel
        ? 0
        : widget.paintLevel;
    _paintBase = base;
    _paintOrigin = cell;
    _paintLast = cell;
    _paintGlobal = details.globalPosition;
    HapticFeedback.selectionClick();
    widget.onChanged?.call(_applyRect(base, cell, cell, _activeLevel));
  }

  void _handleLongPressMove(LongPressMoveUpdateDetails details) {
    final base = _paintBase;
    final origin = _paintOrigin;
    if (base == null || origin == null) return;
    _paintGlobal = details.globalPosition;
    // The tick stops itself once the finger leaves the edge zones.
    _autoScrollTimer ??= Timer.periodic(
      const Duration(milliseconds: 16),
      (_) => _autoScrollTick(),
    );
    final cell = _cellAt(details.localPosition);
    if (cell == null || cell == _paintLast) return;
    _paintLast = cell;
    widget.onChanged?.call(_applyRect(base, origin, cell, _activeLevel));
  }

  void _endPaint() {
    _paintBase = null;
    _paintOrigin = null;
    _paintLast = null;
    _paintGlobal = null;
    _stopAutoScroll();
  }

  void _stopAutoScroll() {
    _autoScrollTimer?.cancel();
    _autoScrollTimer = null;
  }

  /// Scroll delta for one axis given the pointer position in the viewport.
  double _edgeDelta(double position, double extent) {
    if (position < _autoScrollZone) return -_autoScrollStep;
    if (position > extent - _autoScrollZone) return _autoScrollStep;
    return 0;
  }

  /// Nudges a scroll position by [delta], clamped to its extents. Returns
  /// true when it actually moved.
  bool _nudge(ScrollPosition position, double delta) {
    final target = (position.pixels + delta)
        .clamp(position.minScrollExtent, position.maxScrollExtent)
        .toDouble();
    if (target == position.pixels) return false;
    position.jumpTo(target);
    return true;
  }

  void _autoScrollTick() {
    final global = _paintGlobal;
    final base = _paintBase;
    final origin = _paintOrigin;
    if (global == null || base == null || origin == null) {
      _stopAutoScroll();
      return;
    }

    var moved = false;

    // Horizontal: this widget's own scroll view.
    final hViewport = context.findRenderObject();
    if (_hController.hasClients && hViewport is RenderBox && hViewport.hasSize) {
      final local = hViewport.globalToLocal(global);
      final delta = _edgeDelta(local.dx, hViewport.size.width);
      if (delta != 0) moved = _nudge(_hController.position, delta) || moved;
    }

    // Vertical: the enclosing scrollable (the host screen's list), if any.
    final vScrollable = Scrollable.maybeOf(context);
    final vViewport = vScrollable?.context.findRenderObject();
    if (vScrollable != null && vViewport is RenderBox && vViewport.hasSize) {
      final local = vViewport.globalToLocal(global);
      final delta = _edgeDelta(local.dy, vViewport.size.height);
      if (delta != 0) moved = _nudge(vScrollable.position, delta) || moved;
    }

    if (!moved) {
      _stopAutoScroll();
      return;
    }

    // The grid shifted under the stationary finger — extend the stroke to
    // whichever cell is now beneath it.
    final gridBox = _gridContentKey.currentContext?.findRenderObject();
    if (gridBox is! RenderBox || !gridBox.hasSize) return;
    final cell = _cellAt(gridBox.globalToLocal(global));
    if (cell == null || cell == _paintLast) return;
    _paintLast = cell;
    widget.onChanged?.call(_applyRect(base, origin, cell, _activeLevel));
  }

  bool _inFinalizedSlot(String date, int slotIndex) {
    final slot = widget.event.finalizedSlot;
    if (slot == null || slot.date != date) return false;
    final ref = meetSlotRef(widget.event, date, slotIndex);
    return ref.startMinute >= slot.startMinute && ref.endMinute <= slot.endMinute;
  }

  Color _cellColor(String date, int slotIndex, ColorScheme scheme) {
    final base = scheme.surfaceContainerHighest.withValues(alpha: 0.35);
    final heatmap = widget.heatmap;
    if (heatmap == null) {
      // Own-availability rendering, editable or read-only.
      final availability =
          widget.availability ?? const <String, String>{};
      switch (meetLevelAt(availability, date, slotIndex)) {
        case 2:
          return MeetColors.available.withValues(alpha: 0.85);
        case 1:
          return MeetColors.ifNeedBe.withValues(alpha: 0.75);
        default:
          return base;
      }
    }
    final tally = heatmap.tally[date];
    if (tally == null || slotIndex >= tally.available.length) {
      return base;
    }
    final availableCount = tally.available[slotIndex].length;
    final ifNeedBeCount = tally.ifNeedBe[slotIndex].length;
    if (availableCount > 0) {
      final scale = availableCount / math.max(heatmap.maxAvailable, 1);
      return MeetColors.available.withValues(alpha: 0.15 + 0.75 * scale);
    }
    if (ifNeedBeCount > 0) {
      final scale = ifNeedBeCount / math.max(heatmap.participantCount, 1);
      return MeetColors.ifNeedBe.withValues(alpha: 0.10 + 0.4 * scale);
    }
    return base;
  }

  Widget _buildCell(int dateIndex, int slotIndex, ColorScheme scheme) {
    final date = widget.event.dates[dateIndex];
    final finalized = !widget.editable && _inFinalizedSlot(date, slotIndex);
    final accent = widget.accentColor ?? scheme.primary;
    final isHourBoundary = widget.event.mode == MeetMode.timeGrid &&
        (widget.event.startMinute + slotIndex * widget.event.slotMinutes) % 60 == 0;
    return Container(
      key: ValueKey('meet-cell-$dateIndex-$slotIndex'),
      width: _cellWidth,
      height: _cellHeight,
      padding: const EdgeInsets.all(1),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: _cellColor(date, slotIndex, scheme),
          borderRadius: BorderRadius.circular(4),
          border: finalized
              ? Border.all(color: accent, width: 2)
              : Border.all(
                  color: scheme.outlineVariant
                      .withValues(alpha: isHourBoundary ? 0.5 : 0.2),
                  width: 0.5,
                ),
        ),
      ),
    );
  }

  Widget _buildHeader(ColorScheme scheme, TextTheme text) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        const SizedBox(width: _timeLabelWidth),
        for (final date in widget.event.dates)
          SizedBox(
            width: _cellWidth,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  meetWeekdayLabel(date).toUpperCase(),
                  style: text.labelSmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                    letterSpacing: 1.1,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  meetMonthDayLabel(date),
                  style: text.labelMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 6),
              ],
            ),
          ),
      ],
    );
  }

  Widget _buildTimeLabels(ColorScheme scheme, TextTheme text) {
    final event = widget.event;
    final labels = <Widget>[];
    for (var i = 0; i < _slots; i++) {
      String label = '';
      if (event.mode == MeetMode.allDay) {
        label = 'All day';
      } else {
        final minute = event.startMinute + i * event.slotMinutes;
        if (minute % 60 == 0) label = formatMeetMinutes(minute);
      }
      labels.add(
        SizedBox(
          width: _timeLabelWidth,
          height: _cellHeight,
          child: Align(
            alignment: Alignment.topRight,
            child: Padding(
              padding: const EdgeInsets.only(right: 6),
              child: Text(
                label,
                style: text.labelSmall?.copyWith(
                  color: scheme.onSurfaceVariant,
                  fontSize: 10,
                ),
              ),
            ),
          ),
        ),
      );
    }
    return Column(children: labels);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final slots = _slots;
    if (slots == 0 || widget.event.dates.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          'No time slots to show.',
          style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
        ),
      );
    }

    final grid = GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapUp: _handleTapUp,
      onLongPressStart: widget.editable ? _handleLongPressStart : null,
      onLongPressMoveUpdate: widget.editable ? _handleLongPressMove : null,
      onLongPressEnd: widget.editable ? (_) => _endPaint() : null,
      onLongPressCancel: widget.editable ? _endPaint : null,
      child: Column(
        key: _gridContentKey,
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var s = 0; s < slots; s++)
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (var d = 0; d < widget.event.dates.length; d++)
                  _buildCell(d, s, scheme),
              ],
            ),
        ],
      ),
    );

    return SingleChildScrollView(
      controller: _hController,
      scrollDirection: Axis.horizontal,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildHeader(scheme, text),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              _buildTimeLabels(scheme, text),
              grid,
            ],
          ),
        ],
      ),
    );
  }
}
