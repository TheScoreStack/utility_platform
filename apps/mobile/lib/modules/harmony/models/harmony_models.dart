/// Domain models for the Harmony Collective module, mirroring the shapes in
/// `packages/shared/src/types.ts`.
library;

double _asDouble(dynamic value) => (value as num?)?.toDouble() ?? 0;

class HarmonyAccess {
  final bool allowed;
  final bool isAdmin;

  const HarmonyAccess({required this.allowed, required this.isAdmin});

  factory HarmonyAccess.fromJson(Map<String, dynamic> json) => HarmonyAccess(
    allowed: json['allowed'] == true,
    isAdmin: json['isAdmin'] == true,
  );
}

class HarmonyGroup {
  final String groupId;
  final String name;
  final bool isActive;

  const HarmonyGroup({
    required this.groupId,
    required this.name,
    required this.isActive,
  });

  factory HarmonyGroup.fromJson(Map<String, dynamic> json) => HarmonyGroup(
    groupId: json['groupId'] as String,
    name: json['name'] as String,
    isActive: json['isActive'] == true,
  );
}

class HarmonyTotals {
  final double donations;
  final double income;
  final double expenses;
  final double reimbursements;
  final double net;

  const HarmonyTotals({
    required this.donations,
    required this.income,
    required this.expenses,
    required this.reimbursements,
    required this.net,
  });

  factory HarmonyTotals.fromJson(Map<String, dynamic> json) => HarmonyTotals(
    donations: _asDouble(json['donations']),
    income: _asDouble(json['income']),
    expenses: _asDouble(json['expenses']),
    reimbursements: _asDouble(json['reimbursements']),
    net: _asDouble(json['net']),
  );
}

class HarmonyGroupSummary {
  final String groupId;
  final String name;
  final double net;
  final double donations;
  final double income;
  final double reimbursements;
  final double expenses;
  final double transfersIn;
  final double transfersOut;

  const HarmonyGroupSummary({
    required this.groupId,
    required this.name,
    required this.net,
    required this.donations,
    required this.income,
    required this.reimbursements,
    required this.expenses,
    required this.transfersIn,
    required this.transfersOut,
  });

  double get inflow => donations + income + reimbursements + transfersIn;
  double get outflow => expenses + transfersOut;

  factory HarmonyGroupSummary.fromJson(Map<String, dynamic> json) =>
      HarmonyGroupSummary(
        groupId: json['groupId'] as String,
        name: json['name'] as String,
        net: _asDouble(json['net']),
        donations: _asDouble(json['donations']),
        income: _asDouble(json['income']),
        reimbursements: _asDouble(json['reimbursements']),
        expenses: _asDouble(json['expenses']),
        transfersIn: _asDouble(json['transfersIn']),
        transfersOut: _asDouble(json['transfersOut']),
      );
}

class HarmonyEntry {
  final String entryId;
  final String type;
  final double amount;
  final String currency;
  final String? description;
  final String? source;
  final String? groupId;
  final String? groupName;
  final String recordedAt;
  final String? occurredAt;

  /// Set when this entry came from a statement import — links back to the
  /// original uploaded file.
  final String? importStatementId;

  const HarmonyEntry({
    required this.entryId,
    required this.type,
    required this.amount,
    required this.currency,
    this.description,
    this.source,
    this.groupId,
    this.groupName,
    required this.recordedAt,
    this.occurredAt,
    this.importStatementId,
  });

  factory HarmonyEntry.fromJson(Map<String, dynamic> json) => HarmonyEntry(
    entryId: json['entryId'] as String,
    type: json['type'] as String,
    amount: _asDouble(json['amount']),
    currency: (json['currency'] as String?) ?? 'USD',
    description: json['description'] as String?,
    source: json['source'] as String?,
    groupId: json['groupId'] as String?,
    groupName: json['groupName'] as String?,
    recordedAt: json['recordedAt'] as String,
    occurredAt: json['occurredAt'] as String?,
    importStatementId: json['importStatementId'] as String?,
  );

  bool get isInflow => type != 'EXPENSE';
}

