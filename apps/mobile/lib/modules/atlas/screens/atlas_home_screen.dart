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
import '../widgets/atlas_widgets.dart';
import '../widgets/place_search_sheet.dart';
import 'add_trip_flow.dart';
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

    final lens = _store.lens;
    final hue = lensColor(lens, _store.circles);
    final trips = _store.lensTrips;
    final stats = _store.stats;
    final wishes = !_store.showWishes
        ? const <MapPin>[]
        : [
            for (final w in _store.lensWishes)
              MapPin(w.place.lat, w.place.lng, hue),
          ];

    if (lens.isFlights) {
      final arcs = <MapArc>[];
      final airports = <String, MapPin>{};
      for (final t in trips) {
        for (final l in t.legs.where((l) => l.isFlight)) {
          arcs.add(MapArc(l.from.lat, l.from.lng, l.to.lat, l.to.lng, hue));
          for (final p in [l.from, l.to]) {
            airports[p.iata ?? p.providerId] = MapPin(
              p.lat,
              p.lng,
              Colors.white,
            );
          }
        }
      }
      return _mapData = AtlasMapData(
        arcs: arcs,
        airports: airports.values.toList(),
        wishes: wishes,
      );
    }

    final countryFills = {
      for (final e in stats.countryVisits.entries)
        e.key: visitFill(hue, e.value),
    };
    final home = _store.profile.homePlace?.countryCode;
    if (home != null && lens.circle == 'all') {
      countryFills.putIfAbsent(home, () => visitFill(hue, 1));
    }
    final regionFills = {
      for (final e in stats.regionVisits.entries)
        if (e.key.startsWith('US-')) e.key: visitFill(hue, e.value),
    };
    final pins = <String, MapPin>{};
    for (final t in trips) {
      for (final s in t.stops) {
        final p = s.place;
        if (p.kind == 'country' || p.kind == 'region') continue;
        pins['${p.countryCode}|${(p.locality ?? p.name).toLowerCase()}'] =
            MapPin(p.lat, p.lng, hue);
      }
    }
    return _mapData = AtlasMapData(
      countryFills: countryFills,
      regionFills: regionFills,
      drawUsStates: regionFills.isNotEmpty,
      pins: pins.values.toList(),
      wishes: wishes,
    );
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
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (sheetContext) => ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.6,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 4),
              child: Text(
                name,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Text(
                matches.isEmpty
                    ? 'Not yet. Someday?'
                    : '${matches.length} ${matches.length == 1 ? 'trip' : 'trips'}',
                style: const TextStyle(color: Colors.white54),
              ),
            ),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final t in matches)
                    TripTile(
                      trip: t,
                      store: _store,
                      onTap: () {
                        Navigator.of(sheetContext).pop();
                        _openTrip(t);
                      },
                    ),
                  const SizedBox(height: 16),
                ],
              ),
            ),
          ],
        ),
      ),
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
          PopupMenuButton<String>(
            onSelected: _onMenu,
            itemBuilder: (_) => const [
              PopupMenuItem(
                value: 'stats',
                child: ListTile(
                  leading: Icon(Icons.insights_rounded),
                  title: Text('Stats'),
                ),
              ),
              PopupMenuItem(
                value: 'circles',
                child: ListTile(
                  leading: Icon(Icons.group_work_outlined),
                  title: Text('Circles'),
                ),
              ),
              PopupMenuItem(
                value: 'wishlist',
                child: ListTile(
                  leading: Icon(Icons.bookmark_border_rounded),
                  title: Text('Wishlist'),
                ),
              ),
              PopupMenuItem(
                value: 'quick',
                child: ListTile(
                  leading: Icon(Icons.bolt_rounded),
                  title: Text('Quick add'),
                ),
              ),
            ],
          ),
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
          ? _loadingOrError()
          : Stack(
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _modeRow(lens),
                    _counters(lens, stats, hue),
                    _circleChips(lens),
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
                              child: _homePrompt(),
                            ),
                          Positioned(
                            left: 16,
                            right: 16,
                            top: 8,
                            child: _bannerView(hue),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                _recentSheet(),
              ],
            ),
    );
  }

  Widget _loadingOrError() {
    if (_store.error == null) {
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
              _store.error!,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white54),
            ),
            const SizedBox(height: 16),
            FilledButton(onPressed: _store.refresh, child: const Text('Retry')),
          ],
        ),
      ),
    );
  }

  Widget _modeRow(AtlasLens lens) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      child: Row(
        children: [
          Expanded(
            child: SegmentedButton<String>(
              showSelectedIcon: false,
              style: const ButtonStyle(
                visualDensity: VisualDensity.compact,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              segments: const [
                ButtonSegment(
                  value: 'footprint',
                  label: Text('Footprint'),
                  icon: Icon(Icons.public_rounded, size: 18),
                ),
                ButtonSegment(
                  value: 'flights',
                  label: Text('Flights'),
                  icon: Icon(Icons.flight_rounded, size: 18),
                ),
              ],
              selected: {lens.mode},
              onSelectionChanged: (s) => _setLens(lens.copyWith(mode: s.first)),
            ),
          ),
          const SizedBox(width: 8),
          Tooltip(
            message: _store.showWishes
                ? 'Showing want to go'
                : 'Show want to go',
            child: FilterChip(
              label: Text(_store.showWishes ? 'Want to go' : 'Been'),
              avatar: Icon(
                _store.showWishes
                    ? Icons.bookmark_rounded
                    : Icons.check_circle_outline_rounded,
                size: 16,
              ),
              selected: _store.showWishes,
              showCheckmark: false,
              onSelected: (v) {
                HapticFeedback.selectionClick();
                _store.setShowWishes(v);
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _counters(AtlasLens lens, AtlasStats stats, Color hue) {
    final items = lens.isFlights
        ? [
            ('Flights', stats.flights),
            ('Miles', stats.flightMiles),
            ('Airports', stats.airports),
          ]
        : [
            ('Countries', stats.countries),
            ('States', stats.usStates),
            ('Cities', stats.cities),
            ('Trips', stats.trips),
          ];
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 10),
      child: AnimatedSwitcher(
        duration: reduceMotion(context)
            ? Duration.zero
            : const Duration(milliseconds: 250),
        child: Row(
          key: ValueKey(lens.mode),
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            for (final (label, value) in items)
              AtlasCounter(label: label, value: value, color: hue),
          ],
        ),
      ),
    );
  }

  Widget _circleChips(AtlasLens lens) {
    final circles = _store.circles;
    Widget chip(String id, String label, Color color) {
      final selected = lens.circle == id;
      return Padding(
        padding: const EdgeInsets.only(right: 8),
        child: ChoiceChip(
          selected: selected,
          showCheckmark: false,
          avatar: CircleDot(color: color),
          label: Text(label),
          selectedColor: color.withValues(alpha: 0.22),
          side: BorderSide(
            color: selected ? color : Colors.white.withValues(alpha: 0.12),
          ),
          onSelected: (_) => _setLens(lens.copyWith(circle: id)),
        ),
      );
    }

    return SizedBox(
      height: 44,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        children: [
          chip('all', 'All', AppColors.accent),
          for (final c in circles) chip(c.circleId, c.name, circleHue(c.color)),
        ],
      ),
    );
  }

  Widget _bannerView(Color hue) {
    final text = _banner;
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
            onTap: () => setState(() => _banner = null),
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

  Widget _homePrompt() {
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
              onPressed: _pickHome,
              icon: const Icon(Icons.search_rounded),
              label: const Text('Search for home'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _recentSheet() {
    final trips = _store.lensTrips;
    return DraggableScrollableSheet(
      initialChildSize: 0.22,
      minChildSize: 0.12,
      maxChildSize: 0.88,
      snap: true,
      snapSizes: const [0.22, 0.55],
      builder: (context, controller) => Material(
        color: const Color(0xFF141C33),
        elevation: 12,
        shadowColor: Colors.black,
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
          borderRadius: const BorderRadius.vertical(top: Radius.circular(22)),
          side: BorderSide(color: Colors.white.withValues(alpha: 0.08)),
        ),
        child: CustomScrollView(
          controller: controller,
          slivers: [
            SliverToBoxAdapter(
              child: Column(
                children: [
                  const SizedBox(height: 10),
                  Container(
                    width: 32,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.white24,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 14, 20, 6),
                    child: Row(
                      children: [
                        Text(
                          'RECENT TRIPS',
                          style: eyebrowStyle(Colors.white70),
                        ),
                        const Spacer(),
                        Text('${trips.length}', style: eyebrowStyle()),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            if (trips.isEmpty)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
                  child: Text(
                    _store.lens.isFlights
                        ? 'No flights in this lens yet. Add one under "Getting there".'
                        : 'No trips here yet. Tap + to add your first.',
                    style: const TextStyle(color: Colors.white54),
                  ),
                ),
              )
            else
              SliverList.builder(
                itemCount: trips.length,
                itemBuilder: (context, i) => TripTile(
                  trip: trips[i],
                  store: _store,
                  onTap: () => _openTrip(trips[i]),
                ),
              ),
            const SliverToBoxAdapter(child: SizedBox(height: 96)),
          ],
        ),
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
