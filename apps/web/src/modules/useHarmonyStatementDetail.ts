import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import type { HarmonyStatementDetailResponse } from "../types";
import { isStatementProcessing } from "./useHarmonyStatements";

/** Stop polling a stuck statement after two minutes. */
const POLL_TIMEOUT_MS = 120_000;

export const useHarmonyStatementDetail = (
  statementId: string | undefined,
  enabled: boolean
) => {
  const pollStartRef = useRef<number | null>(null);

  return useQuery({
    queryKey: ["harmony-ledger", "statements", statementId],
    queryFn: () =>
      api.get<HarmonyStatementDetailResponse>(
        `/harmony-ledger/statements/${statementId}`
      ),
    enabled: enabled && Boolean(statementId),
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status === 404) && failureCount < 2,
    // Poll every 2s while parsing, then give up after POLL_TIMEOUT_MS.
    refetchInterval: (query) => {
      const status = query.state.data?.statement.status;
      if (!status || !isStatementProcessing(status)) {
        pollStartRef.current = null;
        return false;
      }
      if (pollStartRef.current === null) {
        pollStartRef.current = Date.now();
      }
      return Date.now() - pollStartRef.current > POLL_TIMEOUT_MS ? false : 2000;
    }
  });
};