class HarmonyTransfer {
  final String transferId;
  final double amount;
  final String currency;
  final String? fromGroupId;
  final String? fromGroupName;
  final String? toGroupId;
  final String? toGroupName;
  final String? note;
  final String createdAt;
  final String? createdByName;

  const HarmonyTransfer({
    required this.transferId,
    required this.amount,
    required this.currency,
    this.fromGroupId,
    this.fromGroupName,
    this.toGroupId,
    this.toGroupName,
    this.note,
    required this.createdAt,
    this.createdByName,
  });

  factory HarmonyTransfer.fromJson(Map<String, dynamic> json) =>
      HarmonyTransfer(
        transferId: json['transferId'] as String,
        amount: _asDouble(json['amount']),
        currency: (json['currency'] as String?) ?? 'USD',
        fromGroupId: json['fromGroupId'] as String?,
        fromGroupName: json['fromGroupName'] as String?,
        toGroupId: json['toGroupId'] as String?,
        toGroupName: json['toGroupName'] as String?,
        note: json['note'] as String?,
        createdAt: json['createdAt'] as String,
        createdByName: json['createdByName'] as String?,
      );
}

class HarmonyLedgerData {
  final List<HarmonyEntry> entries;
  final HarmonyTotals totals;
  final List<HarmonyGroup> groups;
  final List<HarmonyGroupSummary> groupSummaries;
  final List<HarmonyTransfer> transfers;

  const HarmonyLedgerData({
    required this.entries,
    required this.totals,
    required this.groups,
    required this.groupSummaries,
    required this.transfers,
  });

  factory HarmonyLedgerData.fromJson(Map<String, dynamic> json) =>
      HarmonyLedgerData(
        entries: [
          for (final entry in (json['entries'] as List? ?? []))
            HarmonyEntry.fromJson(entry as Map<String, dynamic>),
        ],
        totals: HarmonyTotals.fromJson(
          (json['totals'] as Map<String, dynamic>?) ?? {},
        ),
        groups: [
          for (final group in (json['groups'] as List? ?? []))
            HarmonyGroup.fromJson(group as Map<String, dynamic>),
        ],
        groupSummaries: [
          for (final summary in (json['groupSummaries'] as List? ?? []))
            HarmonyGroupSummary.fromJson(summary as Map<String, dynamic>),
        ],
        transfers: [
          for (final transfer in (json['transfers'] as List? ?? []))
            HarmonyTransfer.fromJson(transfer as Map<String, dynamic>),
        ],
      );
}

class HarmonyStatementCounts {
  final int total;
  final int pending;
  final int confirmed;
  final int dismissed;
  final int duplicates;

  const HarmonyStatementCounts({
    required this.total,
    required this.pending,
    required this.confirmed,
    required this.dismissed,
    required this.duplicates,
  });

  factory HarmonyStatementCounts.fromJson(Map<String, dynamic> json) =>
      HarmonyStatementCounts(
        total: (json['total'] as num?)?.toInt() ?? 0,
        pending: (json['pending'] as num?)?.toInt() ?? 0,
        confirmed: (json['confirmed'] as num?)?.toInt() ?? 0,
        dismissed: (json['dismissed'] as num?)?.toInt() ?? 0,
        duplicates: (json['duplicates'] as num?)?.toInt() ?? 0,
      );
}

class HarmonyStatement {
  final String statementId;
  final String fileName;
  final String fileType;
  final String sourceType;
  final String status;
  final String? errorMessage;
  final HarmonyStatementCounts? counts;
  final String uploadedAt;
  final String? uploadedByName;

  const HarmonyStatement({
    required this.statementId,
    required this.fileName,
    required this.fileType,
    required this.sourceType,
    required this.status,
    this.errorMessage,
    this.counts,
    required this.uploadedAt,
    this.uploadedByName,
  });

