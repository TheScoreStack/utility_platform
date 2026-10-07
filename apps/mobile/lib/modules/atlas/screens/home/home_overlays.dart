import 'package:flutter/material.dart';

import '../../widgets/atlas_widgets.dart';
import '../../atlas_colors.dart';
import '../../atlas_store.dart';

/// Shown instead of the map until the first snapshot lands (or fails).
class AtlasLoadingOrError extends StatelessWidget {
  final AtlasStore store;

  const AtlasLoadingOrError({super.key, required this.store});

  @override
  Widget build(BuildContext context) {
    if (store.error == null) {
      return const Center(child: CircularProgressIndicator());
    }
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.cloud_off_rounded,
              size: 40,
              color: Colors.white38,
            ),
            const SizedBox(height: 12),
            const Text('Could not load your atlas'),
            const SizedBox(height: 4),
            Text(
              store.error!,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white54),
            ),
            const SizedBox(height: 16),
            FilledButton(onPressed: store.refresh, child: const Text('Retry')),
          ],
        ),
      ),
    );
  }
}

/// "New country: …" celebration that slides in over the map. Hidden while
/// [text] is null; tap to dismiss early.
class CelebrationBanner extends StatelessWidget {
  final String? text;
  final Color hue;
  final VoidCallback onDismiss;

  const CelebrationBanner({
    super.key,
    required this.text,
    required this.hue,
    required this.onDismiss,
  });

  @override
  Widget build(BuildContext context) {
    final text = this.text;
    final reduce = reduceMotion(context);
    return IgnorePointer(
      ignoring: text == null,
      child: AnimatedSlide(
        offset: text == null ? const Offset(0, -0.4) : Offset.zero,
        duration: reduce ? Duration.zero : const Duration(milliseconds: 380),
        curve: Curves.easeOutBack,
        child: AnimatedOpacity(
          opacity: text == null ? 0 : 1,
          duration: reduce ? Duration.zero : const Duration(milliseconds: 240),
          child: GestureDetector(
            onTap: onDismiss,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    hue.withValues(alpha: 0.95),
                    Color.lerp(hue, Colors.white, 0.25)!,
                  ],
                ),
                borderRadius: BorderRadius.circular(16),
                boxShadow: [
                  BoxShadow(
                    color: hue.withValues(alpha: 0.4),
                    blurRadius: 24,
                    offset: const Offset(0, 8),
                  ),
                ],
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.celebration_rounded,
                    color: AtlasPalette.ocean,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      text ?? '',
                      style: const TextStyle(
                        color: AtlasPalette.ocean,
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// First-run card: no trips and no home yet.
class HomePlacePrompt extends StatelessWidget {
  final VoidCallback onPickHome;

  const HomePlacePrompt({super.key, required this.onPickHome});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              "Where's home?",
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 6),
            const Text(
              'Start your map with home, then add the places you have been.',
              style: TextStyle(color: Colors.white60),
            ),
            const SizedBox(height: 14),
            OutlinedButton.icon(
              onPressed: onPickHome,
              icon: const Icon(Icons.search_rounded),
              label: const Text('Search for home'),
            ),
          ],
        ),
      ),
    );
  }
}
