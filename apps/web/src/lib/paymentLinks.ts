// Builds "tap to pay" web links from a member's stored payment handles.
// Returns null when the method has no universal link (e.g. Zelle) so the
// caller can fall back to copy-to-clipboard.
export const buildPaymentLink = (
  method: string,
  value: string,
  amount?: number,
  currency?: string,
  note?: string
): string | null => {
  const handle = value.trim().replace(/^@/, "");
  if (!handle) return null;

  if (method === "venmo") {
    const params = new URLSearchParams({ txn: "pay" });
    // Venmo is USD-only; don't prefill a number that's in another currency.
    if (amount && amount > 0 && (!currency || currency.toUpperCase() === "USD")) {
      params.set("amount", amount.toFixed(2));
    }
    if (note) {
      params.set("note", note);
    }
    return `https://venmo.com/${encodeURIComponent(handle)}?${params.toString()}`;
  }

  if (method === "paypal") {
    // Accept either a bare handle or a pasted paypal.me URL.
    const afterHost = handle.includes("paypal.me/")
      ? handle.slice(handle.indexOf("paypal.me/") + "paypal.me/".length)
      : handle;
    const user = afterHost.split("/")[0]?.trim();
    if (!user) return null;
    if (amount && amount > 0) {
      const currencySuffix =
        currency && currency.toUpperCase() !== "USD"
          ? currency.toUpperCase()
          : "";
      return `https://paypal.me/${encodeURIComponent(user)}/${amount.toFixed(2)}${currencySuffix}`;
    }
    return `https://paypal.me/${encodeURIComponent(user)}`;
  }

  return null;
};