  factory HarmonyStatement.fromJson(Map<String, dynamic> json) =>
      HarmonyStatement(
        statementId: json['statementId'] as String,
        fileName: json['fileName'] as String,
        fileType: json['fileType'] as String,
        sourceType: json['sourceType'] as String,
        status: json['status'] as String,
        errorMessage: json['errorMessage'] as String?,
        counts: json['counts'] is Map<String, dynamic>
            ? HarmonyStatementCounts.fromJson(
                json['counts'] as Map<String, dynamic>,
              )
            : null,
        uploadedAt: json['uploadedAt'] as String,
        uploadedByName: json['uploadedByName'] as String?,
      );

  bool get isParsed => status == 'PARSED';
  bool get isFailed => status == 'FAILED';
  bool get isProcessing => status == 'PROCESSING' || status == 'PENDING_UPLOAD';
}

class HarmonyStagedTxn {
  final String txnId;
  final String statementId;
  final String txnDate;
  final double amount;
  final String currency;
  final String direction;
  final String rawDescription;
  final String? counterparty;
  final String suggestedType;
  final String? suggestedGroupId;
  final String? suggestedGroupName;
  final String? suggestedCategory;
  final bool isLikelyInternalTransfer;
  final bool isDuplicate;
  final String status;
  final String? reviewedByName;

  const HarmonyStagedTxn({
    required this.txnId,
    required this.statementId,
    required this.txnDate,
    required this.amount,
    required this.currency,
    required this.direction,
    required this.rawDescription,
    this.counterparty,
    required this.suggestedType,
    this.suggestedGroupId,
    this.suggestedGroupName,
    this.suggestedCategory,
    required this.isLikelyInternalTransfer,
    required this.isDuplicate,
    required this.status,
    this.reviewedByName,
  });

  factory HarmonyStagedTxn.fromJson(Map<String, dynamic> json) =>
      HarmonyStagedTxn(
        txnId: json['txnId'] as String,
        statementId: json['statementId'] as String,
        txnDate: json['txnDate'] as String,
        amount: _asDouble(json['amount']),
        currency: (json['currency'] as String?) ?? 'USD',
        direction: json['direction'] as String,
        rawDescription: json['rawDescription'] as String,
        counterparty: json['counterparty'] as String?,
        suggestedType: json['suggestedType'] as String,
        suggestedGroupId: json['suggestedGroupId'] as String?,
        suggestedGroupName: json['suggestedGroupName'] as String?,
        suggestedCategory: json['suggestedCategory'] as String?,
        isLikelyInternalTransfer: json['isLikelyInternalTransfer'] == true,
        isDuplicate: json['duplicateOf'] != null,
        status: json['status'] as String,
        reviewedByName: json['reviewedByName'] as String?,
      );

  bool get isPending => status == 'PENDING';
  bool get isInflow => direction == 'IN';
}

class HarmonyStatementDetail {
  final HarmonyStatement statement;
  final List<HarmonyStagedTxn> transactions;
  final List<HarmonyGroup> groups;

  const HarmonyStatementDetail({
    required this.statement,
    required this.transactions,
    required this.groups,
  });

  factory HarmonyStatementDetail.fromJson(Map<String, dynamic> json) =>
      HarmonyStatementDetail(
        statement: HarmonyStatement.fromJson(
          json['statement'] as Map<String, dynamic>,
        ),
        transactions: [
          for (final txn in (json['transactions'] as List? ?? []))
            HarmonyStagedTxn.fromJson(txn as Map<String, dynamic>),
        ],
        groups: [
          for (final group in (json['groups'] as List? ?? []))
            HarmonyGroup.fromJson(group as Map<String, dynamic>),
        ],
      );
}

class HarmonyBulkConfirmResult {
  final int confirmed;
  final int skipped;
  final int remaining;

  const HarmonyBulkConfirmResult({
    required this.confirmed,
    required this.skipped,
    required this.remaining,
  });

  factory HarmonyBulkConfirmResult.fromJson(Map<String, dynamic> json) =>
      HarmonyBulkConfirmResult(
        confirmed: (json['confirmed'] as num?)?.toInt() ?? 0,
        skipped: (json['skipped'] as num?)?.toInt() ?? 0,
        remaining: (json['remaining'] as num?)?.toInt() ?? 0,
      );
}
