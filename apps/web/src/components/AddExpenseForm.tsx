import { CSSProperties, ChangeEvent, FormEvent, WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { EXPENSE_CATEGORIES, resolveExpenseCategory } from "../lib/expenseCategories";
import { getInitials, seedAvatar } from "../lib/avatarPalette";
import { CURRENCY_OPTIONS } from "../lib/fx";
import { computeItemizedAllocations, splitTotalIntoUnits } from "../lib/itemSplit";
import type {
  ExtrasSplitMode,
  TripMember,
  Receipt,
  ReceiptUploadResponse,
  TextractExtraction
} from "../types";

const roundToCents = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const parseCurrencyInput = (value: string): number => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return roundToCents(parsed);
};

const distributeEvenly = (
  amount: number,
  memberIds: string[],
  remainderTargetId?: string
): Record<string, number> => {
  if (memberIds.length === 0 || Math.abs(amount) < 0.0001) {
    return {};
  }

  const totalCents = Math.round(amount * 100);
  const absoluteCents = Math.abs(totalCents);
  const baseShare = Math.floor(absoluteCents / memberIds.length);
  let remainder = absoluteCents - baseShare * memberIds.length;
  const sign = totalCents < 0 ? -1 : 1;
  const hasTarget =
    remainderTargetId !== undefined && memberIds.includes(remainderTargetId);

  return memberIds.reduce<Record<string, number>>((acc, memberId) => {
    let cents = baseShare;
    if (remainder > 0) {
      if (hasTarget && memberId === remainderTargetId) {
        cents += remainder;
        remainder = 0;
      } else if (!hasTarget) {
        cents += 1;
        remainder -= 1;
      }
    }
    acc[memberId] = (cents * sign) / 100;
    return acc;
  }, {});
};

interface AllocationDetail {
  memberId: string;
  baseAmount: number;
  extrasShare: number;
  amount: number;
}

const computeCustomAllocations = (
  sharedMembers: TripMember[],
  allocationInputs: Record<string, string>,
  extrasTotal: number,
  splitExtrasEvenly: boolean
): { perMember: AllocationDetail[]; total: number; baseTotal: number; extras: Record<string, number> } => {
  const memberIds = sharedMembers.map((member) => member.memberId);
  const extrasDistribution = splitExtrasEvenly
    ? distributeEvenly(extrasTotal, memberIds)
    : {};

  let totalCents = 0;
  let baseTotalCents = 0;

  const perMember = sharedMembers.map((member) => {
    const baseAmount = parseCurrencyInput(
      allocationInputs[member.memberId] ?? "0"
    );
    const extrasShare = extrasDistribution[member.memberId] ?? 0;
    const amount = roundToCents(baseAmount + extrasShare);
    baseTotalCents += Math.round(baseAmount * 100);
    totalCents += Math.round(amount * 100);
    return {
      memberId: member.memberId,
      baseAmount,
      extrasShare,
      amount
    };
  });

  return {
    perMember,
    total: totalCents / 100,
    baseTotal: baseTotalCents / 100,
    extras: extrasDistribution
  };
};

const inferPreviewType = (fileName?: string, contentType?: string | null) => {
  const normalizedType = contentType?.toLowerCase();
  if (normalizedType) {
    if (normalizedType.includes("pdf")) {
      return "application/pdf";
    }
    if (normalizedType.startsWith("image/")) {
      return "image";
    }
  }

  if (fileName) {
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".pdf")) {
      return "application/pdf";
    }
    if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(lower)) {
      return "image";
    }
  }

  return null;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface ExpenseLineItemInput {
  description: string;
  quantity?: number;
  unitPrice?: number;
  total: number;
  assignedMemberIds: string[];
}

export interface CreateExpenseInput {
  description: string;
  vendor?: string;
  category?: string;
  total: number;
  currency: string;
  tax?: number;
  tip?: number;
  paidByMemberId: string;
  sharedWithMemberIds: string[];
  splitEvenly: boolean;
  remainderMemberId?: string;
  allocations?: { memberId: string; amount: number }[];
  lineItems?: ExpenseLineItemInput[];
  extrasSplitMode?: ExtrasSplitMode;
  receiptId?: string;
  /** Save privately — visible only to the creator until published. */
  draft?: boolean;
  /** Also create a recurring template (even splits only, create mode). */
  repeat?: "weekly" | "monthly";
}

type SplitMode = "even" | "custom" | "items";

interface ItemRow {
  key: string;
  description: string;
  quantity?: number;
  unitPrice?: number;
  totalInput: string;
  assignedMemberIds: string[];
}

interface AllocationSummaryItem {
  memberId: string;
  displayName: string;
  amount: number;
}

interface PendingExpenseConfirmation {
  payload: CreateExpenseInput;
  payerName: string;
  allocationSummary: AllocationSummaryItem[];
}

export type ExpensePrefill = {
  /** Bump this when re-applying the same data so the effect re-fires */
  nonce: number;
  description: string;
  vendor?: string;
  category?: string;
  subtotal: string;
  tax?: string;
  tip?: string;
  paidByMemberId: string;
  sharedWithMemberIds: string[];
  splitEvenly: boolean;
  allocations?: Record<string, string>;
  remainderMemberId?: string;
  /** When present, the form opens in "By item" mode with these rows. */
  lineItems?: Array<{
    description: string;
    quantity?: number;
    unitPrice?: number;
    total: string;
    assignedMemberIds: string[];
  }>;
  extrasSplitMode?: ExtrasSplitMode;
};

interface AddExpenseFormProps {
  tripId: string;
  members: TripMember[];
  currency: string;
  receipts: Receipt[];
  onSubmit: (payload: CreateExpenseInput) => Promise<unknown>;
  isSubmitting: boolean;
  currentUserId?: string;
  prefill?: ExpensePrefill | null;
  onPrefillConsumed?: () => void;
  /** When set, the form saves changes to this expense instead of creating. */
  editingLabel?: string | null;
  /** True when the expense being edited is still a draft. */
  editingIsDraft?: boolean;
  onCancelEdit?: () => void;
}

