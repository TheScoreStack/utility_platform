import type { ReactNode } from "react";
import {
  ExpensesGlyphIcon,
  LedgerGlyphIcon,
  MeetGlyphIcon,
  TimeClockGlyphIcon
} from "../components/icons/UtilityIcons";

export interface ModuleDefinition {
  id: string;
  name: string;
  description: string;
  path: string;
  tags: string[];
  maturity: "alpha" | "beta" | "stable";
  icon?: ReactNode;
  restricted?: boolean;
}

export const modules: ModuleDefinition[] = [
  {
    id: "group-expenses",
    name: "Group Expenses",
    description:
      "Track shared trip expenses, digitize receipts, and keep running balances for everyone in your traveling party.",
    path: "/group-expenses",
    tags: ["travel", "finance", "receipts"],
    maturity: "beta",
    icon: <ExpensesGlyphIcon />
  },
  {
    id: "meet",
    name: "Stack Meet",
    description:
      "Find a time everyone can make. Propose dates, share one link, and watch the group's availability light up.",
    path: "/meet",
    tags: ["scheduling", "groups", "time"],
    maturity: "alpha",
    icon: <MeetGlyphIcon />
  },
  {
    id: "harmony-ledger",
    name: "Harmony Collective",
    description:
      "Private ledger for Harmony Collective donations, revenue, expenses, and reimbursements.",
    path: "/harmony-ledger/overview",
    tags: ["finance", "operations", "ledger"],
    maturity: "alpha",
    icon: <LedgerGlyphIcon />,
    restricted: true
  },
  {
    id: "stack-time",
    name: "Stack Time",
    description:
      "Track hours worked on Stack Technologies projects. Log time, view reports by project or person.",
    path: "/stack-time",
    tags: ["time", "projects", "tracking"],
    maturity: "alpha",
    icon: <TimeClockGlyphIcon />,
    restricted: true
  }
];
