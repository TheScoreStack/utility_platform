import 'package:flutter/material.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../atlas_colors.dart';
import '../atlas_store.dart';
import '../lens.dart';
import '../models/atlas_models.dart';
import '../widgets/atlas_widgets.dart';

/// Create, rename, recolor and delete circles, and manage the people in
/// each one. Solo is built in and cannot be deleted.
class CirclesScreen extends StatelessWidget {
  final AtlasStore store;

  const CirclesScreen({super.key, required this.store});

  Future<void> _run(
    BuildContext context,
    Future<void> Function() action,
  ) async {
    try {
      await action();
    } catch (e) {
      if (context.mounted) {
        showAppSnackBar(
          context,
          e is ApiException ? e.message : 'Something went wrong',
          error: true,
        );
      }
    }
  }

  Future<void> _create(BuildContext context) async {
    final result = await showCircleEditor(
      context,
      suggestedColor: nextCircleColor(store.circles),
    );
    if (result == null || !context.mounted) return;
    await _run(context, () => store.createCircle(result.name, result.color));
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: store,
      builder: (context, _) {
        final counts = tripsByCircle(store.trips);
        final circles = store.circles;
        return Scaffold(
          appBar: AppBar(title: const Text('Circles')),
          floatingActionButton: FloatingActionButton.extended(
            onPressed: () => _create(context),
            icon: const Icon(Icons.add_rounded),
            label: const Text('New circle'),
          ),
          body: ListView(
            padding: const EdgeInsets.only(bottom: 96),
            children: [
              const Padding(
                padding: EdgeInsets.fromLTRB(20, 4, 20, 12),
                child: Text(
                  'Circles are the people you travel with. Pick one on the '
                  'map to see only the places you went together.',
                  style: TextStyle(color: Colors.white60),
                ),
              ),
              for (final c in circles)
                _CircleTile(
                  circle: c,
                  tripCount: counts[c.circleId] ?? 0,
                  people: [
                    for (final p in store.people)
                      if (p.circleIds.contains(c.circleId)) p,
                  ],
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) =>
                          _CircleDetail(store: store, circleId: c.circleId),
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _CircleTile extends StatelessWidget {
  final AtlasCircle circle;
  final int tripCount;
  final List<AtlasPerson> people;
  final VoidCallback onTap;

  const _CircleTile({
    required this.circle,
    required this.tripCount,
    required this.people,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final hue = circleHue(circle.color);
    return ListTile(
      onTap: onTap,
      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
      leading: CircleAvatar(
        backgroundColor: hue.withValues(alpha: 0.2),
        child: circle.builtIn
            ? Icon(Icons.person_outline_rounded, color: hue)
            : Text(
                circle.name.isEmpty ? '?' : circle.name[0].toUpperCase(),
                style: TextStyle(color: hue, fontWeight: FontWeight.w700),
              ),
      ),
      title: Text(circle.name),
      subtitle: Text(
        [
          '$tripCount ${tripCount == 1 ? 'trip' : 'trips'}',
          if (people.isNotEmpty) people.map((p) => p.name).join(', '),
        ].join('  ·  '),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(color: Colors.white54),
      ),
      trailing: const Icon(Icons.chevron_right_rounded),
    );
  }
}

class _CircleDetail extends StatelessWidget {
  final AtlasStore store;
  final String circleId;

  const _CircleDetail({required this.store, required this.circleId});

  Future<void> _run(
    BuildContext context,
    Future<void> Function() action,
  ) async {
    try {
      await action();
    } catch (e) {
      if (context.mounted) {
        showAppSnackBar(
          context,
          e is ApiException ? e.message : 'Something went wrong',
          error: true,
        );
      }
    }
  }

  Future<String?> _askName(BuildContext context, {String? initial}) {
    return showDialog<String>(
      context: context,
      builder: (_) => TextControllerScope(
        initialText: initial ?? '',
        builder: (ctx, controller) => StatefulBuilder(
          builder: (ctx, setDialog) {
            final name = controller.text.trim();
            return AlertDialog(
              title: Text(initial == null ? 'Add person' : 'Rename'),
              content: TextField(
                controller: controller,
                autofocus: true,
                maxLength: 80,
                textCapitalization: TextCapitalization.words,
                textInputAction: TextInputAction.done,
                decoration: const InputDecoration(hintText: 'Name'),
                onChanged: (_) => setDialog(() {}),
                onSubmitted: (v) {
                  if (v.trim().isNotEmpty) Navigator.pop(ctx, v.trim());
                },
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(ctx),
                  child: const Text('Cancel'),
                ),
                TextButton(
                  onPressed: name.isEmpty
                      ? null
                      : () => Navigator.pop(ctx, name),
                  child: const Text('Save'),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: store,
      builder: (context, _) {
        final circle = store.circleById(circleId);
        if (circle == null) {
          return Scaffold(appBar: AppBar());
        }
        final hue = circleHue(circle.color);
        final members = [
          for (final p in store.people)
            if (p.circleIds.contains(circleId)) p,
        ];
        final others = [
          for (final p in store.people)
            if (!p.circleIds.contains(circleId)) p,
        ];
        return Scaffold(
          appBar: AppBar(
            title: Row(
              children: [
                CircleDot(color: hue, size: 12),
                const SizedBox(width: 10),
                Flexible(child: Text(circle.name)),
              ],
            ),
            actions: [
              IconButton(
                tooltip: 'Edit',
                icon: const Icon(Icons.edit_outlined),
                onPressed: () async {
                  final r = await showCircleEditor(context, circle: circle);
                  if (r == null || !context.mounted) return;
                  await _run(
                    context,
                    () => store.updateCircle(
                      circle,
                      name: r.name,
                      color: r.color,
                    ),
                  );
                },
              ),
              if (!circle.builtIn)
                IconButton(
                  tooltip: 'Delete',
                  icon: const Icon(Icons.delete_outline_rounded),
                  onPressed: () async {
                    final ok = await showDialog<bool>(
                      context: context,
                      builder: (ctx) => AlertDialog(
                        title: Text('Delete ${circle.name}?'),
                        content: const Text(
                          'Trips stay on your map; they just lose this circle.',
                        ),
                        actions: [
                          TextButton(
                            onPressed: () => Navigator.pop(ctx, false),
                            child: const Text('Cancel'),
                          ),
                          TextButton(
                            onPressed: () => Navigator.pop(ctx, true),
                            style: TextButton.styleFrom(
                              foregroundColor: AppColors.danger,
                            ),
                            child: const Text('Delete'),
                          ),
                        ],
                      ),
                    );
                    if (ok != true || !context.mounted) return;
                    Navigator.of(context).pop();
                    await _run(context, () => store.deleteCircle(circleId));
                  },
                ),
            ],
          ),
          body: ListView(
            padding: const EdgeInsets.fromLTRB(0, 8, 0, 32),
            children: [
              if (circle.builtIn)
                const Padding(
                  padding: EdgeInsets.fromLTRB(20, 0, 20, 12),
                  child: Text(
                    'Solo is built in: trips you took on your own.',
                    style: TextStyle(color: Colors.white60),
                  ),
                ),
              if (!circle.builtIn) ...[
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
                  child: Text('PEOPLE', style: kEyebrow),
                ),
                if (members.isEmpty)
                  const Padding(
                    padding: EdgeInsets.fromLTRB(20, 0, 20, 8),
                    child: Text(
                      'No one here yet.',
                      style: TextStyle(color: Colors.white54),
                    ),
                  ),
                for (final p in members)
                  ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 20),
                    leading: CircleAvatar(
                      backgroundColor: hue.withValues(alpha: 0.18),
                      child: Text(
                        p.name.isEmpty ? '?' : p.name[0].toUpperCase(),
                        style: TextStyle(color: hue),
                      ),
                    ),
                    title: Text(p.name),
                    onTap: () async {
                      final name = await _askName(context, initial: p.name);
                      if (name == null || name.isEmpty || !context.mounted) {
                        return;
                      }
                      await _run(
                        context,
                        () => store.updatePerson(p, name: name),
                      );
                    },
                    trailing: PopupMenuButton<String>(
                      onSelected: (v) => _run(
                        context,
                        () => v == 'remove'
                            ? store.updatePerson(
                                p,
                                circleIds: [
                                  ...p.circleIds.where((id) => id != circleId),
                                ],
                              )
                            : store.deletePerson(p.personId),
                      ),
                      itemBuilder: (_) => const [
                        PopupMenuItem(
                          value: 'remove',
                          child: Text('Remove from circle'),
                        ),
                        PopupMenuItem(
                          value: 'delete',
                          child: Text('Delete person'),
                        ),
                      ],
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      ActionChip(
                        avatar: const Icon(
                          Icons.person_add_alt_rounded,
                          size: 18,
                        ),
                        label: const Text('Add person'),
                        onPressed: () async {
                          final name = await _askName(context);
                          if (name == null ||
                              name.isEmpty ||
                              !context.mounted) {
                            return;
                          }
                          await _run(
                            context,
                            () => store.createPerson(name, [circleId]),
                          );
                        },
                      ),
                      for (final p in others)
                        ActionChip(
                          avatar: const Icon(Icons.add_rounded, size: 16),
                          label: Text(p.name),
                          onPressed: () => _run(
                            context,
                            () => store.updatePerson(
                              p,
                              circleIds: [...p.circleIds, circleId],
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 24),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 4),
                child: Text('TRIPS', style: kEyebrow),
              ),
              for (final t in applyLens(
                store.trips,
                AtlasLens(circle: circleId),
              ))
                TripTile(trip: t, store: store),
            ],
          ),
        );
      },
    );
  }
}
