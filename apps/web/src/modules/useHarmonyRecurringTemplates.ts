import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { HarmonyRecurringTemplatesResponse } from "../types";

export const useHarmonyRecurringTemplates = (enabled: boolean) =>
  useQuery({
    queryKey: ["harmony-ledger", "recurring"],
    queryFn: () =>
      api.get<HarmonyRecurringTemplatesResponse>("/harmony-ledger/recurring"),
    enabled
  });
