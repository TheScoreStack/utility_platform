import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { HarmonyLedgerEntriesResponse } from "../types";

export const useHarmonyLedgerEntries = (enabled: boolean) =>
  useQuery({
    queryKey: ["harmony-ledger", "entries"],
    queryFn: () => api.get<HarmonyLedgerEntriesResponse>("/harmony-ledger/entries"),
    enabled
  });
