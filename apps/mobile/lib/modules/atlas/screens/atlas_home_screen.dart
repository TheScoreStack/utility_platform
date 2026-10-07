import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../app_config.dart';
import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../../../core/auth_service.dart';
import '../atlas_api.dart';
import '../atlas_colors.dart';
import '../atlas_store.dart';
import '../lens.dart';
import '../map/atlas_map.dart';
import '../models/atlas_models.dart';
import '../widgets/place_search_sheet.dart';
import 'add_trip/add_trip_flow.dart';
import 'home/home_menu.dart';
import 'home/home_overlays.dart';
import 'home/lens_controls.dart';
import 'home/map_data.dart';
import 'home/trip_sheets.dart';
import 'circles_screen.dart';
import 'quick_add_screen.dart';
import 'stats_screen.dart';
import 'trip_detail_screen.dart';
import 'wishlist_screen.dart';

/// Atlas home: the world map that fills in as you log trips, re-tinted by
/// mode (Footprint / Flights) and circle.
class AtlasHomeScreen extends StatefulWidget {
  /// Injected for tests; defaults to the shared backend.
  final AtlasStore? store;

  const AtlasHomeScreen({super.key, this.store});

  @override
  State<AtlasHomeScreen> createState() => _AtlasHomeScreenState();
}

class _AtlasHomeScreenState extends State<AtlasHomeScreen> {
  late final AtlasStore _store;
  late final bool _ownsStore;

  AtlasMapData _mapData = const AtlasMapData();
  Object? _mapKey;

  String? _banner;
  Timer? _bannerTimer;

  @override
  void initState() {
    super.initState();
    _ownsStore = widget.store == null;
    _store =
        widget.store ??
        AtlasStore(
          AtlasApi(
            ApiClient(
              baseUrl: AppConfig.apiBaseUrl,
              tokenProvider: AuthService.instance.getToken,
            ),
          ),
        );
    _store.addListener(_onStore);
    _store.load();
  }

  @override
  void dispose() {
    _bannerTimer?.cancel();
    _store.removeListener(_onStore);
    if (_ownsStore) _store.dispose();
    super.dispose();
  }

  void _onStore() {
    if (mounted) setState(() {});
  }

  // ---------------------------------------------------------------- map data

  AtlasMapData _buildMapData() {
    final key = Object.hash(
      identityHashCode(_store.trips),
      identityHashCode(_store.wishes),
      identityHashCode(_store.snapshot?.circles),
      _store.lens,
      _store.showWishes,
      _store.profile.homePlace?.countryCode,
    );
    if (key == _mapKey) return _mapData;
    _mapKey = key;
    return _mapData = buildAtlasMapData(_store);
  }

  // ---------------------------------------------------------------- actions

  void _setLens(AtlasLens lens) {
    if (lens == _store.lens) return;
    HapticFeedback.selectionClick();
    _store.setLens(lens);
  }