const AddExpenseForm = ({
  tripId,
  members,
  currency,
  receipts,
  onSubmit,
  isSubmitting,
  currentUserId,
  prefill,
  onPrefillConsumed,
  editingLabel,
  editingIsDraft,
  onCancelEdit
}: AddExpenseFormProps) => {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [prefillFlash, setPrefillFlash] = useState(false);
  const [mode, setMode] = useState<"quick" | "detailed">(() => {
    if (typeof window === "undefined") return "quick";
    return (
      (localStorage.getItem("addExpenseMode") as "quick" | "detailed") ||
      "quick"
    );
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("addExpenseMode", mode);
    }
  }, [mode]);

  // Prefill always includes detailed fields (custom splits, tax/tip),
  // so when one arrives switch to detailed mode so the user can see them.
  useEffect(() => {
    if (prefill) setMode("detailed");
  }, [prefill]);
  const [description, setDescription] = useState("");
  const [vendor, setVendor] = useState("");
  const [category, setCategory] = useState("");
  const [otherSelected, setOtherSelected] = useState(false);
  const [subtotalInput, setSubtotalInput] = useState("");
  const [taxInput, setTaxInput] = useState("");
  const [tipInput, setTipInput] = useState("");

  const resolvedCategory = useMemo(() => resolveExpenseCategory(category), [category]);

  // Auto-show the custom input whenever the current category value can't be
  // matched to a catalog entry (e.g. legacy free-text data being re-rendered).
  useEffect(() => {
    if (category && !resolvedCategory) {
      setOtherSelected(true);
    }
  }, [category, resolvedCategory]);

  const handleSelectCategory = useCallback((chipId: string) => {
    if (chipId === "other") {
      setOtherSelected(true);
      setCategory("");
    } else {
      setOtherSelected(false);
      setCategory((current) => (current === chipId ? "" : chipId));
    }
  }, []);

  const preferredPayer = useMemo(() => {
    if (
      currentUserId &&
      members.some((member) => member.memberId === currentUserId)
    ) {
      return currentUserId;
    }
    return members[0]?.memberId ?? "";
  }, [currentUserId, members]);

  const [paidBy, setPaidBy] = useState<string>(preferredPayer);
  const [payerManuallySelected, setPayerManuallySelected] = useState(false);
  const [sharedWith, setSharedWith] = useState<string[]>(
    members.map((member) => member.memberId)
  );
  const [splitMode, setSplitMode] = useState<SplitMode>("even");
  const [repeatCadence, setRepeatCadence] = useState<"" | "weekly" | "monthly">("");
  const splitEvenly = splitMode === "even";
  const [splitExtrasEvenly, setSplitExtrasEvenly] = useState(false);
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [itemRows, setItemRows] = useState<ItemRow[]>([]);
  const [extrasSplitMode, setExtrasSplitMode] = useState<ExtrasSplitMode>("proportional");
  const itemKeyCounter = useRef(0);
  const nextItemKey = useCallback(() => {
    itemKeyCounter.current += 1;
    return `item-${itemKeyCounter.current}`;
  }, []);
  const lastAppliedItemsExtractionRef = useRef<string | null>(null);
  const [remainderMemberId, setRemainderMemberId] = useState<string>("");
  const [showRemainderPrompt, setShowRemainderPrompt] = useState(false);
  const [receiptId, setReceiptId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [receiptStatusMessage, setReceiptStatusMessage] = useState<string | null>(null);
  const [parseStatus, setParseStatus] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsingReceipt, setIsParsingReceipt] = useState(false);
  const [isAttachingReceipt, setIsAttachingReceipt] = useState(false);
  const liveReceiptInputRef = useRef<HTMLInputElement | null>(null);
  const liveReceiptFileRef = useRef<File | null>(null);
  // Set once a scan has uploaded via presigned URL; save reuses this
  // receipt instead of uploading the file a second time.
  const scannedReceiptIdRef = useRef<string | null>(null);
  const [isFetchingReceiptUrl, setIsFetchingReceiptUrl] = useState(false);
  const [receiptPreviewError, setReceiptPreviewError] = useState<string | null>(null);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);
  const [receiptPreviewType, setReceiptPreviewType] = useState<string | null>(null);
  const [activeReceiptId, setActiveReceiptId] = useState<string | null>(null);
  const liveReceiptObjectUrlRef = useRef<string | null>(null);
  const remainderSectionRef = useRef<HTMLDivElement | null>(null);
  const previousRemainderRef = useRef(0);
  const lastAcknowledgedRemainderRef = useRef<number | null>(null);
  const [pendingExpense, setPendingExpense] = useState<PendingExpenseConfirmation | null>(null);

  useEffect(() => {
    if (!prefill) return;
    setDescription(prefill.description);
    setVendor(prefill.vendor ?? "");
    setCategory(prefill.category ?? "");
    setSubtotalInput(prefill.subtotal);
    setTaxInput(prefill.tax ?? "");
    setTipInput(prefill.tip ?? "");
    setPaidBy(prefill.paidByMemberId);
    setPayerManuallySelected(true);
    setSharedWith(prefill.sharedWithMemberIds);
    if (prefill.lineItems?.length) {
      setSplitMode("items");
      setItemRows(
        prefill.lineItems.map((item) => ({
          key: nextItemKey(),
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalInput: item.total,
          assignedMemberIds: [...item.assignedMemberIds]
        }))
      );
      setExtrasSplitMode(prefill.extrasSplitMode ?? "proportional");
    } else {
      setSplitMode(prefill.splitEvenly ? "even" : "custom");
      setItemRows([]);
    }
    setAllocations(prefill.allocations ?? {});
    setRemainderMemberId(prefill.remainderMemberId ?? "");
    setReceiptId("");
    setError(null);
    setPrefillFlash(true);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    const t = setTimeout(() => setPrefillFlash(false), 1400);
    onPrefillConsumed?.();
    return () => clearTimeout(t);
  }, [prefill, onPrefillConsumed, nextItemKey]);

  useEffect(() => {
    if (!payerManuallySelected) {
      setPaidBy(preferredPayer);
    }
  }, [preferredPayer, payerManuallySelected]);

  useEffect(() => {
    const validMemberIds = new Set(members.map((member) => member.memberId));
    setSharedWith((current) => current.filter((memberId) => validMemberIds.has(memberId)));
    setItemRows((current) =>
      current.map((row) => ({
        ...row,
        assignedMemberIds: row.assignedMemberIds.filter((memberId) =>
          validMemberIds.has(memberId)
        )
      }))
    );
  }, [members]);

  useEffect(() => {
    setAllocations((current) => {
      const next: Record<string, string> = {};
      sharedWith.forEach((memberId) => {
        if (current[memberId] !== undefined) {
          next[memberId] = current[memberId];
        }
      });
      return next;
    });
  }, [sharedWith]);

  useEffect(() => {
    setRemainderMemberId((current) => {
      if (sharedWith.length === 0) {
        return "";
      }
      if (current && sharedWith.includes(current)) {
        return current;
      }
      if (sharedWith.includes(paidBy)) {
        return paidBy;
      }
      return sharedWith[0];
    });
  }, [sharedWith, paidBy]);

  const [expenseCurrency, setExpenseCurrency] = useState(currency);

  // If the trip's display currency changes, follow it (until user picks a different one)
  useEffect(() => {
    setExpenseCurrency(currency);
  }, [currency]);

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: expenseCurrency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }),
    [expenseCurrency]
  );

  const formatAmount = useCallback(
    (value: number) => currencyFormatter.format(Number.isFinite(value) ? value : 0),
    [currencyFormatter]
  );

  const subtotalValue = useMemo(() => parseCurrencyInput(subtotalInput), [subtotalInput]);
  const taxValue = useMemo(() => parseCurrencyInput(taxInput), [taxInput]);
  const tipValue = useMemo(() => parseCurrencyInput(tipInput), [tipInput]);

  const extrasTotal = useMemo(
    () => roundToCents(taxValue + tipValue),
    [taxValue, tipValue]
  );
  const itemsSubtotal = useMemo(
    () =>
      roundToCents(
        itemRows.reduce(
          (sum, row) => sum + parseCurrencyInput(row.totalInput),
          0
        )
      ),
    [itemRows]
  );
  const effectiveSubtotal = splitMode === "items" ? itemsSubtotal : subtotalValue;
  const grossTotal = useMemo(
    () => roundToCents(effectiveSubtotal + taxValue + tipValue),
    [effectiveSubtotal, taxValue, tipValue]
  );
  const hasExtras = extrasTotal > 0.0001;

  const itemizedPreview = useMemo(
    () =>
      computeItemizedAllocations({
        lineItems: itemRows.map((row) => ({
          total: parseCurrencyInput(row.totalInput),
          assignedMemberIds: row.assignedMemberIds
        })),
        tax: taxValue,
        tip: tipValue,
        extrasSplitMode
      }),
    [itemRows, taxValue, tipValue, extrasSplitMode]
  );

  const unassignedItemCount = useMemo(
    () =>
      itemRows.filter(
        (row) =>
          row.assignedMemberIds.length === 0 &&
          (parseCurrencyInput(row.totalInput) > 0 || row.description.trim())
      ).length,
    [itemRows]
  );

  const sharedMembers = useMemo(
    () => members.filter((member) => sharedWith.includes(member.memberId)),
    [members, sharedWith]
  );

  const membersById = useMemo(() => {
    const lookup: Record<string, TripMember> = {};
    members.forEach((member) => {
      lookup[member.memberId] = member;
    });
    return lookup;
  }, [members]);

  const customAllocationPreview = useMemo(
    () =>
      computeCustomAllocations(
        sharedMembers,
        allocations,
        extrasTotal,
        splitExtrasEvenly
      ),
    [sharedMembers, allocations, extrasTotal, splitExtrasEvenly]
  );

  const allocationPreviewByMemberId = useMemo(() => {
    const map: Record<string, AllocationDetail> = {};
    customAllocationPreview.perMember.forEach((detail) => {
      map[detail.memberId] = detail;
    });
    return map;
  }, [customAllocationPreview]);

  const allocationDelta = useMemo(
    () => roundToCents(customAllocationPreview.total - grossTotal),
    [customAllocationPreview, grossTotal]
  );

  const evenSplitRemainderCents = useMemo(() => {
    if (!splitEvenly || sharedWith.length === 0 || grossTotal <= 0) {
      return 0;
    }
    const totalCents = Math.round(Math.abs(grossTotal * 100));
    return totalCents % sharedWith.length;
  }, [splitEvenly, grossTotal, sharedWith]);

  useEffect(() => {
    const hasRemainder = splitEvenly && evenSplitRemainderCents > 0;
    if (hasRemainder) {
      const acknowledged =
        lastAcknowledgedRemainderRef.current === evenSplitRemainderCents;
      if (!acknowledged) {
        if (previousRemainderRef.current === 0 && remainderSectionRef.current) {
          remainderSectionRef.current.scrollIntoView({
            behavior: "smooth",
            block: "center"
          });
        }
        setShowRemainderPrompt(true);
      }
    } else {
      lastAcknowledgedRemainderRef.current = null;
      if (showRemainderPrompt) {
        setShowRemainderPrompt(false);
      }
    }
    previousRemainderRef.current = evenSplitRemainderCents;
  }, [splitEvenly, evenSplitRemainderCents, showRemainderPrompt]);

  const allocationStatusMessage = useMemo(() => {
    if (grossTotal <= 0) {
      return "Enter an amount above to start allocating.";
    }
    if (Math.abs(allocationDelta) <= 0.01) {
      return "Ready to save";
    }
    return allocationDelta > 0
      ? `Over by ${formatAmount(allocationDelta)}`
      : `Short by ${formatAmount(Math.abs(allocationDelta))}`;
  }, [grossTotal, allocationDelta, formatAmount]);

  const allocationStatusColor = useMemo(() => {
    if (grossTotal <= 0) {
      return undefined;
    }
    if (Math.abs(allocationDelta) <= 0.01) {
      return "#34d399";
    }
    return allocationDelta > 0 ? "#f87171" : "#facc15";
  }, [grossTotal, allocationDelta]);

  const resetReceiptPreview = useCallback(() => {
    if (liveReceiptObjectUrlRef.current) {
      URL.revokeObjectURL(liveReceiptObjectUrlRef.current);
      liveReceiptObjectUrlRef.current = null;
    }
    setReceiptPreviewUrl(null);
    setReceiptPreviewType(null);
    setActiveReceiptId(null);
  }, []);

  useEffect(() => () => resetReceiptPreview(), [resetReceiptPreview]);

  const applyExtraction = useCallback(
    (extraction: TextractExtraction | undefined) => {
      if (!extraction) return;

      const {
        merchantName,
        subtotal: extractedSubtotal,
        total: extractedTotal,
        tax: extractedTax,
        tip: extractedTip,
        lineItems
      } = extraction;

      if (merchantName) {
        setDescription(merchantName);
        setVendor(merchantName);
      }

      if (!category && lineItems?.length) {
        const firstItem = lineItems.find((item) => item.description);
        if (firstItem?.description) {
          const normalized = firstItem.description.toLowerCase();
          if (normalized.includes("food") || normalized.includes("meal") || normalized.includes("restaurant")) {
            setCategory("meals");
          } else if (normalized.includes("hotel") || normalized.includes("lodging")) {
            setCategory("lodging");
          } else if (normalized.includes("ticket") || normalized.includes("ride") || normalized.includes("taxi") || normalized.includes("uber")) {
            setCategory("transport");
          } else if (normalized.includes("fuel") || normalized.includes("gas")) {
            setCategory("fuel");
          } else if (normalized.includes("coffee") || normalized.includes("bar") || normalized.includes("beer") || normalized.includes("wine")) {
            setCategory("drinks");
          } else if (normalized.includes("grocer") || normalized.includes("market")) {
            setCategory("groceries");
          }
        }
      }

      if (typeof extractedSubtotal === "number") {
        setSubtotalInput(extractedSubtotal.toString());
      } else if (typeof extractedTotal === "number") {
        const derivedSubtotal = roundToCents(
          extractedTotal - (extractedTax ?? 0) - (extractedTip ?? 0)
        );
        if (derivedSubtotal > 0) {
          setSubtotalInput(derivedSubtotal.toString());
        } else {
          setSubtotalInput(extractedTotal.toString());
        }
      }

      if (typeof extractedTax === "number") {
        setTaxInput(extractedTax.toString());
      }
      if (typeof extractedTip === "number") {
        setTipInput(extractedTip.toString());
      } else if (
        typeof extractedTotal === "number" &&
        typeof extractedSubtotal === "number"
      ) {
        // OCR often misses a handwritten or oddly-labeled tip; when the
        // printed total exceeds subtotal + tax, the difference is the tip.
        const inferredTip = roundToCents(
          extractedTotal - extractedSubtotal - (extractedTax ?? 0)
        );
        if (inferredTip > 0.009) {
          setTipInput(inferredTip.toFixed(2));
        }
      }

      // Surface parsed line items as an assignable list. The signature guard
      // keeps re-runs of this callback (receipt-status effect refiring, query
      // refetches producing new extraction objects) from wiping out
      // assignments the user has already made.
      const usableItems = (lineItems ?? []).filter(
        (item) => typeof item.total === "number" && item.total > 0
      );
      const extractionSignature = JSON.stringify([
        usableItems,
        extraction.total,
        extraction.subtotal,
        extraction.tax,
        extraction.tip
      ]);
      if (
        usableItems.length &&
        lastAppliedItemsExtractionRef.current !== extractionSignature
      ) {
        lastAppliedItemsExtractionRef.current = extractionSignature;
        const defaultAssigned = sharedWith.length
          ? sharedWith
          : members.map((member) => member.memberId);
        setItemRows(
          usableItems.flatMap((item, index) => {
            const description =
              item.description?.trim() || `Item ${index + 1}`;
            const quantity = Math.round(item.quantity ?? 1);
            // A printed line like "4 Breakfast Hash  68.00" is almost always
            // four people's dishes — expand it into per-unit rows so each
            // can be assigned separately.
            const expandable =
              quantity > 1 &&
              quantity <= 20 &&
              Math.abs((item.quantity ?? 1) - quantity) < 0.001;
            if (expandable) {
              return splitTotalIntoUnits(item.total ?? 0, quantity).map(
                (unitAmount) => ({
                  key: nextItemKey(),
                  description,
                  totalInput: unitAmount.toFixed(2),
                  assignedMemberIds: [...defaultAssigned]
                })
              );
            }
            return [
              {
                key: nextItemKey(),
                description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                totalInput: (item.total ?? 0).toFixed(2),
                assignedMemberIds: [...defaultAssigned]
              }
            ];
          })
        );
        setSplitMode("items");
      }
    },
    [category, sharedWith, members, nextItemKey]
  );

  const loadReceiptPreview = useCallback(
    async (receipt: Receipt) => {
      if (!receipt.storageKey) {
        setReceiptPreviewError("Receipt file is not available yet");
        return;
      }

      setReceiptPreviewError(null);
      setIsFetchingReceiptUrl(true);
      try {
        if (liveReceiptObjectUrlRef.current) {
          URL.revokeObjectURL(liveReceiptObjectUrlRef.current);
          liveReceiptObjectUrlRef.current = null;
        }
        const response = await api.get<{ url: string }>(
          `/trips/${tripId}/receipts/${receipt.receiptId}`
        );
        setReceiptPreviewUrl(response.url);
        setReceiptPreviewType(inferPreviewType(receipt.fileName));
        setActiveReceiptId(receipt.receiptId);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unable to load receipt preview";
        setReceiptPreviewError(message);
      } finally {
        setIsFetchingReceiptUrl(false);
      }
    },
    [tripId]
  );

  useEffect(() => {
    if (!receiptId) {
      setReceiptStatusMessage(null);
      if (activeReceiptId !== "__local__") {
        resetReceiptPreview();
      }
      return;
    }

    const receipt = receipts.find((item) => item.receiptId === receiptId);
    if (!receipt) {
      setReceiptStatusMessage(null);
      return;
    }

    setReceiptPreviewError(null);

    if (receipt.status === "COMPLETED") {
      if (activeReceiptId === "__local__") {
        resetReceiptPreview();
      }
      applyExtraction(receipt.extractedData);
      setReceiptStatusMessage("Fields pre-filled using receipt data. Please review before saving.");
      if (receipt.storageKey && activeReceiptId !== receipt.receiptId) {
        void loadReceiptPreview(receipt);
      }
    } else if (receipt.status === "PROCESSING") {
      setReceiptStatusMessage("Receipt is still being processed. Try refreshing in a moment.");
      if (activeReceiptId !== "__local__") {
        resetReceiptPreview();
      }
    } else if (receipt.status === "FAILED") {
      setReceiptStatusMessage("Receipt processing failed. Enter details manually.");
      if (activeReceiptId !== "__local__") {
        resetReceiptPreview();
      }
    } else {
      setReceiptStatusMessage(null);
    }
  }, [
    receiptId,
    receipts,
    applyExtraction,
    loadReceiptPreview,
    resetReceiptPreview,
    activeReceiptId
  ]);

  const handlePaidByChange = (memberId: string) => {
    setPaidBy(memberId);
    setPayerManuallySelected(true);
    if (!sharedWith.includes(memberId)) {
      setSharedWith((current) => [...current, memberId]);
    }
  };

  const toggleSharedMember = (memberId: string) => {
    setSharedWith((current) => {
      if (current.includes(memberId)) {
        return current.filter((id) => id !== memberId);
      }
      return [...current, memberId];
    });
  };

  const handleRemainderMemberChange = (memberId: string) => {
    setRemainderMemberId(memberId);
    setShowRemainderPrompt(false);
    lastAcknowledgedRemainderRef.current = evenSplitRemainderCents;
  };

  const handleAllocationChange = (memberId: string, value: string) => {
    setAllocations((current) => ({
      ...current,
      [memberId]: value
    }));
  };

  const handleAddItemRow = () => {
    setItemRows((current) => [
      ...current,
      {
        key: nextItemKey(),
        description: "",
        totalInput: "",
        assignedMemberIds: members.map((member) => member.memberId)
      }
    ]);
  };

  const handleRemoveItemRow = (key: string) => {
    setItemRows((current) => current.filter((row) => row.key !== key));
  };

  const handleItemRowChange = (
    key: string,
    updates: Partial<Pick<ItemRow, "description" | "totalInput">>
  ) => {
    setItemRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...updates } : row))
    );
  };

  const toggleItemMember = (key: string, memberId: string) => {
    setItemRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const assigned = row.assignedMemberIds.includes(memberId)
          ? row.assignedMemberIds.filter((id) => id !== memberId)
          : [...row.assignedMemberIds, memberId];
        return { ...row, assignedMemberIds: assigned };
      })
    );
  };

  const assignEveryoneToAllItems = () => {
    const everyone = members.map((member) => member.memberId);
    setItemRows((current) =>
      current.map((row) => ({ ...row, assignedMemberIds: [...everyone] }))
    );
  };

  const clearAllItemAssignments = () => {
    setItemRows((current) =>
      current.map((row) => ({ ...row, assignedMemberIds: [] }))
    );
  };

  const handleLiveReceiptRequest = () => {
    if (isParsingReceipt) return;
    setParseError(null);
    liveReceiptInputRef.current?.click();
  };

  const handleLiveReceiptSelected = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    event.target.value = "";
    liveReceiptFileRef.current = file;
    setParseError(null);
    setParseStatus("Preparing receipt…");
    setIsParsingReceipt(true);
    setReceiptStatusMessage(null);
    setReceiptId("");

    if (liveReceiptObjectUrlRef.current) {
      URL.revokeObjectURL(liveReceiptObjectUrlRef.current);
    }
    const objectUrl = URL.createObjectURL(file);
    liveReceiptObjectUrlRef.current = objectUrl;
    setReceiptPreviewUrl(objectUrl);
    setReceiptPreviewType(inferPreviewType(file.name, file.type));
    setActiveReceiptId("__local__");
    setReceiptPreviewError(null);

    try {
      // Presigned upload + async Textract poll — no payload-size ceiling,
      // and the same uploaded file gets attached at save time.
      scannedReceiptIdRef.current = null;
      setParseStatus("Uploading receipt…");
      const receipt = await api.post<ReceiptUploadResponse>(
        `/trips/${tripId}/receipts`,
        {
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          // Hidden from other members until the expense decides visibility.
          draft: true
        }
      );
      const uploadResponse = await fetch(receipt.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file
      });
      if (!uploadResponse.ok) {
        throw new Error(`Upload failed (${uploadResponse.status})`);
      }
      scannedReceiptIdRef.current = receipt.receiptId;

      setParseStatus("Analyzing receipt…");
      const deadline = Date.now() + 30_000;
      let extraction: TextractExtraction | null = null;
      while (Date.now() < deadline) {
        const record = await api.get<{
          receipt?: { status?: string; extractedData?: TextractExtraction };
        }>(`/trips/${tripId}/receipts/${receipt.receiptId}/record`);
        const status = record.receipt?.status;
        if (status === "COMPLETED") {
          extraction = record.receipt?.extractedData ?? {};
          break;
        }
        if (status === "FAILED") {
          throw new Error("Could not read the receipt.");
        }
        await sleep(1200);
      }
      if (!extraction) {
        throw new Error("Reading the receipt took too long. Try again.");
      }
      applyExtraction(extraction);
      setParseStatus("Receipt scanned. Review the details before saving.");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unable to analyze receipt";
      setParseError(message);
      setParseStatus(null);
    } finally {
      setIsParsingReceipt(false);
    }
  };

  const handleOpenReceiptInNewTab = async () => {
    if (!receiptId) return;
    if (activeReceiptId === receiptId && receiptPreviewUrl) {
      window.open(receiptPreviewUrl, "_blank", "noopener");
      return;
    }

    const receipt = receipts.find((item) => item.receiptId === receiptId);
    if (!receipt || !receipt.storageKey) {
      setReceiptPreviewError("Receipt is not available yet");
      return;
    }

    try {
      setIsFetchingReceiptUrl(true);
      const response = await api.get<{ url: string }>(
        `/trips/${tripId}/receipts/${receipt.receiptId}`
      );
      window.open(response.url, "_blank", "noopener");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to open receipt";
      setReceiptPreviewError(message);
    } finally {
      setIsFetchingReceiptUrl(false);
    }
  };

  const handleNumberInputWheel = useCallback((event: WheelEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.blur();
  }, []);

  const resetFormState = () => {
    setDescription("");
    setVendor("");
    setCategory("");
    setSubtotalInput("");
    setTaxInput("");
    setTipInput("");
    setSplitMode("even");
    setSplitExtrasEvenly(false);
    setAllocations({});
    setItemRows([]);
    setExtrasSplitMode("proportional");
    lastAppliedItemsExtractionRef.current = null;
    scannedReceiptIdRef.current = null;
    setRepeatCadence("");
    setReceiptId("");
    setReceiptStatusMessage(null);
    setParseStatus(null);
    setParseError(null);
    setReceiptPreviewError(null);
    setShowRemainderPrompt(false);
    lastAcknowledgedRemainderRef.current = null;
    previousRemainderRef.current = 0;
    liveReceiptFileRef.current = null;
    resetReceiptPreview();
  };

  const handleQuickSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const trimmedDescription = description.trim();
    if (!trimmedDescription) {
      setError("Add a short description.");
      return;
    }
    if (!paidBy) {
      setError("Pick who paid.");
      return;
    }
    if (sharedWith.length === 0) {
      setError("Pick at least one person to share with.");
      return;
    }
    const total = parseCurrencyInput(subtotalInput);
    if (total <= 0) {
      setError("Enter a positive amount.");
      return;
    }

    const distribution = distributeEvenly(total, sharedWith);
    const allocations = sharedWith.map((memberId) => ({
      memberId,
      amount: Math.abs(roundToCents(distribution[memberId] ?? 0))
    }));

    try {
      await onSubmit({
        description: trimmedDescription,
        total,
        currency: expenseCurrency,
        paidByMemberId: paidBy,
        sharedWithMemberIds: sharedWith,
        splitEvenly: true,
        allocations
      });
      // Reset just the per-expense fields, keep payer + people for the next one
      setDescription("");
      setSubtotalInput("");
      setTaxInput("");
      setTipInput("");
      setCategory("");
      setOtherSelected(false);
      setVendor("");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save expense";
      setError(message);
    }
  };

  // Runs all detailed-mode validation; returns the payload or null after
  // surfacing the error. Shared by the confirm flow and "Save draft".
  const buildDetailedPayload = (): CreateExpenseInput | null => {
    const trimmedDescription = description.trim();
    if (!trimmedDescription) {
      setError("Description is required");
      return null;
    }
    if (!paidBy) {
      setError("Select who paid for this expense.");
      return null;
    }
    if (splitMode !== "items" && sharedWith.length === 0) {
      setError("Select at least one person to share this expense.");
      return null;
    }
    if (grossTotal <= 0) {
      setError(
        splitMode === "items"
          ? "Add at least one line item with an amount before saving."
          : "Enter a positive subtotal, tax, or tip before saving."
      );
      return null;
    }
    if (splitEvenly && evenSplitRemainderCents > 0 && !remainderMemberId) {
      setError(
        `Assign the leftover ${formatAmount(evenSplitRemainderCents / 100)} before saving.`
      );
      remainderSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
      return null;
    }

    let allocationsPayload: { memberId: string; amount: number }[] = [];
    let lineItemsPayload: ExpenseLineItemInput[] | undefined;
    let sharedWithPayload = sharedWith;

    if (splitMode === "items") {
      const rows = itemRows.filter(
        (row) =>
          row.description.trim() || parseCurrencyInput(row.totalInput) > 0
      );
      if (rows.length === 0) {
        setError("Add at least one line item to split by item.");
        return null;
      }
      const missingAmount = rows.find(
        (row) => parseCurrencyInput(row.totalInput) <= 0
      );
      if (missingAmount) {
        setError(
          `Enter an amount for "${missingAmount.description.trim() || "each item"}".`
        );
        return null;
      }
      if (rows.some((row) => row.assignedMemberIds.length === 0)) {
        setError("Assign at least one person to every item.");
        return null;
      }

      lineItemsPayload = rows.map((row, index) => ({
        description: row.description.trim() || `Item ${index + 1}`,
        quantity: row.quantity,
        unitPrice: row.unitPrice,
        total: parseCurrencyInput(row.totalInput),
        assignedMemberIds: row.assignedMemberIds
      }));
      const assignedUnion = new Set(
        rows.flatMap((row) => row.assignedMemberIds)
      );
      sharedWithPayload = members
        .map((member) => member.memberId)
        .filter((memberId) => assignedUnion.has(memberId));
      allocationsPayload = itemizedPreview.allocations
        .filter((detail) => assignedUnion.has(detail.memberId))
        .map((detail) => ({
          memberId: detail.memberId,
          amount: detail.amount
        }));
    } else if (splitEvenly) {
      const distribution = distributeEvenly(
        grossTotal,
        sharedWith,
        remainderMemberId
      );
      allocationsPayload = sharedWith.map((memberId) => ({
        memberId,
        amount: Math.abs(roundToCents(distribution[memberId] ?? 0))
      }));
    } else {
      if (Math.abs(allocationDelta) > 0.01) {
        setError(
          `Allocated amounts must match the total (off by ${formatAmount(
            Math.abs(allocationDelta)
          )}).`
        );
        return null;
      }

      allocationsPayload = customAllocationPreview.perMember.map((detail) => ({
        memberId: detail.memberId,
        amount: roundToCents(detail.amount)
      }));
    }

    const payload: CreateExpenseInput = {
      description: trimmedDescription,
      vendor: vendor.trim() || undefined,
      category: category.trim() || undefined,
      total: grossTotal,
      currency: expenseCurrency,
      tax: taxValue > 0 ? taxValue : undefined,
      tip: tipValue > 0 ? tipValue : undefined,
      paidByMemberId: paidBy,
      sharedWithMemberIds: sharedWithPayload,
      splitEvenly,
      remainderMemberId: splitEvenly ? remainderMemberId || undefined : undefined,
      allocations: allocationsPayload,
      lineItems: lineItemsPayload,
      extrasSplitMode: lineItemsPayload ? extrasSplitMode : undefined,
      receiptId: receiptId || undefined,
      repeat:
        !editingLabel && splitMode === "even" && repeatCadence
          ? repeatCadence
          : undefined
    };

    return payload;
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const payload = buildDetailedPayload();
    if (!payload) return;

    const payerMember = membersById[payload.paidByMemberId];
    const payerName =
      payerMember?.displayName ??
      (payerMember?.email ?? "Selected member");
    const allocationSummary = (payload.allocations ?? [])
      .filter((item) => item.amount > 0.0001)
      .map((item) => {
        const member = membersById[item.memberId];
        return {
          memberId: item.memberId,
          displayName:
            member?.displayName ??
            member?.email ??
            item.memberId,
          amount: item.amount
        };
      });

    setPendingExpense({
      payload,
      payerName:
        currentUserId && payerMember?.memberId === currentUserId
          ? `${payerName} (you)`
          : payerName,
      allocationSummary
    });
  };

  const submitPayload = async (input: CreateExpenseInput) => {
    setError(null);

    const payload = { ...input };

    // A scanned receipt already uploaded via presigned URL — reuse it. It
    // was uploaded as a draft; publishing the expense reveals it.
    if (!payload.receiptId && scannedReceiptIdRef.current) {
      payload.receiptId = scannedReceiptIdRef.current;
    }

    // Fallback for a manually attached file that never went through the
    // scan path. Draft expenses upload a draft receipt so the file stays
    // hidden until publish.
    if (!payload.receiptId && liveReceiptFileRef.current) {
      const file = liveReceiptFileRef.current;
      setIsAttachingReceipt(true);
      try {
        const receipt = await api.post<ReceiptUploadResponse>(
          `/trips/${tripId}/receipts`,
          {
            fileName: file.name,
            contentType: file.type || "application/octet-stream",
            draft: payload.draft === true ? true : undefined
          }
        );
        const uploadResponse = await fetch(receipt.uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": file.type || "application/octet-stream"
          },
          body: file
        });
        if (!uploadResponse.ok) {
          throw new Error(`Upload failed (${uploadResponse.status})`);
        }
        payload.receiptId = receipt.receiptId;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Receipt upload failed";
        setError(
          `Couldn't attach the scanned receipt (${message}). The expense was not saved — try again.`
        );
        return;
      } finally {
        setIsAttachingReceipt(false);
      }
    }

    try {
      await onSubmit(payload);
      setPendingExpense(null);
      resetFormState();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save expense";
      setError(message);
    }
  };

  const handleConfirmSubmit = async () => {
    if (!pendingExpense) return;
    await submitPayload(pendingExpense.payload);
  };

  // Drafts skip the confirmation dialog — they're private and low-stakes.
  const handleSaveDraft = async () => {
    setError(null);
    const payload = buildDetailedPayload();
    if (!payload) return;
    await submitPayload({ ...payload, draft: true });
  };

  const handleCancelConfirmation = () => {
    setPendingExpense(null);
  };

  const activeReceipt = useMemo(
    () =>
      activeReceiptId && activeReceiptId !== "__local__"
        ? receipts.find((receipt) => receipt.receiptId === activeReceiptId)
        : undefined,
    [receipts, activeReceiptId]
  );

  const receiptPreviewCaption = useMemo(() => {
    if (!receiptPreviewUrl) {
      return null;
    }
    if (activeReceiptId === "__local__") {
      return "Preview of the receipt you just scanned. It will be uploaded and attached when you save.";
    }
    if (activeReceipt) {
      return `Preview of ${activeReceipt.fileName}`;
    }
    return "Receipt preview";
  }, [receiptPreviewUrl, activeReceiptId, activeReceipt]);

  const modeToggle = (
    <div className="qa-mode-toggle" role="tablist" aria-label="Expense entry mode">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "quick"}
        className={`qa-mode-toggle__btn ${
          mode === "quick" ? "qa-mode-toggle__btn--active" : ""
        }`}
        onClick={() => setMode("quick")}
      >
        Quick
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "detailed"}
        className={`qa-mode-toggle__btn ${
          mode === "detailed" ? "qa-mode-toggle__btn--active" : ""
        }`}
        onClick={() => setMode("detailed")}
      >
        Detailed
      </button>
    </div>
  );

  if (mode === "quick") {
    return (
      <div className="qa-wrap">
        {modeToggle}
        <form
          className="qa-form"
          onSubmit={handleQuickSubmit}
          ref={formRef}
          style={{
            transition: "box-shadow 0.4s ease, background 0.4s ease",
            boxShadow: prefillFlash
              ? "0 0 0 2px rgba(56,189,248,0.55)"
              : undefined,
            background: prefillFlash ? "rgba(56,189,248,0.06)" : undefined,
            borderRadius: "0.85rem"
          }}
        >
          <div className="qa-amount-row">
            <span className="qa-amount-currency" aria-hidden="true">
              {CURRENCY_OPTIONS.find((c) => c.code === expenseCurrency)?.symbol ?? "$"}
            </span>
            <input
              className="qa-amount-input"
              inputMode="decimal"
              type="number"
              min="0"
              step="0.01"
              value={subtotalInput}
              onChange={(event) => setSubtotalInput(event.target.value)}
              placeholder="0.00"
              aria-label="Amount"
              autoFocus
            />
            <select
              className="qa-currency-picker"
              value={expenseCurrency}
              onChange={(event) => setExpenseCurrency(event.target.value)}
              aria-label="Currency"
              title="Change currency"
            >
              {CURRENCY_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.code}
                </option>
              ))}
            </select>
          </div>

          <div className="input-group">
            <label htmlFor="qa-desc">For</label>
            <input
              id="qa-desc"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Dinner at Bluebird"
            />
          </div>

          <div className="input-group">
            <label htmlFor="qa-payer">Paid by</label>
            <select
              id="qa-payer"
              value={paidBy}
              onChange={(event) => handlePaidByChange(event.target.value)}
            >
              {members.map((member) => (
                <option key={member.memberId} value={member.memberId}>
                  {member.displayName ?? member.email ?? member.memberId}
                  {currentUserId === member.memberId ? " (you)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="input-group">
            <label>
              Split with{" "}
              <span
                className="muted"
                style={{ fontSize: "0.78rem", fontWeight: 400 }}
              >
                · everyone selected by default
              </span>
            </label>
            <div className="qa-people-grid">
              {members.map((member) => {
                const palette = seedAvatar(member.memberId);
                const name =
                  member.displayName ?? member.email ?? member.memberId;
                const isActive = sharedWith.includes(member.memberId);
                const isSelf = member.memberId === currentUserId;
                return (
                  <button
                    key={member.memberId}
                    type="button"
                    className={`qa-person-chip ${
                      isActive ? "qa-person-chip--active" : ""
                    }`}
                    onClick={() => toggleSharedMember(member.memberId)}
                    aria-pressed={isActive}
                  >
                    <span
                      className="qa-person-chip__avatar"
                      style={{ background: palette.bg, color: palette.fg }}
                      aria-hidden="true"
                    >
                      {getInitials(name)}
                    </span>
                    <span className="qa-person-chip__name">
                      {isSelf ? "You" : name.split(/\s+/)[0]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <p className="qa-error" style={{ color: "#fda4af", margin: 0 }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            className="primary qa-submit"
            disabled={isSubmitting}
          >
            {isSubmitting
              ? "Saving…"
              : sharedWith.length > 0 &&
                  parseCurrencyInput(subtotalInput) > 0
                ? `Add — ${(
                    parseCurrencyInput(subtotalInput) / sharedWith.length
                  ).toFixed(2)} each`
                : "Add expense"}
          </button>

          <p className="qa-hint">
            Even split, no tax/tip, no receipt. Need more?{" "}
            <button
              type="button"
              className="qa-hint__link"
              onClick={() => setMode("detailed")}
            >
              Switch to detailed →
            </button>
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="qa-wrap">
      {modeToggle}
      <form
        className="list"
        onSubmit={handleSubmit}
        ref={formRef}
        style={{
          transition: "box-shadow 0.4s ease, background 0.4s ease, padding 0.4s ease",
          boxShadow: prefillFlash ? "0 0 0 2px rgba(56,189,248,0.55)" : undefined,
          background: prefillFlash ? "rgba(56,189,248,0.06)" : undefined,
          borderRadius: "0.85rem",
          padding: prefillFlash ? "0.85rem" : undefined
        }}
      >
      {editingLabel && (
        <div
          role="status"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "0.75rem",
            border: "1px solid rgba(56,189,248,0.45)",
            background: "rgba(56,189,248,0.08)",
            borderRadius: "0.75rem",
            padding: "0.6rem 0.85rem"
          }}
        >
          <span style={{ fontSize: "0.9rem" }}>
            Editing <strong>{editingLabel}</strong> — saving updates the
            existing expense.
          </span>
          <button
            type="button"
            className="secondary"
            style={{ paddingInline: "0.65rem", fontSize: "0.82rem" }}
            onClick={() => {
              resetFormState();
              onCancelEdit?.();
            }}
          >
            Cancel edit
          </button>
        </div>
      )}
      <div className="input-group">
        <label htmlFor="expense-description">Description</label>
        <input
          id="expense-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Dinner at Bluebird Cafe"
        />
      </div>

      <div className="input-group">
        <label htmlFor="expense-vendor">Vendor (optional)</label>
        <input
          id="expense-vendor"
          value={vendor}
          onChange={(event) => setVendor(event.target.value)}
          placeholder="Bluebird Cafe"
        />
      </div>

      <div className="input-group">
        <label htmlFor="expense-category">Category (optional)</label>
        <div className="cat-chip-grid" id="expense-category" role="group" aria-label="Expense category">
          {EXPENSE_CATEGORIES.map((chip) => {
            const isActive =
              chip.id === "other" ? otherSelected : category === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                className={`cat-chip ${isActive ? "cat-chip--active" : ""}`}
                onClick={() => handleSelectCategory(chip.id)}
                style={isActive ? ({ "--cat-color": chip.color } as CSSProperties) : undefined}
                aria-pressed={isActive}
              >
                <span className="cat-chip__icon" aria-hidden="true">{chip.icon}</span>
                <span className="cat-chip__label">{chip.label}</span>
              </button>
            );
          })}
        </div>
        {otherSelected && (
          <div className="cat-custom">
            <input
              type="text"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="Name it"
              autoFocus
              maxLength={32}
            />
            <p className="cat-custom__hint">A short label — “souvenirs”, “gas station snacks”…</p>
          </div>
        )}
      </div>

      <div className="input-group">
        <label htmlFor="expense-currency">
          Currency{" "}
          {expenseCurrency !== currency && (
            <span className="muted" style={{ fontSize: "0.78rem", fontWeight: 400 }}>
              · differs from trip default ({currency})
            </span>
          )}
        </label>
        <select
          id="expense-currency"
          value={expenseCurrency}
          onChange={(event) => setExpenseCurrency(event.target.value)}
        >
          {CURRENCY_OPTIONS.map((opt) => (
            <option key={opt.code} value={opt.code}>
              {opt.symbol} · {opt.code} — {opt.label}
            </option>
          ))}
        </select>
      </div>

      {splitMode === "items" ? (
        <div className="input-group">
          <label>Subtotal (from items)</label>
          <input
            type="text"
            readOnly
            value={formatAmount(itemsSubtotal)}
            style={{ opacity: 0.75 }}
          />
        </div>
      ) : (
        <div className="input-group">
          <label htmlFor="expense-subtotal">Subtotal</label>
          <input
            id="expense-subtotal"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={subtotalInput}
            onChange={(event) => setSubtotalInput(event.target.value)}
            onWheel={handleNumberInputWheel}
          />
        </div>
      )}

      <div style={{ display: "flex", gap: "0.75rem" }}>
        <div className="input-group" style={{ flex: 1 }}>
          <label htmlFor="expense-tax">Tax</label>
          <input
            id="expense-tax"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={taxInput}
            onChange={(event) => setTaxInput(event.target.value)}
            onWheel={handleNumberInputWheel}
          />
        </div>
        <div className="input-group" style={{ flex: 1 }}>
          <label htmlFor="expense-tip">Tip</label>
          <input
            id="expense-tip"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={tipInput}
            onChange={(event) => setTipInput(event.target.value)}
            onWheel={handleNumberInputWheel}
          />
        </div>
      </div>

      <div className="input-group">
        <label>Total (with tax & tip)</label>
        <input type="text" readOnly value={formatAmount(grossTotal)} style={{ opacity: 0.75 }} />
      </div>

      <div
        className="input-group"
        style={{
          border: "1px dashed rgba(148,163,184,0.3)",
          borderRadius: "0.75rem",
          padding: "0.75rem"
        }}
      >
        <label>Quick receipt scan</label>
        <p className="muted" style={{ marginTop: "0.25rem" }}>
          Upload a receipt or invoice to automatically fill subtotal, tax, and
          tip — line items are pulled out too so you can assign them to people
          below.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button
            type="button"
            className="secondary"
            onClick={handleLiveReceiptRequest}
            disabled={isParsingReceipt}
          >
            {isParsingReceipt ? "Scanning…" : "Choose receipt"}
          </button>
          {parseStatus && <span className="muted">{parseStatus}</span>}
          {parseError && <span style={{ color: "#f87171" }}>{parseError}</span>}
        </div>
        <input
          ref={liveReceiptInputRef}
          type="file"
          accept="image/*,application/pdf"
          style={{ display: "none" }}
          onChange={handleLiveReceiptSelected}
        />
        {receiptPreviewUrl && (
          <div style={{ marginTop: "0.75rem" }}>
            <div
              style={{
                border: "1px solid rgba(148,163,184,0.14)",
                borderRadius: "0.75rem",
                padding: "0.75rem",
                background: "rgba(15,23,42,0.45)",
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem"
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  background: "rgba(15,23,42,0.6)",
                  borderRadius: "0.5rem",
                  padding: receiptPreviewType === "application/pdf" ? "0" : "0.75rem",
                  minHeight: receiptPreviewType === "application/pdf" ? "220px" : "auto"
                }}
              >
                {receiptPreviewType === "application/pdf" ? (
                  <iframe
                    title="Receipt preview"
                    src={receiptPreviewUrl}
                    style={{
                      border: "none",
                      width: "100%",
                      height: "260px",
                      borderRadius: "0.5rem"
                    }}
                  />
                ) : receiptPreviewType === "image" ? (
                  <img
                    src={receiptPreviewUrl}
                    alt="Receipt preview"
                    style={{
                      maxWidth: "100%",
                      maxHeight: "320px",
                      display: "block",
                      borderRadius: "0.5rem"
                    }}
                  />
                ) : (
                  <a
                    href={receiptPreviewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="secondary"
                  >
                    Open receipt preview
                  </a>
                )}
              </div>
              {receiptPreviewCaption && (
                <p className="muted" style={{ margin: 0 }}>
                  {receiptPreviewCaption}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="input-group">
        <label htmlFor="expense-paid-by">Who paid?</label>
        <select
          id="expense-paid-by"
          value={paidBy}
          onChange={(event) => handlePaidByChange(event.target.value)}
        >
          {members.map((member) => (
            <option key={member.memberId} value={member.memberId}>
              {member.displayName}
              {currentUserId === member.memberId ? " (you)" : ""}
            </option>
          ))}
        </select>
      </div>

      {splitMode !== "items" && (
        <div className="input-group">
          <label>Split with</label>
          <div className="list">
            {members.map((member) => (
              <label
                key={member.memberId}
                style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
              >
                <input
                  type="checkbox"
                  checked={sharedWith.includes(member.memberId)}
                  onChange={() => toggleSharedMember(member.memberId)}
                />
                {member.displayName}
                {currentUserId === member.memberId ? " (you)" : ""}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="input-group">
        <label>Split mode</label>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            type="button"
            className={splitMode === "even" ? "primary" : "secondary"}
            onClick={() => {
              setSplitMode("even");
              setSplitExtrasEvenly(false);
            }}
          >
            Evenly
          </button>
          <button
            type="button"
            className={splitMode === "custom" ? "primary" : "secondary"}
            onClick={() => setSplitMode("custom")}
          >
            Custom amounts
          </button>
          <button
            type="button"
            className={splitMode === "items" ? "primary" : "secondary"}
            onClick={() => setSplitMode("items")}
          >
            By item
          </button>
        </div>
        {splitMode === "items" && (
          <p className="muted" style={{ marginTop: "0.35rem" }}>
            Assign each line item to the people who shared it. Scanning a
            receipt above fills the items in automatically.
          </p>
        )}
      </div>

      {showRemainderPrompt && (
        <div
          role="alert"
          style={{
            background: "rgba(254,243,199,0.2)",
            border: "1px solid rgba(250, 204, 21, 0.6)",
            borderRadius: "0.75rem",
            padding: "0.75rem",
            marginBottom: "1rem"
          }}
        >
          <strong style={{ display: "block", marginBottom: "0.25rem" }}>
            There&rsquo;s an extra {formatAmount(evenSplitRemainderCents / 100)} to assign.
          </strong>
          <p className="muted" style={{ margin: 0 }}>
            Choose who should cover the remaining cents below.
          </p>
          <button
            type="button"
            className="secondary"
            style={{ marginTop: "0.5rem" }}
            onClick={() =>
              remainderSectionRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "center"
              })
            }
          >
            Go to assignment
          </button>
        </div>
      )}

      {splitEvenly && evenSplitRemainderCents > 0 && sharedMembers.length > 0 && (
        <div
          className="input-group"
          ref={remainderSectionRef}
          style={
            showRemainderPrompt
              ? {
                  boxShadow: "0 0 0 2px rgba(250, 204, 21, 0.25)",
                  borderRadius: "0.75rem",
                  padding: "0.75rem"
                }
              : undefined
          }
        >
          <label htmlFor="even-split-remainder">
            Assign leftover {formatAmount(evenSplitRemainderCents / 100)} to
          </label>
          <select
            id="even-split-remainder"
            value={remainderMemberId}
            onChange={(event) => handleRemainderMemberChange(event.target.value)}
          >
            {sharedMembers.map((member) => (
              <option key={member.memberId} value={member.memberId}>
                {member.displayName}
                {currentUserId === member.memberId ? " (you)" : ""}
              </option>
            ))}
          </select>
          <p className="muted" style={{ marginTop: "0.25rem" }}>
            Total does not divide evenly across {sharedMembers.length} people. Choose who should cover the remaining cents.
          </p>
        </div>
      )}

      {splitMode === "items" && (
        <>
          <div className="input-group">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "0.5rem"
              }}
            >
              <label style={{ margin: 0 }}>Line items</label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  type="button"
                  className="secondary"
                  style={{ paddingInline: "0.6rem", fontSize: "0.82rem" }}
                  onClick={assignEveryoneToAllItems}
                  disabled={itemRows.length === 0}
                >
                  Everyone on all items
                </button>
                <button
                  type="button"
                  className="secondary"
                  style={{ paddingInline: "0.6rem", fontSize: "0.82rem" }}
                  onClick={clearAllItemAssignments}
                  disabled={itemRows.length === 0}
                >
                  Clear assignments
                </button>
              </div>
            </div>

            {itemRows.length === 0 && (
              <p className="muted" style={{ marginTop: "0.5rem" }}>
                No items yet. Scan a receipt above or add items by hand.
              </p>
            )}

            <div className="list" style={{ marginTop: "0.5rem" }}>
              {itemRows.map((row, index) => {
                const rowAmount = parseCurrencyInput(row.totalInput);
                const needsPeople =
                  row.assignedMemberIds.length === 0 &&
                  (rowAmount > 0 || row.description.trim());
                return (
                  <div
                    key={row.key}
                    style={{
                      border: needsPeople
                        ? "1px solid rgba(250,204,21,0.55)"
                        : "1px solid rgba(148,163,184,0.16)",
                      borderRadius: "0.75rem",
                      padding: "0.75rem",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.55rem"
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        gap: "0.5rem",
                        alignItems: "center"
                      }}
                    >
                      <input
                        value={row.description}
                        onChange={(event) =>
                          handleItemRowChange(row.key, {
                            description: event.target.value
                          })
                        }
                        placeholder={`Item ${index + 1}`}
                        aria-label={`Item ${index + 1} description`}
                        style={{ flex: 2, minWidth: "8rem" }}
                      />
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={row.totalInput}
                        onChange={(event) =>
                          handleItemRowChange(row.key, {
                            totalInput: event.target.value
                          })
                        }
                        onWheel={handleNumberInputWheel}
                        placeholder="0.00"
                        aria-label={`Item ${index + 1} amount`}
                        style={{ width: "6.5rem" }}
                      />
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => handleRemoveItemRow(row.key)}
                        aria-label={`Remove item ${index + 1}`}
                        style={{ paddingInline: "0.6rem" }}
                      >
                        ✕
                      </button>
                    </div>
                    {typeof row.quantity === "number" && row.quantity > 1 && (
                      <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
                        Qty {row.quantity}
                        {typeof row.unitPrice === "number"
                          ? ` × ${formatAmount(row.unitPrice)}`
                          : ""}
                      </p>
                    )}
                    <div
                      style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}
                    >
                      {members.map((member) => {
                        const palette = seedAvatar(member.memberId);
                        const name =
                          member.displayName ?? member.email ?? member.memberId;
                        const isActive = row.assignedMemberIds.includes(
                          member.memberId
                        );
                        const isSelf = member.memberId === currentUserId;
                        return (
                          <button
                            key={member.memberId}
                            type="button"
                            className={`qa-person-chip ${
                              isActive ? "qa-person-chip--active" : ""
                            }`}
                            onClick={() =>
                              toggleItemMember(row.key, member.memberId)
                            }
                            aria-pressed={isActive}
                          >
                            <span
                              className="qa-person-chip__avatar"
                              style={{ background: palette.bg, color: palette.fg }}
                              aria-hidden="true"
                            >
                              {getInitials(name)}
                            </span>
                            <span className="qa-person-chip__name">
                              {isSelf ? "You" : name.split(/\s+/)[0]}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {needsPeople && (
                      <p style={{ margin: 0, fontSize: "0.82rem", color: "#facc15" }}>
                        Pick who shared this item.
                      </p>
                    )}
                    {row.assignedMemberIds.length > 0 && rowAmount > 0 && (
                      <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
                        {formatAmount(rowAmount / row.assignedMemberIds.length)}{" "}
                        each across {row.assignedMemberIds.length}{" "}
                        {row.assignedMemberIds.length === 1 ? "person" : "people"}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              className="secondary"
              onClick={handleAddItemRow}
              style={{ marginTop: "0.5rem", alignSelf: "flex-start" }}
            >
              + Add item
            </button>
          </div>

          <div className="input-group">
            <label>Tax &amp; tip split</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                className={extrasSplitMode === "proportional" ? "primary" : "secondary"}
                onClick={() => setExtrasSplitMode("proportional")}
              >
                Proportional to items
              </button>
              <button
                type="button"
                className={extrasSplitMode === "even" ? "primary" : "secondary"}
                onClick={() => setExtrasSplitMode("even")}
              >
                Evenly
              </button>
            </div>
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              {hasExtras
                ? extrasSplitMode === "proportional"
                  ? `The ${formatAmount(extrasTotal)} in tax & tip is split in proportion to each person's items.`
                  : `The ${formatAmount(extrasTotal)} in tax & tip is split evenly among everyone with an item.`
                : "Enter tax or tip above to include them automatically."}
            </p>
          </div>

          {itemizedPreview.allocations.length > 0 && (
            <div className="input-group">
              <label>Per-person breakdown</label>
              <div className="list" style={{ marginTop: "0.35rem" }}>
                {itemizedPreview.allocations.map((detail) => {
                  const member = membersById[detail.memberId];
                  const name =
                    member?.displayName ?? member?.email ?? detail.memberId;
                  return (
                    <div
                      key={detail.memberId}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "0.75rem",
                        alignItems: "baseline"
                      }}
                    >
                      <span>
                        {name}
                        {currentUserId === detail.memberId ? " (you)" : ""}
                      </span>
                      <span className="muted" style={{ fontSize: "0.82rem" }}>
                        {formatAmount(detail.itemsAmount)} items
                        {detail.extrasAmount > 0
                          ? ` + ${formatAmount(detail.extrasAmount)} tax & tip`
                          : ""}{" "}
                        = <strong style={{ color: "#f1f5f9" }}>{formatAmount(detail.amount)}</strong>
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="muted" style={{ marginTop: "0.5rem" }}>
                Items {formatAmount(itemsSubtotal)}
                {extrasTotal > 0 ? ` + tax & tip ${formatAmount(extrasTotal)}` : ""} ={" "}
                {formatAmount(grossTotal)}
              </p>
            </div>
          )}
        </>
      )}

      {splitMode === "custom" && (
        <>
          <div className="list">
            {sharedMembers.map((member) => {
              const preview = allocationPreviewByMemberId[member.memberId];
              const extrasShare = preview?.extrasShare ?? 0;
              const finalAmount =
                preview?.amount ??
                parseCurrencyInput(allocations[member.memberId] ?? "0");

              return (
                <div key={member.memberId} className="input-group">
                  <label>{member.displayName}</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={allocations[member.memberId] ?? ""}
                    onChange={(event) =>
                      handleAllocationChange(member.memberId, event.target.value)
                    }
                    onWheel={handleNumberInputWheel}
                  />
                  {splitExtrasEvenly && Math.abs(extrasShare) >= 0.005 && (
                    <p className="muted" style={{ marginTop: "0.25rem" }}>
                      Includes {formatAmount(extrasShare)} tax & tip · Final:{" "}
                      {formatAmount(finalAmount)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <div className="input-group">
            <label>Tax & tip sharing</label>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                marginTop: "0.5rem"
              }}
            >
              <input
                type="checkbox"
                checked={splitExtrasEvenly}
                onChange={(event) => setSplitExtrasEvenly(event.target.checked)}
              />
              Split tax and tip evenly
            </label>
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              {hasExtras
                ? sharedMembers.length > 0
                  ? `Adds ${formatAmount(extrasTotal)} across ${sharedMembers.length} ${
                      sharedMembers.length === 1 ? "person" : "people"
                    }.`
                  : "Select at least one person to split the tax and tip."
                : "Enter tax or tip above to include them automatically."}
            </p>
          </div>
          <div className="input-group">
            <label>Allocation summary</label>
            <p
              className="muted"
              style={{
                marginTop: "0.5rem",
                color: grossTotal > 0 ? allocationStatusColor : undefined
              }}
            >
              {grossTotal > 0 ? (
                <>
                  Allocated {formatAmount(customAllocationPreview.total)} of{" "}
                  {formatAmount(grossTotal)} · {allocationStatusMessage}
                </>
              ) : (
                "Enter a subtotal, tax, or tip to start allocating."
              )}
            </p>
          </div>
        </>
      )}

      {receipts.length > 0 && (
        <div className="input-group">
          <label htmlFor="expense-receipt">Attach receipt (optional)</label>
          <select
            id="expense-receipt"
            value={receiptId}
            onChange={(event) => {
              setReceiptId(event.target.value);
              setReceiptStatusMessage(null);
              setReceiptPreviewError(null);
              if (!event.target.value && activeReceiptId !== "__local__") {
                resetReceiptPreview();
              }
            }}
          >
            <option value="">None</option>
            {receipts.map((receipt) => (
              <option key={receipt.receiptId} value={receipt.receiptId}>
                {receipt.fileName} ({receipt.status.toLowerCase()})
              </option>
            ))}
          </select>
          {receiptId && (
            <div
              style={{
                marginTop: "0.5rem",
                display: "flex",
                gap: "0.5rem",
                alignItems: "center"
              }}
            >
              <button
                type="button"
                className="secondary"
                onClick={handleOpenReceiptInNewTab}
                disabled={isFetchingReceiptUrl}
              >
                {isFetchingReceiptUrl ? "Opening…" : "Open full size"}
              </button>
              {receiptPreviewError && (
                <span style={{ color: "#f87171" }}>{receiptPreviewError}</span>
              )}
            </div>
          )}
          {receiptStatusMessage && (
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              {receiptStatusMessage}
            </p>
          )}
        </div>
      )}

      {!editingLabel && splitMode === "even" && (
        <div className="input-group" style={{ maxWidth: "16rem" }}>
          <label htmlFor="expense-repeat">Repeats</label>
          <select
            id="expense-repeat"
            value={repeatCadence}
            onChange={(event) =>
              setRepeatCadence(event.target.value as "" | "weekly" | "monthly")
            }
          >
            <option value="">Never</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          {repeatCadence && (
            <p className="muted" style={{ margin: "0.3rem 0 0", fontSize: "0.8rem" }}>
              Adds this expense automatically every{" "}
              {repeatCadence === "weekly" ? "week" : "month"} — stop it any
              time from the Recurring section.
            </p>
          )}
        </div>
      )}

      {error && <p style={{ color: "#fda4af" }}>{error}</p>}

      {(() => {
        const allocationOff =
          splitMode === "custom" &&
          Math.abs(allocationDelta) > 0.01 &&
          grossTotal > 0;
        const itemsOff = splitMode === "items" && unassignedItemCount > 0;
        const blocked = allocationOff || itemsOff;
        const buttonLabel = isSubmitting
          ? "Saving…"
          : allocationOff
            ? `Allocations off by ${formatAmount(Math.abs(allocationDelta))}`
            : itemsOff
              ? `Assign people to ${unassignedItemCount} ${
                  unassignedItemCount === 1 ? "item" : "items"
                }`
              : editingLabel
                ? "Save changes"
                : "Add expense";
        const canSaveDraft = !editingLabel || editingIsDraft;
        return (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              type="submit"
              className="primary"
              disabled={isSubmitting || blocked}
              style={{
                flex: "2 1 12rem",
                ...(blocked
                  ? { opacity: 0.55, cursor: "not-allowed", background: "rgba(148,163,184,0.25)", color: "#e2e8f0", boxShadow: "none" }
                  : {})
              }}
              title={
                allocationOff
                  ? "Adjust the per-person amounts so they match the total before saving."
                  : itemsOff
                    ? "Every item needs at least one person assigned before saving."
                    : undefined
              }
            >
              {buttonLabel}
            </button>
            {canSaveDraft && (
              <button
                type="button"
                className="secondary"
                disabled={isSubmitting || isAttachingReceipt || blocked}
                style={{ flex: "1 1 8rem" }}
                title="Only you can see drafts. Publish whenever it's ready."
                onClick={() => {
                  void handleSaveDraft();
                }}
              >
                {isAttachingReceipt
                  ? "Uploading…"
                  : editingIsDraft
                    ? "Keep as draft"
                    : "Save draft"}
              </button>
            )}
          </div>
        );
      })()}

      {/* Portaled to <body>: ancestor cards use backdrop-filter, which turns
          them into containing blocks and breaks position:fixed centering. */}
      {pendingExpense && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.75)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 1000,
            padding: "1.5rem"
          }}
        >
          <div
            style={{
              background: "#0f172a",
              borderRadius: "1rem",
              padding: "1.5rem",
              width: "min(420px, 100%)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
              border: "1px solid rgba(148,163,184,0.2)"
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: "0.75rem" }}>Confirm details</h3>
            <p className="muted" style={{ marginBottom: "0.75rem" }}>
              <strong>{pendingExpense.payerName}</strong> paid{" "}
              <strong>{formatAmount(pendingExpense.payload.total)}</strong>. Please confirm the split before saving.
            </p>
            <div
              style={{
                border: "1px solid rgba(148,163,184,0.2)",
                borderRadius: "0.75rem",
                padding: "0.75rem",
                marginBottom: "1rem"
              }}
            >
              <p className="muted" style={{ marginTop: 0 }}>
                People to reimburse:
              </p>
              <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                {pendingExpense.allocationSummary.map((item) => (
                  <li key={item.memberId} style={{ marginBottom: "0.35rem" }}>
                    <span>{item.displayName}</span>{" "}
                    <strong>{formatAmount(item.amount)}</strong>
                  </li>
                ))}
              </ul>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <button
                type="button"
                className="secondary"
                onClick={handleCancelConfirmation}
                disabled={isSubmitting || isAttachingReceipt}
              >
                Go back
              </button>
              <button
                type="button"
                className="primary"
                onClick={handleConfirmSubmit}
                disabled={isSubmitting || isAttachingReceipt}
              >
                {isAttachingReceipt
                  ? "Uploading receipt…"
                  : isSubmitting
                    ? "Saving…"
                    : editingLabel
                      ? "Save changes"
                      : "Confirm & save"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      </form>
    </div>
  );
};

export default AddExpenseForm;
