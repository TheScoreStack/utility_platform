import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/app_theme.dart';

/// Full-screen, pinch-zoomable receipt viewer. Works for a presigned network
/// URL (saved receipts) or local bytes (the just-scanned photo).
class ReceiptViewerScreen extends StatelessWidget {
  final String? imageUrl;
  final Uint8List? imageBytes;
  final String? heroTag;

  const ReceiptViewerScreen({
    super.key,
    this.imageUrl,
    this.imageBytes,
    this.heroTag,
  }) : assert(imageUrl != null || imageBytes != null);

  @override
  Widget build(BuildContext context) {
    Widget image;
    if (imageBytes != null) {
      image = Image.memory(imageBytes!, fit: BoxFit.contain);
    } else {
      image = Image.network(
        imageUrl!,
        fit: BoxFit.contain,
        loadingBuilder: (context, child, progress) {
          if (progress == null) return child;
          return Center(
            child: CircularProgressIndicator(
              value: progress.expectedTotalBytes != null
                  ? progress.cumulativeBytesLoaded /
                        progress.expectedTotalBytes!
                  : null,
            ),
          );
        },
        errorBuilder: (context, error, stackTrace) => const Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.broken_image_outlined,
                size: 44,
                color: Colors.white38,
              ),
              SizedBox(height: 12),
              Text(
                'Could not load the receipt image.',
                style: TextStyle(color: Colors.white70),
              ),
            ],
          ),
        ),
      );
    }

    if (heroTag != null) {
      image = Hero(tag: heroTag!, child: image);
    }

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          Positioned.fill(
            child: InteractiveViewer(
              minScale: 0.8,
              maxScale: 5,
              child: Center(child: image),
            ),
          ),
          SafeArea(
            child: Align(
              alignment: Alignment.topRight,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: IconButton.filledTonal(
                  style: IconButton.styleFrom(
                    backgroundColor: AppColors.card.withValues(alpha: 0.8),
                  ),
                  icon: const Icon(Icons.close_rounded),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
