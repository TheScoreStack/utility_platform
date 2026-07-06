import 'package:flutter_test/flutter_test.dart';
import 'package:platform_mobile/core/share_service.dart';

void main() {
  group('sharedFileKindOf', () {
    test('detects statement file kinds by extension', () {
      expect(sharedFileKindOf('venmo_statement.CSV'), SharedFileKind.csv);
      expect(sharedFileKindOf('June 2026.pdf'), SharedFileKind.pdf);
      expect(sharedFileKindOf('IMG_2041.jpeg'), SharedFileKind.image);
      expect(sharedFileKindOf('scan.webp'), SharedFileKind.image);
      expect(sharedFileKindOf('books.xlsx'), SharedFileKind.unsupported);
      expect(sharedFileKindOf('noextension'), SharedFileKind.unsupported);
    });
  });

  group('sharedFileContentType', () {
    test('maps kinds to upload content types', () {
      expect(
        sharedFileContentType(SharedFileKind.pdf, 'a.pdf'),
        'application/pdf',
      );
      expect(sharedFileContentType(SharedFileKind.csv, 'a.csv'), 'text/csv');
      expect(
        sharedFileContentType(SharedFileKind.image, 'a.png'),
        'image/png',
      );
      expect(
        sharedFileContentType(SharedFileKind.image, 'a.jpg'),
        'image/jpeg',
      );
    });
  });
}
