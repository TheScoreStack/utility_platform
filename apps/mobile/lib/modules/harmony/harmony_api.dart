import '../../core/api_client.dart';
import 'models/harmony_models.dart';

/// Typed wrapper over the shared [ApiClient] for the Harmony Collective
/// endpoints (`/harmony-ledger/*`).
class HarmonyApi {
  final ApiClient _api;

  const HarmonyApi(this._api);

  Future<HarmonyAccess> getAccess() async {
    final data = await _api.get('/harmony-ledger/access');
    return HarmonyAccess.fromJson(data as Map<String, dynamic>);
  }

  Future<HarmonyLedgerData> getLedger() async {
    final data = await _api.get('/harmony-ledger/entries');
    return HarmonyLedgerData.fromJson(data as Map<String, dynamic>);
  }

  Future<HarmonyEntry> createEntry({
    required String type,
    required double amount,
    String currency = 'USD',
    String? description,
    String? source,
    String? notes,
    String? groupId,
  }) async {
    final data = await _api.post('/harmony-ledger/entries', {
      'type': type,
      'amount': amount,
      'currency': currency,
      if (description != null && description.isNotEmpty)
        'description': description,
      if (source != null) 'source': source,
      if (notes != null && notes.isNotEmpty) 'notes': notes,
      if (groupId != null) 'groupId': groupId,
    });
    return HarmonyEntry.fromJson(data as Map<String, dynamic>);
  }

  /// Partial edit. [changes] may include type, amount, currency, description,
  /// source, category, notes, memberName, groupId — text fields accept null
  /// to clear, and groupId accepts null to unallocate. recordedAt is added
  /// automatically.
  Future<HarmonyEntry> updateEntry(
    String entryId,
    String recordedAt,
    Map<String, dynamic> changes,
  ) async {
    final data = await _api.patch('/harmony-ledger/entries/$entryId', {
      'recordedAt': recordedAt,
      ...changes,
    });
    return HarmonyEntry.fromJson(data as Map<String, dynamic>);
  }

  Future<void> deleteEntry(String entryId, String recordedAt) => _api.delete(
    '/harmony-ledger/entries/$entryId',
    {'recordedAt': recordedAt},
  );

  /// Returns the created statement plus the presigned upload URL.
  Future<({HarmonyStatement statement, String uploadUrl})> createStatement({
    required String fileName,
    required String contentType,
    required String sourceType,
  }) async {
    final data =
        await _api.post('/harmony-ledger/statements', {
              'fileName': fileName,
              'contentType': contentType,
              'sourceType': sourceType,
            })
            as Map<String, dynamic>;
    return (
      statement: HarmonyStatement.fromJson(
        data['statement'] as Map<String, dynamic>,
      ),
      uploadUrl: data['uploadUrl'] as String,
    );
  }

  Future<void> uploadStatementBytes(
    String uploadUrl,
    List<int> bytes, {
    required String contentType,
  }) => _api.putBytes(uploadUrl, bytes, contentType: contentType);

  Future<List<HarmonyStatement>> listStatements() async {
    final data = await _api.get('/harmony-ledger/statements');
    return [
      for (final statement
          in ((data as Map<String, dynamic>)['statements'] as List? ?? []))
        HarmonyStatement.fromJson(statement as Map<String, dynamic>),
    ];
  }

  Future<HarmonyStatementDetail> getStatementDetail(String statementId) async {
    final data = await _api.get('/harmony-ledger/statements/$statementId');
    return HarmonyStatementDetail.fromJson(data as Map<String, dynamic>);
  }

  Future<void> deleteStatement(String statementId) =>
      _api.delete('/harmony-ledger/statements/$statementId');

  /// Re-parses a FAILED statement. Returns it in PROCESSING state.
  Future<HarmonyStatement> retryStatement(String statementId) async {
    final data =
        await _api.post('/harmony-ledger/statements/$statementId/retry')
            as Map<String, dynamic>;
    return HarmonyStatement.fromJson(
      data['statement'] as Map<String, dynamic>,
    );
  }

  Future<void> confirmTransaction({
    required String statementId,
    required String txnId,
    required String txnDate,
    String? type,
    // Sentinel-free: pass `clearGroup: true` to explicitly unallocate.
    String? groupId,
    bool clearGroup = false,
  }) => _api.post(
    '/harmony-ledger/statements/$statementId/transactions/$txnId/confirm',
    {
      'txnDate': txnDate,
      if (type != null) 'type': type,
      if (clearGroup) 'groupId': null else if (groupId != null) 'groupId': groupId,
    },
  );

  Future<void> dismissTransaction({
    required String statementId,
    required String txnId,
    required String txnDate,
  }) => _api.post(
    '/harmony-ledger/statements/$statementId/transactions/$txnId/dismiss',
    {'txnDate': txnDate},
  );

  /// Puts a skipped (dismissed) transaction back in the review queue.
  Future<void> reopenTransaction({
    required String statementId,
    required String txnId,
    required String txnDate,
  }) => _api.post(
    '/harmony-ledger/statements/$statementId/transactions/$txnId/reopen',
    {'txnDate': txnDate},
  );

  /// Undoes a confirm: deletes the created ledger entry and puts the
  /// transaction back in the review queue.
  Future<void> unconfirmTransaction({
    required String statementId,
    required String txnId,
    required String txnDate,
  }) => _api.post(
    '/harmony-ledger/statements/$statementId/transactions/$txnId/unconfirm',
    {'txnDate': txnDate},
  );

  Future<HarmonyBulkConfirmResult> confirmAll(
    String statementId, {
    bool includeDuplicates = false,
  }) async {
    final data = await _api.post(
      '/harmony-ledger/statements/$statementId/confirm-all',
      {'includeDuplicates': includeDuplicates},
    );
    return HarmonyBulkConfirmResult.fromJson(data as Map<String, dynamic>);
  }
}
