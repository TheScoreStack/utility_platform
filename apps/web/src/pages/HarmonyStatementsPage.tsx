import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import HarmonySubNav from "../components/HarmonySubNav";
import {
  HarmonyStatement,
  HarmonyStatementCreateResponse,
  HarmonyStatementDetailResponse,
  HarmonyStatementFileType,
  HarmonyStatementSourceType,
  HarmonyStatementsResponse
} from "../types";
import { useHarmonyLedgerAccess } from "../modules/useHarmonyLedgerAccess";
import { isStatementProcessing, useHarmonyStatements } from "../modules/useHarmonyStatements";
import { useConfirm } from "../components/ConfirmDialog";

const MAX_FILE_BYTES = 18 * 1024 * 1024;

const sourceTypeLabels: Record<HarmonyStatementSourceType, string> = {
  BANK: "Bank",
  VENMO: "Venmo",
  PAYPAL: "PayPal",
  OTHER: "Other"
};

const fileTypeLabels: Record<HarmonyStatementFileType, string> = {
  PDF: "PDF",
  CSV: "CSV",
  IMAGE: "Image"
};

const FILE_TYPE_ERROR = "Upload a PDF, CSV, or a photo of a statement (JPEG, PNG, or WebP).";

type UploadPhase =
  | { step: "idle" }
  | { step: "uploading" }
  | { step: "parsing" }
  | { step: "failed"; message: string };

const contentTypeFor = (file: File): string | null => {
  const type = file.type.toLowerCase();
  if (type === "application/pdf" || type === "text/csv" || type.startsWith("image/")) {
    return type;
  }
  // Fall back by extension for files the browser doesn't type (or mistypes).
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".csv")) return "text/csv";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  return null;
};

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const countsSummary = (statement: HarmonyStatement): string => {
  const counts = statement.counts;
  if (!counts) {
    return "Ready to review";
  }
  if (counts.total === 0) {
    return "No transactions found";
  }
  const parts: string[] = [];
  if (counts.pending > 0) {
    parts.push(`${counts.pending} to review`);
  }
  if (counts.confirmed > 0) {
    parts.push(`${counts.confirmed} confirmed`);
  }
  if (counts.dismissed > 0) {
    parts.push(`${counts.dismissed} dismissed`);
  }
  if (counts.duplicates > 0) {
    parts.push(`${counts.duplicates} duplicate${counts.duplicates === 1 ? "" : "s"}`);
  }
  if (parts.length === 0) {
    parts.push("All reviewed");
  }
  return parts.join(" · ");
};

