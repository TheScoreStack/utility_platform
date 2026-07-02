import type { TripSummary } from "../../types";

interface ExpenseFiltersProps {
  members: TripSummary["members"];
  membersById: Record<string, string>;
  categories: Array<{ key: string; label: string; icon: string }>;
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  memberFilter: string;
  onMemberFilterChange: (value: string) => void;
  categoryFilter: string;
  onCategoryFilterChange: (value: string) => void;
  dateFrom: string;
  onDateFromChange: (value: string) => void;
  dateTo: string;
  onDateToChange: (value: string) => void;
  filteredCount: number;
  totalCount: number;
  filteredTotal: number;
  formatCurrency: Intl.NumberFormat;
  onResetFilters: () => void;
}

export const ExpenseFilters = ({
  members,
  membersById,
  categories,
  searchTerm,
  onSearchTermChange,
  memberFilter,
  onMemberFilterChange,
  categoryFilter,
  onCategoryFilterChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  filteredCount,
  totalCount,
  filteredTotal,
  formatCurrency,
  onResetFilters
}: ExpenseFiltersProps) => (
  <div
    className="card"
    style={{
      padding: "1rem 1.5rem",
      borderRadius: "0.9rem",
      border: "1px solid rgba(148,163,184,0.12)",
      background: "rgba(15,23,42,0.4)",
      backdropFilter: "blur(12px)",
      display: "flex",
      flexDirection: "column",
      gap: "0.9rem"
    }}
  >
    <div className="expense-search">
      <span className="expense-search__icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="7" cy="7" r="4.5" />
          <line x1="10.5" y1="10.5" x2="14" y2="14" />
        </svg>
      </span>
      <input
        className="expense-search__input"
        type="search"
        value={searchTerm}
        onChange={(event) => onSearchTermChange(event.target.value)}
        placeholder="Search description, vendor, category, or amount…"
        aria-label="Search expenses"
      />
      {searchTerm && (
        <button
          type="button"
          className="expense-search__clear"
          onClick={() => onSearchTermChange("")}
          aria-label="Clear search"
          title="Clear search"
        >
          ×
        </button>
      )}
    </div>
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.75rem"
      }}
    >
      <div className="input-group" style={{ minWidth: "160px" }}>
        <label>Person</label>
        <select value={memberFilter} onChange={(event) => onMemberFilterChange(event.target.value)}>
          <option value="all">All</option>
          {members.map((member) => (
            <option key={member.memberId} value={member.memberId}>
              {membersById[member.memberId] ?? member.memberId}
            </option>
          ))}
        </select>
      </div>
      <div className="input-group" style={{ minWidth: "160px" }}>
        <label>Category</label>
        <select value={categoryFilter} onChange={(event) => onCategoryFilterChange(event.target.value)}>
          <option value="all">All</option>
          {categories.map((cat) => (
            <option key={cat.key} value={cat.key}>
              {cat.icon} {cat.label}
            </option>
          ))}
        </select>
      </div>
      <div className="input-group" style={{ minWidth: "140px" }}>
        <label>From</label>
        <input type="date" value={dateFrom} onChange={(event) => onDateFromChange(event.target.value)} />
      </div>
      <div className="input-group" style={{ minWidth: "140px" }}>
        <label>To</label>
        <input type="date" value={dateTo} onChange={(event) => onDateToChange(event.target.value)} />
      </div>
    </div>
    {(() => {
      const activeCount =
        (memberFilter !== "all" ? 1 : 0) +
        (categoryFilter !== "all" ? 1 : 0) +
        (dateFrom ? 1 : 0) +
        (dateTo ? 1 : 0) +
        (searchTerm.trim() ? 1 : 0);
      return (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <span className="muted" style={{ fontSize: "0.9rem" }}>
              Showing {filteredCount} of {totalCount} expenses
            </span>
            {activeCount > 0 && (
              <button
                type="button"
                className="filter-clear"
                onClick={onResetFilters}
                title="Clear all active filters"
              >
                <span className="filter-clear__x" aria-hidden="true">×</span>
                Clear <span className="filter-clear__count">{activeCount}</span> {activeCount === 1 ? "filter" : "filters"}
              </button>
            )}
          </div>
          <strong style={{ fontFamily: "var(--serif)", fontSize: "1.1rem" }}>
            {formatCurrency.format(filteredTotal)}
          </strong>
        </div>
      );
    })()}
  </div>
);
