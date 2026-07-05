/// Hand-ported domain models from `packages/shared/src/types.ts` plus the
/// API response shapes the mobile app consumes (`TripListItem`, `TripSummary`,
/// receipt analyze/presign responses). All parsers tolerate missing or null
/// optional fields.
library;

double? _optDouble(dynamic value) => value is num ? value.toDouble() : null;

double _reqDouble(dynamic value) => value is num ? value.toDouble() : 0;

String _reqString(dynamic value) => value is String ? value : '';

List<String> _stringList(dynamic value) =>
    value is List ? value.whereType<String>().toList() : <String>[];

List<T> _mapList<T>(dynamic value, T Function(Map<String, dynamic>) fromJson) {
  if (value is! List) return <T>[];
  return value.whereType<Map<String, dynamic>>().map(fromJson).toList();
}

Map<String, dynamic> _withoutNulls(Map<String, dynamic> json) =>
    Map.fromEntries(json.entries.where((entry) => entry.value != null));

class PaymentMethods {
  final String? venmo;
  final String? paypal;
  final String? zelle;

  /// Which method ('venmo' | 'paypal' | 'zelle') this person prefers to be
  /// paid through.
  final String? primary;

  const PaymentMethods({this.venmo, this.paypal, this.zelle, this.primary});

  factory PaymentMethods.fromJson(Map<String, dynamic> json) => PaymentMethods(
    venmo: json['venmo'] as String?,
    paypal: json['paypal'] as String?,
    zelle: json['zelle'] as String?,
    primary: json['primary'] as String?,
  );

  Map<String, dynamic> toJson() => _withoutNulls({
    'venmo': venmo,
    'paypal': paypal,
    'zelle': zelle,
    'primary': primary,
  });

  /// Handle for a given method key, or null when unset/blank.
  String? handleFor(String method) {
    final value = switch (method) {
      'venmo' => venmo,
      'paypal' => paypal,
      'zelle' => zelle,
      _ => null,
    };
    return (value == null || value.trim().isEmpty) ? null : value;
  }

  bool get isEmpty =>
      handleFor('venmo') == null &&
      handleFor('paypal') == null &&
      handleFor('zelle') == null;

  /// Filled-in method keys with the preferred one first.
  List<String> get orderedKeys {
    final keys = ['venmo', 'paypal', 'zelle']
        .where((method) => handleFor(method) != null)
        .toList();
    final preferred = primary;
    if (preferred != null && keys.remove(preferred)) {
      keys.insert(0, preferred);
    }
    return keys;
  }
}

class Trip {
  final String tripId;
  final String ownerId;
  final String name;
  final String? startDate;
  final String? endDate;
  final String createdAt;
  final String updatedAt;
  final String currency;
  final String? archivedAt;
  final String? archivedBy;

  const Trip({
    required this.tripId,
    required this.ownerId,
    required this.name,
    this.startDate,
    this.endDate,
    required this.createdAt,
    required this.updatedAt,
    required this.currency,
    this.archivedAt,
    this.archivedBy,
  });

  factory Trip.fromJson(Map<String, dynamic> json) => Trip(
    tripId: _reqString(json['tripId']),
    ownerId: _reqString(json['ownerId']),
    name: _reqString(json['name']),
    startDate: json['startDate'] as String?,
    endDate: json['endDate'] as String?,
    createdAt: _reqString(json['createdAt']),
    updatedAt: _reqString(json['updatedAt']),
    currency: (json['currency'] as String?) ?? 'USD',
    archivedAt: json['archivedAt'] as String?,
    archivedBy: json['archivedBy'] as String?,
  );

  Map<String, dynamic> toJson() => _withoutNulls({
    'tripId': tripId,
    'ownerId': ownerId,
    'name': name,
    'startDate': startDate,
    'endDate': endDate,
    'createdAt': createdAt,
    'updatedAt': updatedAt,
    'currency': currency,
    'archivedAt': archivedAt,
    'archivedBy': archivedBy,
  });
}

/// `GET /trips` list rows: the trip plus the caller's balance summary.
class TripListItem {
  final Trip trip;
  final double outstandingBalance;
  final double owedToYou;
  final bool hasPendingActions;

  const TripListItem({
    required this.trip,
    required this.outstandingBalance,
    required this.owedToYou,
    required this.hasPendingActions,
  });

