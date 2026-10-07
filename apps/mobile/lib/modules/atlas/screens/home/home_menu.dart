import 'package:flutter/material.dart';

/// The overflow menu: Stats, Circles, Wishlist, Quick add. Hands back the
/// picked value ('stats' / 'circles' / 'wishlist' / 'quick').
class AtlasHomeMenu extends StatelessWidget {
  final ValueChanged<String> onSelected;

  const AtlasHomeMenu({super.key, required this.onSelected});

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<String>(
      onSelected: onSelected,
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
    );
  }
}