  Future<void> _openAdd({AtlasTrip? existing}) async {
    final result = await Navigator.of(context).push<TripSaveResult>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => AddTripFlow(store: _store, existing: existing),
      ),
    );
    if (result == null || !mounted) return;
    handleTripSaved(context, _store, result, onBanner: _showBanner);
  }

  void _showBanner(String text) {
    _bannerTimer?.cancel();
    setState(() => _banner = text);
    _bannerTimer = Timer(const Duration(seconds: 5), () {
      if (mounted) setState(() => _banner = null);
    });
  }

  void _openTrip(AtlasTrip trip) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => TripDetailScreen(store: _store, tripId: trip.tripId),
      ),
    );
  }

  Future<void> _pickHome() async {
    final place = await showPlaceSearch(
      context,
      store: _store,
      title: "Where's home?",
      hint: 'Your city or country',
    );
    if (place == null || !mounted) return;
    try {
      await _store.setHomePlace(place);
      HapticFeedback.mediumImpact();
    } catch (e) {
      if (mounted) {
        showAppSnackBar(context, 'Could not save home: $e', error: true);
      }
    }
  }

  void _onMenu(String value) {
    final route = switch (value) {
      'stats' => StatsScreen(store: _store),
      'circles' => CirclesScreen(store: _store),
      'wishlist' => WishlistScreen(store: _store),
      _ => QuickAddScreen(store: _store),
    };
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => route));
  }

  void _onTapCountry(String code, String? region) {
    final lensTrips = _store.lensTrips;
    final useRegion = region != null && region.startsWith('US-');
    final matches = [
      for (final t in lensTrips)
        if (tripPlaces(t).any(
          (p) => useRegion ? p.regionCode == region : p.countryCode == code,
        ))
          t,
    ];
    final name = useRegion ? regionName(region) : countryName(code);
    HapticFeedback.selectionClick();
    showPlaceTripsSheet(
      context,
      store: _store,
      name: name,
      matches: matches,
      onOpenTrip: _openTrip,
    );
  }

  // ---------------------------------------------------------------- build

  @override
  Widget build(BuildContext context) {
    final lens = _store.lens;
    final hue = lensColor(lens, _store.circles);
    final stats = _store.stats;
    final mapData = _buildMapData();
    final empty =
        _store.hasData &&
        _store.trips.isEmpty &&
        _store.profile.homePlace == null;

    return Scaffold(
      backgroundColor: AtlasPalette.ocean,
      appBar: AppBar(
        backgroundColor: AtlasPalette.ocean,
        title: const Text('Atlas'),
        actions: [
          if (_store.refreshing)
            const Padding(
              padding: EdgeInsets.only(right: 8),
              child: SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          AtlasHomeMenu(onSelected: _onMenu),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _openAdd(),
        backgroundColor: hue,
        foregroundColor: AtlasPalette.ocean,
        tooltip: 'Add a trip',
        child: const Icon(Icons.add_rounded, size: 30),
      ),
      body: !_store.hasData
          ? AtlasLoadingOrError(store: _store)
          : Stack(
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    AtlasModeRow(store: _store, onLens: _setLens),
                    AtlasCountersRow(lens: lens, stats: stats, hue: hue),
                    AtlasCircleChipRow(
                      lens: lens,
                      circles: _store.circles,
                      onLens: _setLens,
                    ),
                    Expanded(
                      child: Stack(
                        children: [
                          Positioned.fill(
                            child: Padding(
                              padding: const EdgeInsets.only(bottom: 90),
                              child: AtlasWorldMap(
                                data: mapData,
                                onTapCountry: _onTapCountry,
                              ),
                            ),
                          ),
                          if (empty)
                            Positioned(
                              left: 20,
                              right: 20,
                              top: 24,
                              child: HomePlacePrompt(onPickHome: _pickHome),
                            ),
                          Positioned(
                            left: 16,
                            right: 16,
                            top: 8,
                            child: CelebrationBanner(
                              text: _banner,
                              hue: hue,
                              onDismiss: () => setState(() => _banner = null),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                RecentTripsSheet(store: _store, onOpenTrip: _openTrip),
              ],
            ),
    );
  }
}

/// Shared post-save handling: celebrate firsts, report failures.
void handleTripSaved(
  BuildContext context,
  AtlasStore store,
  TripSaveResult result, {
  void Function(String text)? onBanner,
}) {
  final firsts = result.firsts;
  if (!firsts.isEmpty) {
    final allStats = computeStats(store.trips);
    String text;
    if (firsts.countries.isNotEmpty) {
      final names = firsts.countries.map(countryName).join(', ');
      final label = firsts.countries.length == 1
          ? 'New country'
          : 'New countries';
      text = '$label: $names · ${allStats.countries} countries';
    } else {
      final usStates = firsts.regions.where((r) => r.startsWith('US-'));
      final names = (usStates.isEmpty ? firsts.regions : usStates)
          .map(regionName)
          .join(', ');
      text = usStates.isEmpty
          ? 'New region: $names'
          : '${usStates.length == 1 ? 'New state' : 'New states'}: $names · ${allStats.usStates} states';
    }
    HapticFeedback.heavyImpact();
    if (onBanner != null) {
      onBanner(text);
    } else {
      showAppSnackBar(context, text, success: true);
    }
  }
  final messenger = ScaffoldMessenger.maybeOf(context);
  result.saving.catchError((Object e) {
    messenger?.showSnackBar(
      SnackBar(
        content: Text(
          'Could not save "${result.title}": ${e is ApiException ? e.message : e}',
        ),
      ),
    );
    return result.optimistic;
  });
}