  factory TripListItem.fromJson(Map<String, dynamic> json) => TripListItem(
    trip: Trip.fromJson(json),
    outstandingBalance: _reqDouble(json['outstandingBalance']),
    owedToYou: _reqDouble(json['owedToYou']),
    hasPendingActions: json['hasPendingActions'] == true,
  );
}

class TripMember {
  final String tripId;
  final String memberId;
  final String displayName;
  final String? email;
  final String addedBy;
  final String createdAt;
  final PaymentMethods? paymentMethods;

  /// True for members added by name only, before they have an account.
  final bool placeholder;

  const TripMember({
    required this.tripId,
    required this.memberId,
    required this.displayName,
    this.email,
    required this.addedBy,
    required this.createdAt,
    this.paymentMethods,
    this.placeholder = false,
  });

  factory TripMember.fromJson(Map<String, dynamic> json) => TripMember(
    tripId: _reqString(json['tripId']),
    memberId: _reqString(json['memberId']),
    displayName: _reqString(json['displayName']),
    email: json['email'] as String?,
    addedBy: _reqString(json['addedBy']),
    createdAt: _reqString(json['createdAt']),
    paymentMethods: json['paymentMethods'] is Map<String, dynamic>
        ? PaymentMethods.fromJson(
            json['paymentMethods'] as Map<String, dynamic>,
          )
        : null,
    placeholder: json['placeholder'] == true,
  );

  Map<String, dynamic> toJson() => _withoutNulls({
    'tripId': tripId,
    'memberId': memberId,
    'displayName': displayName,
    'email': email,
    'addedBy': addedBy,
    'createdAt': createdAt,
    'paymentMethods': paymentMethods?.toJson(),
  });
}

class ExpenseAllocation {
  final String memberId;
  final double amount;

  const ExpenseAllocation({required this.memberId, required this.amount});

  factory ExpenseAllocation.fromJson(Map<String, dynamic> json) =>
      ExpenseAllocation(
        memberId: _reqString(json['memberId']),
        amount: _reqDouble(json['amount']),
      );

  Map<String, dynamic> toJson() => {'memberId': memberId, 'amount': amount};
}

class ExpenseLineItem {
  final String lineItemId;
  final String description;
  final double? quantity;
  final double? unitPrice;
  final double total;
  final List<String> assignedMemberIds;

  const ExpenseLineItem({
    required this.lineItemId,
    required this.description,
    this.quantity,
    this.unitPrice,
    required this.total,
    required this.assignedMemberIds,
  });

  factory ExpenseLineItem.fromJson(Map<String, dynamic> json) =>
      ExpenseLineItem(
        lineItemId: _reqString(json['lineItemId']),
        description: _reqString(json['description']),
        quantity: _optDouble(json['quantity']),
        unitPrice: _optDouble(json['unitPrice']),
        total: _reqDouble(json['total']),
        assignedMemberIds: _stringList(json['assignedMemberIds']),
      );

  Map<String, dynamic> toJson() => _withoutNulls({
    'lineItemId': lineItemId,
    'description': description,
    'quantity': quantity,
    'unitPrice': unitPrice,
    'total': total,
    'assignedMemberIds': assignedMemberIds,
  });
}

class Expense {
  final String tripId;
  final String expenseId;
  final String createdAt;
  final String updatedAt;
  final String description;
  final String? vendor;
  final String? category;
  final double total;
  final String currency;
  final double? tax;
  final double? tip;
  final String paidByMemberId;
  final List<String> sharedWithMemberIds;
  final List<ExpenseAllocation> allocations;
  final List<ExpenseLineItem>? lineItems;
  final String? extrasSplitMode;
  final String? receiptId;
  final String? receiptPreviewUrl;

  /// Draft expenses are visible only to their creator and excluded from
  /// balances until published.
  final bool draft;
  final String? createdBy;
  final String? deletedAt;
  final String? deletedBy;

  const Expense({
    required this.tripId,
    required this.expenseId,
    required this.createdAt,
    required this.updatedAt,
    required this.description,
    this.vendor,
    this.category,
    required this.total,
    required this.currency,
    this.tax,
    this.tip,
    required this.paidByMemberId,
    required this.sharedWithMemberIds,
    required this.allocations,
    this.lineItems,
    this.extrasSplitMode,
    this.receiptId,
    this.receiptPreviewUrl,
    this.draft = false,
    this.createdBy,
    this.deletedAt,
    this.deletedBy,
  });

