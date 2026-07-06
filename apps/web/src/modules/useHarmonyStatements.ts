import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { HarmonyStatementStatus, HarmonyStatementsResponse } from "../types";

export const isStatementProcessing = (status: HarmonyStatementStatus): boolean =>
  status === "PENDING_UPLOAD" || status === "PROCESSING";

/** Don't poll forever for abandoned uploads that never finished. */
const POLL_MAX_AGE_MS = 10 * 60_000;

export const useHarmonyStatements = (enabled: boolean) => {
  /**
   * When each statement started parsing. Seeded from uploadedAt on the first
   * response; statements that flip back to processing later (e.g. a retry)
   * restart their window from that moment so polling picks them up again.
   */
  const processingSinceRef = useRef<Record<string, number> | null>(null);

  return useQuery({
    queryKey: ["harmony-ledger", "statements"],
    queryFn: () => api.get<HarmonyStatementsResponse>("/harmony-ledger/statements"),
    enabled,
    // Keep polling while any statement recently started parsing.
    refetchInterval: (query) => {
      const statements = query.state.data?.statements;
      if (!statements) return false;
      const seeded = processingSinceRef.current !== null;
      const since = (processingSinceRef.current ??= {});
      let shouldPoll = false;
      for (const statement of statements) {
        if (!isStatementProcessing(statement.status)) {
          delete since[statement.statementId];
          continue;
        }
        since[statement.statementId] ??= seeded
          ? Date.now()
          : new Date(statement.uploadedAt).getTime();
        if (Date.now() - since[statement.statementId] < POLL_MAX_AGE_MS) {
          shouldPoll = true;
        }
      }
      return shouldPoll ? 2000 : false;
    }
  });
};
