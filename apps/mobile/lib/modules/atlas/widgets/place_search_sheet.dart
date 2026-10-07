import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../atlas_store.dart';
import '../models/atlas_models.dart';

IconData placeKindIcon(String kind) => switch (kind) {
  'airport' => Icons.flight_rounded,
  'country' => Icons.flag_rounded,
  'region' => Icons.map_outlined,
  'poi' => Icons.place_rounded,
  _ => Icons.location_city_rounded,
};

/// Full-height search sheet backed by GET /atlas/places/search. Resolves to
/// a complete [AtlasPlace] (calling GET /atlas/places/{id} when needed), or
/// null when dismissed.
Future<AtlasPlace?> showPlaceSearch(
  BuildContext context, {
  required AtlasStore store,
  String title = 'Search places',
  String hint = 'City, country, or airport',
}) {
  return showModalBottomSheet<AtlasPlace>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    useSafeArea: true,
    builder: (_) => _PlaceSearchSheet(store: store, title: title, hint: hint),
  );
}

class _PlaceSearchSheet extends StatefulWidget {
  final AtlasStore store;
  final String title;
  final String hint;

  const _PlaceSearchSheet({
    required this.store,
    required this.title,
    required this.hint,
  });

  @override
  State<_PlaceSearchSheet> createState() => _PlaceSearchSheetState();
}

class _PlaceSearchSheetState extends State<_PlaceSearchSheet> {
  final _controller = TextEditingController();
  Timer? _debounce;
  List<AtlasPlaceSuggestion> _results = const [];
  bool _searching = false;
  String? _resolving;
  String? _error;
  int _seq = 0;

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
    _debounce?.cancel();
    final q = value.trim();
    if (q.length < 2) {
      setState(() {
        _results = const [];
        _searching = false;
        _error = null;
      });
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 260), () => _search(q));
  }

  Future<void> _search(String q) async {
    final seq = ++_seq;
    setState(() {
      _searching = true;
      _error = null;
    });
    final home = widget.store.profile.homePlace;
    try {
      final results = await widget.store.api.searchPlaces(
        q,
        lat: home?.lat,
        lng: home?.lng,
      );
      if (!mounted || seq != _seq) return;
      setState(() {
        _results = results;
        _searching = false;
      });
    } catch (e) {
      if (!mounted || seq != _seq) return;
      setState(() {
        _searching = false;
        _error = e is ApiException ? e.message : 'Search is offline right now.';
      });
    }
  }

  Future<void> _pick(AtlasPlaceSuggestion s) async {
    if (s.place != null) {
      Navigator.of(context).pop(s.place);
      return;
    }
    setState(() => _resolving = s.providerId);
    try {
      final place = await widget.store.api.getPlace(s.providerId);
      if (!mounted) return;
      Navigator.of(context).pop(place);
    } catch (e) {
      if (!mounted) return;
      setState(() => _resolving = null);
      showAppSnackBar(
        context,
        e is ApiException ? e.message : 'Could not load that place.',
        error: true,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final insets = MediaQuery.viewInsetsOf(context);
    return Padding(
      padding: EdgeInsets.only(bottom: insets.bottom),
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.85,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
              child: Row(
                children: [
                  Text(
                    widget.title,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextField(
                controller: _controller,
                autofocus: true,
                textInputAction: TextInputAction.search,
                onChanged: _onChanged,
                onSubmitted: (v) {
                  if (v.trim().length >= 2) _search(v.trim());
                },
                decoration: InputDecoration(
                  hintText: widget.hint,
                  prefixIcon: const Icon(Icons.search_rounded),
                  suffixIcon: _searching
                      ? const Padding(
                          padding: EdgeInsets.all(14),
                          child: SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        )
                      : null,
                  filled: true,
                  fillColor: Colors.white.withValues(alpha: 0.05),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 8),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.all(16),
                child: Text(
                  _error!,
                  style: const TextStyle(color: AppColors.danger),
                ),
              ),
            Expanded(
              child: ListView.builder(
                itemCount: _results.length,
                itemBuilder: (context, i) {
                  final r = _results[i];
                  return ListTile(
                    leading: CircleAvatar(
                      radius: 18,
                      backgroundColor: Colors.white.withValues(alpha: 0.06),
                      child: Icon(
                        placeKindIcon(r.kind),
                        size: 18,
                        color: Colors.white70,
                      ),
                    ),
                    title: Text(r.title),
                    subtitle: r.subtitle == null ? null : Text(r.subtitle!),
                    trailing: _resolving == r.providerId
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : null,
                    onTap: _resolving == null ? () => _pick(r) : null,
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