  factory Expense.fromJson(Map<String, dynamic> json) => Expense(
    tripId: _reqString(json['tripId']),
    expenseId: _reqString(json['expenseId']),
    createdAt: _reqString(json['createdAt']),
    updatedAt: _reqString(json['updatedAt']),
    description: _reqString(json['description']),
    vendor: json['vendor'] as String?,
    category: json['category'] as String?,
    total: _reqDouble(json['total']),
    currency: (json['currency'] as String?) ?? 'USD',
    tax: _optDouble(json['tax']),
    tip: _optDouble(json['tip']),
    paidByMemberId: _reqString(json['paidByMemberId']),
    sharedWithMemberIds: _stringList(json['sharedWithMemberIds']),
    allocations: _mapList(json['allocations'], ExpenseAllocation.fromJson),
    lineItems: json['lineItems'] is List
        ? _mapList(json['lineItems'], ExpenseLineItem.fromJson)
        : null,
    extrasSplitMode: json['extrasSplitMode'] as String?,
    receiptId: json['receiptId'] as String?,
    receiptPreviewUrl: json['receiptPreviewUrl'] as String?,
    draft: json['draft'] == true,
    createdBy: json['createdBy'] as String?,
    deletedAt: json['deletedAt'] as String?,
    deletedBy: json['deletedBy'] as String?,
  );

  Map<String, dynamic> toJson() => _withoutNulls({
    'tripId': tripId,
    'expenseId': expenseId,
    'createdAt': createdAt,
    'updatedAt': updatedAt,
    'description': description,
    'vendor': vendor,
    'category': category,
    'total': total,
    'currency': currency,
    'tax': tax,
    'tip': tip,
    'paidByMemberId': paidByMemberId,
    'sharedWithMemberIds': sharedWithMemberIds,
    'allocations': allocations.map((a) => a.toJson()).toList(),
    'lineItems': lineItems?.map((item) => item.toJson()).toList(),
    'extrasSplitMode': extrasSplitMode,
    'receiptId': receiptId,
    'receiptPreviewUrl': receiptPreviewUrl,
    'draft': draft ? true : null,
    'createdBy': createdBy,
    'deletedAt': deletedAt,
    'deletedBy': deletedBy,
  });
}

/// `POST /trips/:id/receipts` response (presigned upload).
class Receipt {
  final String tripId;
  final String receiptId;
  final String storageKey;
  final String uploadUrl;
  final String fileName;
  final String status;
  final TextractExtraction? extractedData;

  /// Receipts uploaded for a draft expense stay hidden from other members
  /// until the expense is published.
  final bool draft;
  final String? createdBy;
  final String createdAt;
  final String updatedAt;

  const Receipt({
    required this.tripId,
    required this.receiptId,
    required this.storageKey,
    required this.uploadUrl,
    required this.fileName,
    required this.status,
    this.extractedData,
    this.draft = false,
    this.createdBy,
    required this.createdAt,
    required this.updatedAt,
  });

  factory Receipt.fromJson(Map<String, dynamic> json) => Receipt(
    tripId: _reqString(json['tripId']),
    receiptId: _reqString(json['receiptId']),
    storageKey: _reqString(json['storageKey']),
    uploadUrl: _reqString(json['uploadUrl']),
    fileName: _reqString(json['fileName']),
    status: _reqString(json['status']),
    extractedData: json['extractedData'] is Map<String, dynamic>
        ? TextractExtraction.fromJson(
            json['extractedData'] as Map<String, dynamic>,
          )
        : null,
    draft: json['draft'] == true,
    createdBy: json['createdBy'] as String?,
    createdAt: _reqString(json['createdAt']),
    updatedAt: _reqString(json['updatedAt']),
  );
}

class ExtractedLineItem {
  final String? description;
  final double? quantity;
  final double? unitPrice;
  final double? total;

  const ExtractedLineItem({
    this.description,
    this.quantity,
    this.unitPrice,
    this.total,
  });

  factory ExtractedLineItem.fromJson(Map<String, dynamic> json) =>
      ExtractedLineItem(
        description: json['description'] as String?,
        quantity: _optDouble(json['quantity']),
        unitPrice: _optDouble(json['unitPrice']),
        total: _optDouble(json['total']),
      );

  Map<String, dynamic> toJson() => _withoutNulls({
    'description': description,
    'quantity': quantity,
    'unitPrice': unitPrice,
    'total': total,
  });
}