const HarmonyStatementsPage = () => {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: accessData, isLoading: accessLoading } = useHarmonyLedgerAccess();
  const statementsQuery = useHarmonyStatements(accessData?.allowed ?? false);

  const [sourceType, setSourceType] = useState<HarmonyStatementSourceType>("BANK");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [phase, setPhase] = useState<UploadPhase>({ step: "idle" });
  const [isDragOver, setDragOver] = useState(false);
  const [retryErrors, setRetryErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const deleteMutation = useMutation({
    mutationFn: (statementId: string) =>
      api.delete(`/harmony-ledger/statements/${statementId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["harmony-ledger", "statements"] });
    }
  });

  const statementsKey = ["harmony-ledger", "statements"];

  const replaceStatement = (updated: HarmonyStatement) => {
    queryClient.setQueryData<HarmonyStatementsResponse>(statementsKey, (current) =>
      current
        ? {
            statements: current.statements.map((item) =>
              item.statementId === updated.statementId ? updated : item
            )
          }
        : current
    );
  };

  const retryMutation = useMutation({
    mutationFn: (statement: HarmonyStatement) =>
      api.post<{ statement: HarmonyStatement }>(
        `/harmony-ledger/statements/${statement.statementId}/retry`
      ),
    onMutate: (statement) => {
      setRetryErrors((prev) => {
        if (!(statement.statementId in prev)) return prev;
        const next = { ...prev };
        delete next[statement.statementId];
        return next;
      });
      const previous =
        queryClient.getQueryData<HarmonyStatementsResponse>(statementsKey);
      // Optimistically flip to parsing; the list poll takes over from here.
      replaceStatement({
        ...statement,
        status: "PROCESSING",
        errorMessage: undefined
      });
      return { previous };
    },
    onSuccess: (result) => replaceStatement(result.statement),
    onError: (error: unknown, statement, context) => {
      if (context?.previous) {
        queryClient.setQueryData(statementsKey, context.previous);
      }
      setRetryErrors((prev) => ({
        ...prev,
        [statement.statementId]:
          error instanceof ApiError || error instanceof Error
            ? error.message
            : "Retry failed"
      }));
    }
  });

  const isBusy = phase.step === "uploading" || phase.step === "parsing";

  const acceptFile = (candidate: File | null) => {
    if (isBusy) return;
    setFileError(null);
    if (phase.step === "failed") {
      setPhase({ step: "idle" });
    }
    if (!candidate) {
      setFile(null);
      return;
    }
    if (!contentTypeFor(candidate)) {
      setFile(null);
      setFileError(FILE_TYPE_ERROR);
      return;
    }
    if (candidate.size > MAX_FILE_BYTES) {
      setFile(null);
      setFileError("That file is over the 18 MB limit.");
      return;
    }
    setFile(candidate);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    acceptFile(event.target.files?.[0] ?? null);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    acceptFile(event.dataTransfer.files?.[0] ?? null);
  };

  const handleUpload = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || isBusy) return;
    const contentType = contentTypeFor(file);
    if (!contentType) {
      setFileError(FILE_TYPE_ERROR);
      return;
    }

    try {
      setPhase({ step: "uploading" });
      const created = await api.post<HarmonyStatementCreateResponse>(
        "/harmony-ledger/statements",
        {
          fileName: file.name,
          contentType,
          sourceType
        }
      );

      const putResponse = await fetch(created.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file
      });
      if (!putResponse.ok) {
        throw new Error("Upload to storage failed — please try again.");
      }

      if (!mountedRef.current) return;
      setPhase({ step: "parsing" });
      queryClient.invalidateQueries({ queryKey: ["harmony-ledger", "statements"] });

      const statementId = created.statement.statementId;
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await sleep(2000);
        if (!mountedRef.current) return;
        const detail = await api.get<HarmonyStatementDetailResponse>(
          `/harmony-ledger/statements/${statementId}`
        );
        if (detail.statement.status === "PARSED") {
          queryClient.setQueryData(
            ["harmony-ledger", "statements", statementId],
            detail
          );
          queryClient.invalidateQueries({ queryKey: ["harmony-ledger", "statements"] });
          navigate(`/harmony-ledger/statements/${statementId}`);
          return;
        }
        if (detail.statement.status === "FAILED") {
          queryClient.invalidateQueries({ queryKey: ["harmony-ledger", "statements"] });
          setPhase({
            step: "failed",
            message:
              detail.statement.errorMessage ??
              "We couldn't parse this statement. Try a different export."
          });
          return;
        }
      }
      setPhase({
        step: "failed",
        message:
          "Parsing is taking longer than expected. Keep an eye on the list below — it will open once it's ready."
      });
    } catch (error) {
      if (!mountedRef.current) return;
      if (error instanceof ApiError) {
        setPhase({ step: "failed", message: error.message });
      } else if (error instanceof Error) {
        setPhase({ step: "failed", message: error.message });
      } else {
        setPhase({ step: "failed", message: "Upload failed" });
      }
    }
  };

  const handleDelete = async (statement: HarmonyStatement) => {
    const ok = await confirm({
      title: `Delete "${statement.fileName}"?`,
      body: "Pending transactions from this statement are removed. Ledger entries you already confirmed are kept.",
      confirmLabel: "Delete",
      tone: "danger"
    });
    if (!ok) return;
    deleteMutation.mutate(statement.statementId);
  };

  if (accessLoading) {
    return (
      <div className="hl-page">
        <HarmonySubNav />
        <section className="hl-hero">
          <span className="hl-hero__eyebrow">Harmony Collective</span>
          <h1 className="hl-hero__title">
            Checking <em>your access…</em>
          </h1>
        </section>
      </div>
    );
  }

  if (!accessData?.allowed) {
    return (
      <div className="hl-page">
        <HarmonySubNav />
        <section className="hl-hero">
          <span className="hl-hero__eyebrow">Harmony Collective · private</span>
          <h1 className="hl-hero__title">
            Invite-only <em>workspace.</em>
          </h1>
          <p className="hl-hero__net">
            If you should have access, ask Hunter to add you on the Ledger page.
          </p>
          <div className="hl-hero__rule" aria-hidden="true" />
        </section>
      </div>
    );
  }

  const statements = statementsQuery.data?.statements ?? [];

  return (
    <div className="hl-page">
      <HarmonySubNav />

      <section className="card">
        <div className="section-title">
          <div>
            <h2>Import a Statement</h2>
            <p className="muted">
              Upload a bank, Venmo, or PayPal export — a whole statement or a
              single transaction, even a screenshot — and let AI turn it into
              ledger entries. The original file stays on record.
            </p>
          </div>
        </div>
        <form onSubmit={handleUpload} className="list">
          <div className="input-group">
            <label htmlFor="statement-source">Source</label>
            <select
              id="statement-source"
              value={sourceType}
              onChange={(event) =>
                setSourceType(event.target.value as HarmonyStatementSourceType)
              }
              disabled={isBusy}
            >
              {Object.entries(sourceTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label htmlFor="statement-file">Statement file</label>
            <div
              className={isDragOver ? "hl-dropzone hl-dropzone--active" : "hl-dropzone"}
              role="button"
              tabIndex={0}
              onClick={() => !isBusy && fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  if (!isBusy) fileInputRef.current?.click();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (!isBusy) setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              {file ? (
                <span className="hl-dropzone__file">{file.name}</span>
              ) : (
                <span>Drop a statement here, or click to browse</span>
              )}
              <span className="hl-dropzone__hint">
                PDF, CSV, or a photo of a statement · up to 18 MB
              </span>
            </div>
            <input
              ref={fileInputRef}
              id="statement-file"
              type="file"
              accept=".pdf,.csv,image/jpeg,image/png,image/webp"
              style={{ display: "none" }}
              onChange={handleFileChange}
              disabled={isBusy}
            />
          </div>
          {fileError && <p className="error">{fileError}</p>}
          {phase.step === "failed" && <p className="error">{phase.message}</p>}
          {phase.step === "parsing" && (
            <p className="muted" style={{ margin: 0 }}>
              Parsing with AI… (usually under a minute)
            </p>
          )}
          <button type="submit" disabled={!file || isBusy}>
            {phase.step === "uploading"
              ? "Uploading…"
              : phase.step === "parsing"
                ? "Parsing…"
                : "Upload statement"}
          </button>
        </form>
      </section>

      <section className="card">
        <div className="section-title">
          <div>
            <h2>Imported Statements</h2>
            <p className="muted">Open a parsed statement to review its transactions.</p>
          </div>
        </div>
        {statementsQuery.isLoading ? (
          <p className="muted">Loading statements…</p>
        ) : statements.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state__title">No statements yet.</p>
            <p className="empty-state__hint">
              Upload a bank, Venmo, or PayPal export above and AI will draft ledger
              entries for you to review.
            </p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th style={{ width: "10%" }}>Source</th>
                  <th style={{ width: "22%" }}>Uploaded</th>
                  <th style={{ width: "28%" }}>Status</th>
                  <th style={{ width: "10%" }}></th>
                </tr>
              </thead>
              <tbody>
                {statements.map((statement) => {
                  const parsed = statement.status === "PARSED";
                  return (
                    <tr
                      key={statement.statementId}
                      className={parsed ? "hl-stmt-row--clickable" : undefined}
                      onClick={() =>
                        parsed &&
                        navigate(`/harmony-ledger/statements/${statement.statementId}`)
                      }
                    >
                      <td>
                        <strong>{statement.fileName}</strong>
                        <p className="muted" style={{ margin: 0 }}>
                          {fileTypeLabels[statement.fileType] ?? statement.fileType}
                        </p>
                      </td>
                      <td>{sourceTypeLabels[statement.sourceType]}</td>
                      <td>
                        <p style={{ margin: 0 }}>{formatDateTime(statement.uploadedAt)}</p>
                        {statement.uploadedByName && (
                          <p className="muted" style={{ margin: 0 }}>
                            by {statement.uploadedByName}
                          </p>
                        )}
                      </td>
                      <td>
                        {isStatementProcessing(statement.status) ? (
                          <span className="pill">
                            <span className="hl-status-dot" aria-hidden="true" />
                            Parsing…
                          </span>
                        ) : statement.status === "FAILED" ? (
                          <>
                            <span
                              className="pill"
                              style={{
                                background: "rgba(248, 113, 113, 0.15)",
                                color: "#f87171"
                              }}
                            >
                              Failed
                            </span>
                            {statement.errorMessage && (
                              <p className="muted" style={{ margin: "0.3rem 0 0" }}>
                                {statement.errorMessage}
                              </p>
                            )}
                            {retryErrors[statement.statementId] && (
                              <p className="error" style={{ margin: "0.3rem 0 0" }}>
                                {retryErrors[statement.statementId]}
                              </p>
                            )}
                          </>
                        ) : (
                          <span className="muted">{countsSummary(statement)}</span>
                        )}
                      </td>
                      <td className="entry-actions">
                        <div className="hl-txn-actions">
                          {statement.status === "FAILED" && (
                            <button
                              className="ghost"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                retryMutation.mutate(statement);
                              }}
                              disabled={retryMutation.isPending}
                            >
                              Retry
                            </button>
                          )}
                          <button
                            className="ghost"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleDelete(statement);
                            }}
                            disabled={deleteMutation.isPending}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default HarmonyStatementsPage;
