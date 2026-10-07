import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { countryName, formatTripDates, type AtlasDraftTrip } from "../types";
import { quickAdd, useAtlasSnapshot, useSaveTrip } from "../modules/atlas/useAtlas";
import { CIRCLE_HEX } from "../modules/atlas/lens";

const EXAMPLE = `Lisbon and Porto 2019, by myself
Napa with my wife, June 2025
Nashville with the barbershop guys, April 2025
Cabo 2024 with the shop`;

const AtlasQuickAddPage = () => {
  const { data: snapshot } = useAtlasSnapshot();
  const saveTrip = useSaveTrip();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<(AtlasDraftTrip & { keep: boolean })[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(0);

  const parse = async () => {
    setBusy(true);
    setError(null);
    try {
      const { drafts } = await quickAdd(text);
      setDrafts(drafts.map((d) => ({ ...d, keep: d.places.length > 0 && Boolean(d.start) })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read those lines");
    } finally {
      setBusy(false);
    }
  };

  const saveAll = async () => {
    if (!drafts) return;
    setBusy(true);
    setError(null);
    let count = 0;
    try {
      for (const d of drafts.filter((d) => d.keep && d.places.length && d.start)) {
        await saveTrip.mutateAsync({
          input: {
            title: d.title,
            start: d.start!,
            circleIds: d.circleIds,
            stops: d.places.map((place) => ({ place })),
            legs: []
          }
        });
        count += 1;
        setSaved(count);
      }
      navigate("/atlas");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Some trips didn't save");
    } finally {
      setBusy(false);
    }
  };

  const circleById = (id: string) => snapshot?.circles.find((c) => c.circleId === id);
  const keepCount = drafts?.filter((d) => d.keep && d.places.length && d.start).length ?? 0;

  return (
    <div className="atlas-quick">
      <div className="atlas-detail__top">
        <Link to="/atlas" className="atlas-link">← Map</Link>
      </div>
      <h1 className="atlas-title">Quick add</h1>
      <p className="muted">
        One trip per line: where, roughly when, and who with. You’ll review everything before it’s saved.
      </p>

      {!drafts && (
        <>
          <textarea
            className="atlas-quick__input"
            rows={8}
            maxLength={4000}
            value={text}
            placeholder={EXAMPLE}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="atlas-editor__nav">
            <button type="button" className="secondary" onClick={() => setText(EXAMPLE)} disabled={busy}>
              Try the example
            </button>
            <span className="atlas-editor__spacer" />
            <button type="button" className="primary" onClick={parse} disabled={busy || !text.trim()}>
              {busy ? "Reading…" : "Read my trips"}
            </button>
          </div>
        </>
      )}

      {drafts && (
        <>
          <ul className="atlas-drafts">
            {drafts.map((d, i) => {
              const usable = d.places.length > 0 && Boolean(d.start);
              return (
                <li key={i} className={clsx("atlas-card atlas-draft", !d.keep && "atlas-draft--off")}>
                  <label className="atlas-draft__check">
                    <input
                      type="checkbox"
                      checked={d.keep && usable}
                      disabled={!usable}
                      onChange={(e) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))}
                    />
                  </label>
                  <div className="atlas-draft__body">
                    <input
                      className="atlas-draft__title"
                      value={d.title}
                      onChange={(e) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                    />
                    <p className="atlas-draft__line muted">“{d.line}”</p>
                    <p className="atlas-draft__meta">
                      {d.start ? formatTripDates({ start: d.start, datePrecision: d.datePrecision ?? "year" }) : <span className="atlas-error">No year: add one to the line and read again</span>}
                      {d.circleIds.map((id) => {
                        const c = circleById(id);
                        return c ? (
                          <span key={id} className="atlas-chip atlas-chip--on atlas-chip--static" style={{ ["--chip" as string]: CIRCLE_HEX[c.color] }}>
                            <span className="atlas-chip__dot" />
                            {c.name}
                          </span>
                        ) : null;
                      })}
                    </p>
                    <p className="atlas-draft__places">
                      {d.places.map((p) => (
                        <span key={p.providerId}>
                          {p.name}
                          <span className="muted">, {countryName(p.countryCode)}</span>
                        </span>
                      ))}
                      {d.unresolved.map((u) => (
                        <span key={u} className="atlas-error">Couldn’t find “{u}”</span>
                      ))}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="atlas-editor__nav">
            <button type="button" className="secondary" onClick={() => setDrafts(null)} disabled={busy}>
              Edit lines
            </button>
            <span className="atlas-editor__spacer" />
            <button type="button" className="primary" onClick={saveAll} disabled={busy || !keepCount}>
              {busy ? `Saving ${saved} of ${keepCount}…` : `Save ${keepCount} trip${keepCount === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}
      {error && <p className="atlas-error" role="alert">{error}</p>}
    </div>
  );
};

export default AtlasQuickAddPage;