/// `POST /trips/:id/receipts/analyze` → `{ extraction: TextractExtraction }`.
class TextractExtraction {
  final String? merchantName;
  final double? total;
  final double? subtotal;
  final double? tax;
  final double? tip;
  final String? date;
  final List<ExtractedLineItem> lineItems;

  const TextractExtraction({
    this.merchantName,
    this.total,
    this.subtotal,
    this.tax,
    this.tip,
    this.date,
    this.lineItems = const [],
  });

  factory TextractExtraction.fromJson(Map<String, dynamic> json) =>
      TextractExtraction(
        merchantName: json['merchantName'] as String?,
        total: _optDouble(json['total']),
        subtotal: _optDouble(json['subtotal']),
        tax: _optDouble(json['tax']),
        tip: _optDouble(json['tip']),
        date: json['date'] as String?,
        lineItems: _mapList(json['lineItems'], ExtractedLineItem.fromJson),
      );

  Map<String, dynamic> toJson() => _withoutNulls({
    'merchantName': merchantName,
    'total': total,
    'subtotal': subtotal,
    'tax': tax,
    'tip': tip,
    'date': date,
    'lineItems': lineItems.map((item) => item.toJson()).toList(),
  });
}

class Settlement {
  final String tripId;
  final String settlementId;
  final String fromMemberId;
  final String toMemberId;
  final double amount;
  final String currency;
  final String? note;
  final String createdAt;
  final String? confirmedAt;
  final String createdBy;
  final String? deletedAt;
  final String? deletedBy;

  const Settlement({
    required this.tripId,
    required this.settlementId,
    required this.fromMemberId,
    required this.toMemberId,
    required this.amount,
    required this.currency,
    this.note,
    required this.createdAt,
    this.confirmedAt,
    required this.createdBy,
    this.deletedAt,
    this.deletedBy,
  });

  factory Settlement.fromJson(Map<String, dynamic> json) => Settlement(
    tripId: _reqString(json['tripId']),
    settlementId: _reqString(json['settlementId']),
    fromMemberId: _reqString(json['fromMemberId']),
    toMemberId: _reqString(json['toMemberId']),
    amount: _reqDouble(json['amount']),
    currency: (json['currency'] as String?) ?? 'USD',
    note: json['note'] as String?,
    createdAt: _reqString(json['createdAt']),
    confirmedAt: json['confirmedAt'] as String?,
    createdBy: _reqString(json['createdBy']),
    deletedAt: json['deletedAt'] as String?,
    deletedBy: json['deletedBy'] as String?,
  );
}

/// `GET /profile` → `{ profile: UserProfile }`.
class UserProfile {
  final String userId;
  final String? displayName;
  final String? email;
  final PaymentMethods? paymentMethods;
  final bool emailDigestOptIn;

  /// Push preferences; missing keys default to on.
  final bool notifyActivity;
  final bool notifyComments;

  const UserProfile({
    required this.userId,
    this.displayName,
    this.email,
    this.paymentMethods,
    this.emailDigestOptIn = false,
    this.notifyActivity = true,
    this.notifyComments = true,
  });

  factory UserProfile.fromJson(Map<String, dynamic> json) {
    final prefs = json['notificationPrefs'] is Map<String, dynamic>
        ? json['notificationPrefs'] as Map<String, dynamic>
        : const <String, dynamic>{};
    return UserProfile(
      userId: _reqString(json['userId']),
      displayName: json['displayName'] as String?,
      email: json['email'] as String?,
      paymentMethods: json['paymentMethods'] is Map<String, dynamic>
          ? PaymentMethods.fromJson(
              json['paymentMethods'] as Map<String, dynamic>,
            )
          : null,
      emailDigestOptIn: json['emailDigestOptIn'] == true,
      notifyActivity: prefs['activity'] != false,
      notifyComments: prefs['comments'] != false,
    );
  }
}

class BalanceRow {
  final String memberId;
  final String displayName;
  final double balance;

  const BalanceRow({
    required this.memberId,
    required this.displayName,
    required this.balance,
  });

  factory BalanceRow.fromJson(Map<String, dynamic> json) => BalanceRow(
    memberId: _reqString(json['memberId']),
    displayName: _reqString(json['displayName']),
    balance: _reqDouble(json['balance']),
  );
}

