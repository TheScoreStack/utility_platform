import { CSSProperties, ChangeEvent, FormEvent, WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { EXPENSE_CATEGORIES, resolveExpenseCategory } from "../lib/expenseCategories";
import { getInitials, seedAvatar } from "../lib/avatarPalette";
import type { TripMember, Receipt, TextractExtraction } from "../types";

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

const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        const base64 = result.includes(",") ? result.split(",")[1] : result;
        resolve(base64);
      } else {
        reject(new Error("Unable to read receipt file"));
      }
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Unable to read receipt file"));
    };
    reader.readAsDataURL(file);
  });

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
  receiptId?: string;
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
  onPrefillConsumed
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
  const [splitEvenly, setSplitEvenly] = useState(true);
  const [splitExtrasEvenly, setSplitExtrasEvenly] = useState(false);
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [remainderMemberId, setRemainderMemberId] = useState<string>("");
  const [showRemainderPrompt, setShowRemainderPrompt] = useState(false);
  const [receiptId, setReceiptId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [receiptStatusMessage, setReceiptStatusMessage] = useState<string | null>(null);
  const [parseStatus, setParseStatus] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsingReceipt, setIsParsingReceipt] = useState(false);
  const liveReceiptInputRef = useRef<HTMLInputElement | null>(null);
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
    setSplitEvenly(prefill.splitEvenly);
    setAllocations(prefill.allocations ?? {});
    setRemainderMemberId(prefill.remainderMemberId ?? "");
    setReceiptId("");
    setError(null);
    setPrefillFlash(true);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    const t = setTimeout(() => setPrefillFlash(false), 1400);
    onPrefillConsumed?.();
    return () => clearTimeout(t);
  }, [prefill, onPrefillConsumed]);

  useEffect(() => {
    if (!payerManuallySelected) {
      setPaidBy(preferredPayer);
    }
  }, [preferredPayer, payerManuallySelected]);

  useEffect(() => {
    const validMemberIds = new Set(members.map((member) => member.memberId));
    setSharedWith((current) => current.filter((memberId) => validMemberIds.has(memberId)));
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

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }),
    [currency]
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
  const grossTotal = useMemo(
    () => roundToCents(subtotalValue + taxValue + tipValue),
    [subtotalValue, taxValue, tipValue]
  );
  const hasExtras = extrasTotal > 0.0001;

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
      }
    },
    [category]
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
      const base64 = await readFileAsBase64(file);
      setParseStatus("Analyzing receipt…");
      const response = await api.post<{ extraction: TextractExtraction }>(
        `/trips/${tripId}/receipts/analyze`,
        {
          fileName: file.name,
          contentType: file.type || undefined,
          data: base64
        }
      );
      applyExtraction(response.extraction);
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
    setSplitEvenly(true);
    setSplitExtrasEvenly(false);
    setAllocations({});
    setReceiptId("");
    setReceiptStatusMessage(null);
    setParseStatus(null);
    setParseError(null);
    setReceiptPreviewError(null);
    setShowRemainderPrompt(false);
    lastAcknowledgedRemainderRef.current = null;
    previousRemainderRef.current = 0;
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
        currency,
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

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const trimmedDescription = description.trim();
    if (!trimmedDescription) {
      setError("Description is required");
      return;
    }
    if (!paidBy) {
      setError("Select who paid for this expense.");
      return;
    }
    if (sharedWith.length === 0) {
      setError("Select at least one person to share this expense.");
      return;
    }
    if (grossTotal <= 0) {
      setError("Enter a positive subtotal, tax, or tip before saving.");
      return;
    }
    if (splitEvenly && evenSplitRemainderCents > 0 && !remainderMemberId) {
      setError(
        `Assign the leftover ${formatAmount(evenSplitRemainderCents / 100)} before saving.`
      );
      remainderSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
      return;
    }

    let allocationsPayload: { memberId: string; amount: number }[] = [];

    if (splitEvenly) {
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
        return;
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
      currency,
      tax: taxValue > 0 ? taxValue : undefined,
      tip: tipValue > 0 ? tipValue : undefined,
      paidByMemberId: paidBy,
      sharedWithMemberIds: sharedWith,
      splitEvenly,
      remainderMemberId: splitEvenly ? remainderMemberId || undefined : undefined,
      allocations: allocationsPayload,
      receiptId: receiptId || undefined
    };

    const payerMember = membersById[payload.paidByMemberId];
    const payerName =
      payerMember?.displayName ??
      (payerMember?.email ?? "Selected member");
    const allocationSummary = allocationsPayload
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

  const handleConfirmSubmit = async () => {
    if (!pendingExpense) return;
    setError(null);
    try {
      await onSubmit(pendingExpense.payload);
      setPendingExpense(null);
      resetFormState();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save expense";
      setError(message);
    }
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
      return "Preview of the receipt you just selected. It is not attached to the expense yet.";
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
              $
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
          Upload a receipt to automatically fill subtotal, tax, and tip instantly.
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

      <div className="input-group">
        <label>Split mode</label>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            className={splitEvenly ? "primary" : "secondary"}
            onClick={() => {
              setSplitEvenly(true);
              setSplitExtrasEvenly(false);
            }}
          >
            Evenly
          </button>
          <button
            type="button"
            className={!splitEvenly ? "primary" : "secondary"}
            onClick={() => setSplitEvenly(false)}
          >
            Custom amounts
          </button>
        </div>
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
            There's an extra {formatAmount(evenSplitRemainderCents / 100)} to assign.
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

      {!splitEvenly && (
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

      {error && <p style={{ color: "#fda4af" }}>{error}</p>}

      {(() => {
        const allocationOff =
          !splitEvenly && Math.abs(allocationDelta) > 0.01 && grossTotal > 0;
        const buttonLabel = isSubmitting
          ? "Saving…"
          : allocationOff
            ? `Allocations off by ${formatAmount(Math.abs(allocationDelta))}`
            : "Add expense";
        return (
          <button
            type="submit"
            className="primary"
            disabled={isSubmitting || allocationOff}
            title={
              allocationOff
                ? "Adjust the per-person amounts so they match the total before saving."
                : undefined
            }
            style={
              allocationOff
                ? { opacity: 0.55, cursor: "not-allowed", background: "rgba(148,163,184,0.25)", color: "#e2e8f0", boxShadow: "none" }
                : undefined
            }
          >
            {buttonLabel}
          </button>
        );
      })()}

      {pendingExpense && (
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
              <button type="button" className="secondary" onClick={handleCancelConfirmation} disabled={isSubmitting}>
                Go back
              </button>
              <button type="button" className="primary" onClick={handleConfirmSubmit} disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : "Confirm & save"}
              </button>
            </div>
          </div>
        </div>
      )}
      </form>
    </div>
  );
};

export default AddExpenseForm;
