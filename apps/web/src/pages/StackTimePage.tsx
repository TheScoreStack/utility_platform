import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import UserSelect from "../components/UserSelect";
import { useStackTimeAccess } from "../modules/useStackTimeAccess";
import type {
  StackTimeAccessRecord,
  StackTimeEntriesResponse,
  StackTimeEntry,
  StackTimeProject,
  StackTimeReportByPerson,
  StackTimeReportByProject,
  TimelineStatsResponse
} from "../types";

type TabId = "log" | "summary" | "reports" | "timeline" | "projects" | "members";

interface EntryFormState {
  userId: string;
  projectId: string;
  date: string;
  hours: string;
  description: string;
}

const getDefaultDate = () => new Date().toISOString().split("T")[0];

const defaultEntryForm: EntryFormState = {
  userId: "",
  projectId: "",
  date: getDefaultDate(),
  hours: "",
  description: ""
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit"
  }).format(new Date(value + "T12:00:00"));

const formatHours = (hours: number) =>
  hours === 1 ? "1 hour" : `${hours.toFixed(1)} hours`;

const formatShortDate = (dateStr: string) => {
  const date = new Date(dateStr + "T12:00:00");
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const getDefaultDateRange = () => {
  const end = new Date();
  const start = new Date(end.getTime() - 12 * 7 * 24 * 60 * 60 * 1000);
  return {
    startDate: start.toISOString().split("T")[0],
    endDate: end.toISOString().split("T")[0]
  };
};

const StackTimePage = () => {
  const queryClient = useQueryClient();
  const { data: accessData, isLoading: accessLoading } = useStackTimeAccess();
  const [activeTab, setActiveTab] = useState<TabId>("log");
  const [entryForm, setEntryForm] = useState<EntryFormState>(defaultEntryForm);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectError, setProjectError] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [editingEntry, setEditingEntry] = useState<StackTimeEntry | null>(null);
  const [dateRange, setDateRange] = useState(getDefaultDateRange);
  const [expandedMember, setExpandedMember] = useState<string | null>(null);

  const isUserAdmin = accessData?.isAdmin ?? false;

  // Queries
  const projectsQuery = useQuery({
    queryKey: ["stack-time", "projects"],
    queryFn: () => api.get<{ projects: StackTimeProject[] }>("/stack-time/projects"),
    enabled: accessData?.allowed ?? false
  });

  const entriesQuery = useQuery({
    queryKey: ["stack-time", "entries"],
    queryFn: () => api.get<StackTimeEntriesResponse>("/stack-time/entries"),
    enabled: accessData?.allowed ?? false
  });

  const projectReportQuery = useQuery({
    queryKey: ["stack-time", "reports", "by-project"],
    queryFn: () => api.get<{ report: StackTimeReportByProject[] }>("/stack-time/reports/by-project"),
    enabled: accessData?.allowed ?? false
  });

  const personReportQuery = useQuery({
    queryKey: ["stack-time", "reports", "by-person"],
    queryFn: () => api.get<{ report: StackTimeReportByPerson[] }>("/stack-time/reports/by-person"),
    enabled: isUserAdmin
  });

  const teamEntriesQuery = useQuery({
    queryKey: ["stack-time", "entries", "team"],
    queryFn: () => api.get<StackTimeEntriesResponse>("/stack-time/entries/team"),
    enabled: isUserAdmin && activeTab === "reports"
  });

  const timelineQuery = useQuery({
    queryKey: ["stack-time", "reports", "timeline", dateRange.startDate, dateRange.endDate],
    queryFn: () =>
      api.get<TimelineStatsResponse>(
        `/stack-time/reports/timeline?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}`
      ),
    enabled: isUserAdmin && activeTab === "timeline"
  });

  // Mutations
  const createEntryMutation = useMutation({
    mutationFn: (payload: unknown) =>
      api.post<StackTimeEntry>("/stack-time/entries", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stack-time"] });
      setEntryForm({ ...defaultEntryForm, date: getDefaultDate() });
      setEntryError(null);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setEntryError(error.message);
      } else {
        setEntryError("Failed to log time entry");
      }
    }
  });

  const updateEntryMutation = useMutation({
    mutationFn: (payload: { entryId: string; originalDate: string; newDate?: string; projectId?: string; hours?: number; description?: string }) =>
      api.patch<StackTimeEntry>(`/stack-time/entries/${payload.entryId}`, {
        date: payload.originalDate,
        newDate: payload.newDate,
        projectId: payload.projectId,
        hours: payload.hours,
        description: payload.description
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stack-time"] });
      setEditingEntry(null);
      setEntryError(null);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setEntryError(error.message);
      } else {
        setEntryError("Failed to update entry");
      }
    }
  });

  const deleteEntryMutation = useMutation({
    mutationFn: (payload: { entryId: string; date: string }) =>
      api.delete(`/stack-time/entries/${payload.entryId}`, { date: payload.date }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stack-time"] });
    }
  });

  const createProjectMutation = useMutation({
    mutationFn: (payload: { name: string }) =>
      api.post<StackTimeProject>("/stack-time/projects", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stack-time", "projects"] });
      setProjectName("");
      setProjectError(null);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setProjectError(error.message);
      } else {
        setProjectError("Failed to create project");
      }
    }
  });

  const updateProjectMutation = useMutation({
    mutationFn: (payload: { projectId: string; isActive: boolean }) =>
      api.patch<StackTimeProject>(`/stack-time/projects/${payload.projectId}`, {
        isActive: payload.isActive
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stack-time", "projects"] });
    }
  });

  const addAccessMutation = useMutation({
    mutationFn: (payload: { userId: string; isAdmin: boolean }) =>
      api.post<StackTimeAccessRecord>("/stack-time/access", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stack-time", "access"] });
      setSelectedUserId("");
      setIsAdmin(false);
      setAccessError(null);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setAccessError(error.message);
      } else {
        setAccessError("Unable to add member");
      }
    }
  });

  const removeAccessMutation = useMutation({
    mutationFn: (accessId: string) => api.delete(`/stack-time/access/${accessId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stack-time", "access"] });
    }
  });

  const activeProjects = useMemo(() => {
    return (projectsQuery.data?.projects ?? []).filter((p) => p.isActive);
  }, [projectsQuery.data?.projects]);

  const handleSubmitEntry = (e: FormEvent) => {
    e.preventDefault();
    const hours = parseFloat(entryForm.hours);
    if (isNaN(hours) || hours <= 0) {
      setEntryError("Please enter valid hours");
      return;
    }
    if (!entryForm.projectId) {
      setEntryError("Please select a project");
      return;
    }
    if (!entryForm.date) {
      setEntryError("Please select a date");
      return;
    }

    const payload: Record<string, unknown> = {
      projectId: entryForm.projectId,
      date: entryForm.date,
      hours,
      description: entryForm.description || undefined
    };

    // If admin is logging for someone else
    if (isUserAdmin && entryForm.userId) {
      payload.userId = entryForm.userId;
    }

    createEntryMutation.mutate(payload);
  };

  const handleUpdateEntry = (e: FormEvent) => {
    e.preventDefault();
    if (!editingEntry) return;

    const hours = parseFloat(entryForm.hours);
    if (isNaN(hours) || hours <= 0) {
      setEntryError("Please enter valid hours");
      return;
    }

    if (!entryForm.date) {
      setEntryError("Please select a date");
      return;
    }

    updateEntryMutation.mutate({
      entryId: editingEntry.entryId,
      originalDate: editingEntry.date,
      newDate: entryForm.date !== editingEntry.date ? entryForm.date : undefined,
      projectId: entryForm.projectId || undefined,
      hours,
      description: entryForm.description || undefined
    });
  };

  const startEdit = (entry: StackTimeEntry) => {
    setEditingEntry(entry);
    setEntryForm({
      userId: "",
      projectId: entry.projectId,
      date: entry.date,
      hours: entry.hours.toString(),
      description: entry.description ?? ""
    });
    setEntryError(null);
  };

  const cancelEdit = () => {
    setEditingEntry(null);
    setEntryForm({ ...defaultEntryForm, date: getDefaultDate() });
    setEntryError(null);
  };

  if (accessLoading) {
    return (
      <div className="st-page">
        <section className="st-hero">
          <span className="st-hero__eyebrow">Stack Time</span>
          <h1 className="st-hero__title">
            Checking <em>your access…</em>
          </h1>
        </section>
      </div>
    );
  }

  if (!accessData?.allowed) {
    return (
      <div className="st-page">
        <section className="st-hero">
          <span className="st-hero__eyebrow">Stack Time · private</span>
          <h1 className="st-hero__title">
            Hours, <em>for the team.</em>
          </h1>
          <p className="st-hero__sub">
            This module is for Stack Technologies team members only. Ask Hunter
            to add you.
          </p>
          <div className="st-hero__rule" aria-hidden="true" />
        </section>
      </div>
    );
  }

  const tabs: { id: TabId; label: string; adminOnly?: boolean }[] = [
    { id: "log", label: "Log Time" },
    { id: "summary", label: "My Summary" },
    { id: "reports", label: "Team Reports", adminOnly: true },
    { id: "timeline", label: "Performance", adminOnly: true },
    { id: "projects", label: "Projects", adminOnly: true },
    { id: "members", label: "Members", adminOnly: true }
  ];

  const visibleTabs = tabs.filter((t) => !t.adminOnly || isUserAdmin);

  return (
    <div className="st-page">
      <section className="st-hero ov-rise ov-rise-1">
        <span className="st-hero__eyebrow">Stack Time · time tracking</span>
        <h1 className="st-hero__title">
          Hours, <em>logged.</em>
        </h1>
        <p className="st-hero__sub">
          Track time on Stack Technologies projects — yours and the team&rsquo;s.
        </p>
        <div className="st-hero__rule" aria-hidden="true" />
        <div className="st-tabs" role="tablist" aria-label="Stack Time sections">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`st-tabs__btn ${activeTab === tab.id ? "st-tabs__btn--active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {activeTab === "log" && (
        <div className="grid-two">
          <section className="card">
            <div className="section-title">
              <h2>{editingEntry ? "Edit Entry" : "Log Time"}</h2>
            </div>
            <form onSubmit={editingEntry ? handleUpdateEntry : handleSubmitEntry}>
              <div className="list">
                {isUserAdmin && !editingEntry && (
                  <div className="input-group">
                    <label>Log time for</label>
                    <UserSelect
                      value={entryForm.userId}
                      onChange={(userId) => setEntryForm((f) => ({ ...f, userId }))}
                      placeholder="Yourself (leave blank) or select team member"
                    />
                  </div>
                )}
                <div className="input-group">
                  <label>Project *</label>
                  <select
                    value={entryForm.projectId}
                    onChange={(e) => setEntryForm((f) => ({ ...f, projectId: e.target.value }))}
                    required
                  >
                    <option value="">Select a project</option>
                    {activeProjects.map((p) => (
                      <option key={p.projectId} value={p.projectId}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="input-group">
                  <label>Date *</label>
                  <input
                    type="date"
                    value={entryForm.date}
                    onChange={(e) => setEntryForm((f) => ({ ...f, date: e.target.value }))}
                    required
                  />
                </div>
                <div className="input-group">
                  <label>Hours *</label>
                  <input
                    type="number"
                    step="0.25"
                    min="0.25"
                    max="24"
                    placeholder="e.g. 2.5"
                    value={entryForm.hours}
                    onChange={(e) => setEntryForm((f) => ({ ...f, hours: e.target.value }))}
                    required
                  />
                </div>
                <div className="input-group">
                  <label>Description</label>
                  <input
                    type="text"
                    placeholder="What did you work on?"
                    value={entryForm.description}
                    onChange={(e) => setEntryForm((f) => ({ ...f, description: e.target.value }))}
                  />
                </div>
                {entryError && <p className="error">{entryError}</p>}
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  {editingEntry && (
                    <button type="button" className="secondary" onClick={cancelEdit}>
                      Cancel
                    </button>
                  )}
                  <button
                    type="submit"
                    className="primary"
                    disabled={createEntryMutation.isPending || updateEntryMutation.isPending}
                  >
                    {editingEntry ? "Update Entry" : "Log Time"}
                  </button>
                </div>
              </div>
            </form>
          </section>

          <section className="card" style={{ gridColumn: "1 / -1" }}>
            <div className="section-title">
              <h2>Recent Entries</h2>
              {entriesQuery.data && entriesQuery.data.entries.length > 0 && (
                <span className="muted">{formatHours(entriesQuery.data.totalHours)} total</span>
              )}
            </div>
            {entriesQuery.isLoading && <p className="muted">Loading...</p>}
            {entriesQuery.data && entriesQuery.data.entries.length === 0 && (
              <p className="muted">No time entries yet. Log your first entry above!</p>
            )}
            {entriesQuery.data && entriesQuery.data.entries.length > 0 && (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>For</th>
                      <th>Project</th>
                      <th>Hours</th>
                      <th>Description</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {entriesQuery.data.entries.map((entry) => (
                      <tr key={entry.entryId}>
                        <td>{formatDate(entry.date)}</td>
                        <td>{entry.userDisplayName ?? "-"}</td>
                        <td>{entry.projectName ?? entry.projectId}</td>
                        <td>{entry.hours}</td>
                        <td>{entry.description || "-"}</td>
                        <td>
                          <div style={{ display: "flex", gap: "0.5rem" }}>
                            <button
                              className="secondary"
                              style={{ padding: "0.35rem 0.75rem", fontSize: "0.85rem" }}
                              onClick={() => startEdit(entry)}
                            >
                              Edit
                            </button>
                            <button
                              className="secondary"
                              style={{ padding: "0.35rem 0.75rem", fontSize: "0.85rem", opacity: 0.6 }}
                              onClick={() =>
                                deleteEntryMutation.mutate({
                                  entryId: entry.entryId,
                                  date: entry.date
                                })
                              }
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === "summary" && (
        <section className="card">
          <div className="section-title">
            <h2>My Hours by Project</h2>
          </div>
          {projectReportQuery.isLoading && <p className="muted">Loading...</p>}
          {projectReportQuery.data && projectReportQuery.data.report.length === 0 && (
            <p className="muted">No time logged yet.</p>
          )}
          {projectReportQuery.data && projectReportQuery.data.report.length > 0 && (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Total Hours</th>
                    <th>Entries</th>
                  </tr>
                </thead>
                <tbody>
                  {projectReportQuery.data.report.map((row) => (
                    <tr key={row.projectId}>
                      <td>{row.projectName}</td>
                      <td>{row.totalHours.toFixed(1)}</td>
                      <td>{row.entryCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === "reports" && isUserAdmin && (
        <>
          <section className="card" style={{ marginBottom: "1rem" }}>
            <div className="section-title">
              <h2>Team Hours by Person</h2>
            </div>
            {personReportQuery.isLoading && <p className="muted">Loading...</p>}
            {personReportQuery.data && personReportQuery.data.report.length === 0 && (
              <p className="muted">No time logged by the team yet.</p>
            )}
            {personReportQuery.data && personReportQuery.data.report.length > 0 && (
              <div className="list">
                {personReportQuery.data.report.map((person) => (
                  <div
                    key={person.userId}
                    className="card"
                    style={{ padding: "1rem 1.25rem" }}
                  >
                    <div className="section-title" style={{ marginBottom: "0.75rem" }}>
                      <h3 style={{ margin: 0 }}>{person.displayName}</h3>
                      <span className="muted">{formatHours(person.totalHours)} total</span>
                    </div>
                    <div className="table-wrapper">
                      <table>
                        <thead>
                          <tr>
                            <th>Project</th>
                            <th>Hours</th>
                            <th>Entries</th>
                          </tr>
                        </thead>
                        <tbody>
                          {person.byProject.map((proj) => (
                            <tr key={proj.projectId}>
                              <td>{proj.projectName}</td>
                              <td>{proj.totalHours.toFixed(1)}</td>
                              <td>{proj.entryCount}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card">
            <div className="section-title">
              <h2>All Team Entries</h2>
              {teamEntriesQuery.data && teamEntriesQuery.data.entries.length > 0 && (
                <span className="muted">{formatHours(teamEntriesQuery.data.totalHours)} total</span>
              )}
            </div>
            {teamEntriesQuery.isLoading && <p className="muted">Loading...</p>}
            {teamEntriesQuery.data && teamEntriesQuery.data.entries.length === 0 && (
              <p className="muted">No team entries yet.</p>
            )}
            {teamEntriesQuery.data && teamEntriesQuery.data.entries.length > 0 && (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Person</th>
                      <th>Project</th>
                      <th>Hours</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamEntriesQuery.data.entries.map((entry) => (
                      <tr key={entry.entryId}>
                        <td>{formatDate(entry.date)}</td>
                        <td>{entry.userDisplayName ?? "-"}</td>
                        <td>{entry.projectName ?? entry.projectId}</td>
                        <td>{entry.hours}</td>
                        <td>{entry.description || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {activeTab === "timeline" && isUserAdmin && (
        <div>
          {/* Date range filter */}
          <section className="card" style={{ marginBottom: "1rem" }}>
            <div className="section-title">
              <h2>Performance Timeline</h2>
            </div>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end" }}>
              <div className="input-group" style={{ flex: "0 0 auto" }}>
                <label>Start Date</label>
                <input
                  type="date"
                  value={dateRange.startDate}
                  onChange={(e) => setDateRange((prev) => ({ ...prev, startDate: e.target.value }))}
                />
              </div>
              <div className="input-group" style={{ flex: "0 0 auto" }}>
                <label>End Date</label>
                <input
                  type="date"
                  value={dateRange.endDate}
                  onChange={(e) => setDateRange((prev) => ({ ...prev, endDate: e.target.value }))}
                />
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const end = new Date();
                    const start = new Date(end.getTime() - 4 * 7 * 24 * 60 * 60 * 1000);
                    setDateRange({
                      startDate: start.toISOString().split("T")[0],
                      endDate: end.toISOString().split("T")[0]
                    });
                  }}
                >
                  Last 4 weeks
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const end = new Date();
                    const start = new Date(end.getTime() - 12 * 7 * 24 * 60 * 60 * 1000);
                    setDateRange({
                      startDate: start.toISOString().split("T")[0],
                      endDate: end.toISOString().split("T")[0]
                    });
                  }}
                >
                  Last 12 weeks
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const end = new Date();
                    const start = new Date(end.getFullYear(), 0, 1);
                    setDateRange({
                      startDate: start.toISOString().split("T")[0],
                      endDate: end.toISOString().split("T")[0]
                    });
                  }}
                >
                  This Year
                </button>
              </div>
            </div>
          </section>

          {timelineQuery.isLoading && <p className="muted">Loading timeline data...</p>}
          {timelineQuery.data && (
            <>
              {/* Summary stats */}
              <section className="card" style={{ marginBottom: "1rem" }}>
                <div className="section-title">
                  <h2>Summary</h2>
                  <span className="muted">
                    {formatDate(timelineQuery.data.startDate)} — {formatDate(timelineQuery.data.endDate)}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
                  <div>
                    <p className="muted" style={{ margin: "0 0 0.25rem", fontSize: "0.85rem" }}>
                      Total Hours
                    </p>
                    <p style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>
                      {timelineQuery.data.totalHours.toFixed(1)}
                    </p>
                  </div>
                  <div>
                    <p className="muted" style={{ margin: "0 0 0.25rem", fontSize: "0.85rem" }}>
                      Total Entries
                    </p>
                    <p style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>
                      {timelineQuery.data.totalEntries}
                    </p>
                  </div>
                  <div>
                    <p className="muted" style={{ margin: "0 0 0.25rem", fontSize: "0.85rem" }}>
                      Active Members
                    </p>
                    <p style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>
                      {timelineQuery.data.activeMembers}
                    </p>
                  </div>
                  <div>
                    <p className="muted" style={{ margin: "0 0 0.25rem", fontSize: "0.85rem" }}>
                      Weeks
                    </p>
                    <p style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>
                      {timelineQuery.data.weeksInPeriod}
                    </p>
                  </div>
                </div>
              </section>

              {/* Per-member breakdown */}
              {timelineQuery.data.members.length === 0 && (
                <p className="muted">No time logged in this period.</p>
              )}
              <div className="list">
                {timelineQuery.data.members.map((member) => (
                  <section
                    key={member.userId}
                    className="card"
                    style={{ padding: "1rem 1.25rem", cursor: "pointer" }}
                    onClick={() =>
                      setExpandedMember(expandedMember === member.userId ? null : member.userId)
                    }
                  >
                    <div className="section-title" style={{ marginBottom: "0.75rem" }}>
                      <h3 style={{ margin: 0 }}>{member.displayName}</h3>
                      <span className="pill">{formatHours(member.totalHours)}</span>
                    </div>

                    {/* Key metrics */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                        gap: "1rem",
                        marginBottom: "1rem"
                      }}
                    >
                      <div>
                        <p className="muted" style={{ margin: 0, fontSize: "0.75rem" }}>
                          Avg Hours/Entry
                        </p>
                        <p style={{ margin: 0, fontWeight: 600 }}>{member.avgHoursPerEntry}</p>
                      </div>
                      <div>
                        <p className="muted" style={{ margin: 0, fontSize: "0.75rem" }}>
                          Avg Hours/Active Week
                        </p>
                        <p style={{ margin: 0, fontWeight: 600 }}>{member.avgHoursPerWeek}</p>
                      </div>
                      <div>
                        <p className="muted" style={{ margin: 0, fontSize: "0.75rem" }}>
                          Active Days
                        </p>
                        <p style={{ margin: 0, fontWeight: 600 }}>{member.activeDays}</p>
                      </div>
                      <div>
                        <p className="muted" style={{ margin: 0, fontSize: "0.75rem" }}>
                          Entries
                        </p>
                        <p style={{ margin: 0, fontWeight: 600 }}>{member.entryCount}</p>
                      </div>
                    </div>

                    {/* Weekly breakdown - simple bar visualization */}
                    <div style={{ marginBottom: "0.75rem" }}>
                      <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: "0.75rem" }}>
                        Weekly Hours
                      </p>
                      <div
                        style={{
                          display: "flex",
                          gap: "2px",
                          alignItems: "flex-end",
                          height: "40px"
                        }}
                      >
                        {member.weeklyBreakdown.map((week, idx) => {
                          const maxHours = Math.max(...member.weeklyBreakdown.map((w) => w.hours), 1);
                          const height = (week.hours / maxHours) * 100;
                          return (
                            <div
                              key={idx}
                              title={`${formatShortDate(week.weekStart)}: ${week.hours.toFixed(1)} hrs`}
                              style={{
                                flex: 1,
                                height: `${Math.max(height, 2)}%`,
                                background: week.hours > 0 ? "var(--accent, #6366f1)" : "var(--border, #333)",
                                borderRadius: "2px",
                                minWidth: "4px"
                              }}
                            />
                          );
                        })}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginTop: "0.25rem"
                        }}
                      >
                        <span className="muted" style={{ fontSize: "0.65rem" }}>
                          {formatShortDate(member.weeklyBreakdown[0]?.weekStart ?? "")}
                        </span>
                        <span className="muted" style={{ fontSize: "0.65rem" }}>
                          {formatShortDate(
                            member.weeklyBreakdown[member.weeklyBreakdown.length - 1]?.weekStart ?? ""
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Expanded details */}
                    {expandedMember === member.userId && (
                      <div style={{ marginTop: "1rem", borderTop: "1px solid var(--border, #333)", paddingTop: "1rem" }}>
                        <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: "0.75rem" }}>
                          First Entry: {member.firstEntryDate ? formatDate(member.firstEntryDate) : "—"}
                          {" | "}Last Entry: {member.lastEntryDate ? formatDate(member.lastEntryDate) : "—"}
                        </p>
                        <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", fontWeight: 600 }}>
                          Hours by Project
                        </p>
                        <div className="table-wrapper">
                          <table>
                            <thead>
                              <tr>
                                <th>Project</th>
                                <th>Hours</th>
                                <th>Entries</th>
                                <th>% of Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {member.byProject.map((proj) => (
                                <tr key={proj.projectId}>
                                  <td>{proj.projectName}</td>
                                  <td>{proj.totalHours.toFixed(1)}</td>
                                  <td>{proj.entryCount}</td>
                                  <td>
                                    {member.totalHours > 0
                                      ? ((proj.totalHours / member.totalHours) * 100).toFixed(0)
                                      : 0}
                                    %
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.75rem", textAlign: "center" }}>
                      {expandedMember === member.userId ? "Click to collapse" : "Click to expand"}
                    </p>
                  </section>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === "projects" && isUserAdmin && (
        <div className="grid-two">
          <section className="card">
            <div className="section-title">
              <h2>Add Project</h2>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!projectName.trim()) return;
                createProjectMutation.mutate({ name: projectName.trim() });
              }}
            >
              <div className="list">
                <div className="input-group">
                  <label>Project Name</label>
                  <input
                    type="text"
                    placeholder="e.g. New Client Project"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                  />
                </div>
                {projectError && <p className="error">{projectError}</p>}
                <button
                  type="submit"
                  className="primary"
                  disabled={createProjectMutation.isPending}
                >
                  Add Project
                </button>
              </div>
            </form>
          </section>

          <section className="card" style={{ gridColumn: "1 / -1" }}>
            <div className="section-title">
              <h2>All Projects</h2>
              <span className="muted">{projectsQuery.data?.projects.length ?? 0} total</span>
            </div>
            {projectsQuery.isLoading && <p className="muted">Loading...</p>}
            {projectsQuery.data && (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectsQuery.data.projects.map((proj) => (
                      <tr key={proj.projectId}>
                        <td>{proj.name}</td>
                        <td>
                          <span
                            className="pill"
                            style={{
                              background: proj.isActive
                                ? "rgba(74, 222, 128, 0.15)"
                                : "rgba(248, 113, 113, 0.15)",
                              color: proj.isActive ? "#4ade80" : "#f87171"
                            }}
                          >
                            {proj.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td>
                          <button
                            className="secondary"
                            style={{ padding: "0.35rem 0.75rem", fontSize: "0.85rem" }}
                            onClick={() =>
                              updateProjectMutation.mutate({
                                projectId: proj.projectId,
                                isActive: !proj.isActive
                              })
                            }
                          >
                            {proj.isActive ? "Deactivate" : "Activate"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === "members" && isUserAdmin && (
        <div className="grid-two">
          <section className="card">
            <div className="section-title">
              <h2>Add Team Member</h2>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!selectedUserId) return;
                addAccessMutation.mutate({ userId: selectedUserId, isAdmin });
              }}
            >
              <div className="list">
                <div className="input-group">
                  <label>User</label>
                  <UserSelect
                    value={selectedUserId}
                    onChange={setSelectedUserId}
                    placeholder="Search by name or email"
                  />
                </div>
                <div className="input-group">
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <input
                      type="checkbox"
                      checked={isAdmin}
                      onChange={(e) => setIsAdmin(e.target.checked)}
                    />
                    Grant admin access
                  </label>
                </div>
                {accessError && <p className="error">{accessError}</p>}
                <button
                  type="submit"
                  className="primary"
                  disabled={addAccessMutation.isPending || !selectedUserId}
                >
                  Add Member
                </button>
              </div>
            </form>
          </section>

          <section className="card" style={{ gridColumn: "1 / -1" }}>
            <div className="section-title">
              <h2>Current Members</h2>
              <span className="muted">{accessData?.members?.length ?? 0} total</span>
            </div>
            {accessData?.members && (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {accessData.members.map((member) => (
                      <tr key={member.accessId}>
                        <td>{member.displayName ?? "-"}</td>
                        <td>{member.email ?? "-"}</td>
                        <td>
                          <span
                            className="pill"
                            style={{
                              background: member.isAdmin
                                ? "rgba(99, 102, 241, 0.15)"
                                : "rgba(148, 163, 184, 0.15)",
                              color: member.isAdmin ? "#a5b4fc" : "#94a3b8"
                            }}
                          >
                            {member.isAdmin ? "Admin" : "Member"}
                          </span>
                        </td>
                        <td>
                          {member.accessId !== accessData.currentAccessId && (
                            <button
                              className="secondary"
                              style={{ padding: "0.35rem 0.75rem", fontSize: "0.85rem", opacity: 0.6 }}
                              onClick={() => removeAccessMutation.mutate(member.accessId)}
                            >
                              Remove
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};

export default StackTimePage;