/// `GET /trips/:id` response (see `tripService.getTripSummary`).
class ExpenseComment {
  final String tripId;
  final String expenseId;
  final String commentId;
  final String authorId;
  final String? authorName;
  final String body;
  final String createdAt;

  const ExpenseComment({
    required this.tripId,
    required this.expenseId,
    required this.commentId,
    required this.authorId,
    this.authorName,
    required this.body,
    required this.createdAt,
  });

  factory ExpenseComment.fromJson(Map<String, dynamic> json) => ExpenseComment(
    tripId: _reqString(json['tripId']),
    expenseId: _reqString(json['expenseId']),
    commentId: _reqString(json['commentId']),
    authorId: _reqString(json['authorId']),
    authorName: json['authorName'] as String?,
    body: _reqString(json['body']),
    createdAt: _reqString(json['createdAt']),
  );
}

/// Template that materializes an evenly split expense on a schedule.
class RecurringExpense {
  final String tripId;
  final String recurringId;
  final String description;
  final double total;
  final String currency;
  final String paidByMemberId;
  final List<String> sharedWithMemberIds;

  /// 'weekly' | 'monthly'
  final String cadence;
  final String nextRunAt;
  final String? lastRunAt;
  final String createdBy;
  final String createdAt;

  const RecurringExpense({
    required this.tripId,
    required this.recurringId,
    required this.description,
    required this.total,
    required this.currency,
    required this.paidByMemberId,
    required this.sharedWithMemberIds,
    required this.cadence,
    required this.nextRunAt,
    this.lastRunAt,
    required this.createdBy,
    required this.createdAt,
  });

  factory RecurringExpense.fromJson(Map<String, dynamic> json) =>
      RecurringExpense(
        tripId: _reqString(json['tripId']),
        recurringId: _reqString(json['recurringId']),
        description: _reqString(json['description']),
        total: _reqDouble(json['total']),
        currency: (json['currency'] as String?) ?? 'USD',
        paidByMemberId: _reqString(json['paidByMemberId']),
        sharedWithMemberIds: _stringList(json['sharedWithMemberIds']),
        cadence: _reqString(json['cadence']),
        nextRunAt: _reqString(json['nextRunAt']),
        lastRunAt: json['lastRunAt'] as String?,
        createdBy: _reqString(json['createdBy']),
        createdAt: _reqString(json['createdAt']),
      );
}

class TripSummary {
  final Trip trip;
  final List<TripMember> members;
  final List<Expense> expenses;

  /// The requesting user's own unpublished drafts (server-filtered; never in
  /// [expenses] or [balances]). Absent on older API responses → empty.
  final List<Expense> draftExpenses;
  final List<Expense> deletedExpenses;
  final List<Receipt> receipts;
  final List<Settlement> settlements;
  final List<Settlement> deletedSettlements;
  final List<BalanceRow> balances;
  final List<Settlement> pendingSettlements;
  final List<RecurringExpense> recurringExpenses;
  final String currentUserId;

  const TripSummary({
    required this.trip,
    required this.members,
    required this.expenses,
    this.draftExpenses = const [],
    required this.deletedExpenses,
    required this.receipts,
    required this.settlements,
    required this.deletedSettlements,
    required this.balances,
    required this.pendingSettlements,
    this.recurringExpenses = const [],
    required this.currentUserId,
  });

  factory TripSummary.fromJson(Map<String, dynamic> json) => TripSummary(
    trip: Trip.fromJson((json['trip'] as Map<String, dynamic>?) ?? const {}),
    members: _mapList(json['members'], TripMember.fromJson),
    expenses: _mapList(json['expenses'], Expense.fromJson),
    draftExpenses: _mapList(json['draftExpenses'], Expense.fromJson),
    deletedExpenses: _mapList(json['deletedExpenses'], Expense.fromJson),
    receipts: _mapList(json['receipts'], Receipt.fromJson),
    settlements: _mapList(json['settlements'], Settlement.fromJson),
    deletedSettlements: _mapList(
      json['deletedSettlements'],
      Settlement.fromJson,
    ),
    balances: _mapList(json['balances'], BalanceRow.fromJson),
    pendingSettlements: _mapList(
      json['pendingSettlements'],
      Settlement.fromJson,
    ),
    recurringExpenses: _mapList(
      json['recurringExpenses'],
      RecurringExpense.fromJson,
    ),
    currentUserId: _reqString(json['currentUserId']),
  );
}
