import { useState } from "react";
import type { AtlasLeg, AtlasLegMode, AtlasPlace, AtlasStop } from "../../../types";
import { Segmented } from "../Controls";
import { PlaceSearch, type QuickPick } from "../PlaceSearch";
import { legEndLabel, legEndPicks, move, newId, returnLegFor, type PickSources } from "./editorUtils";

export const LEG_MODES: { value: AtlasLegMode; label: string }[] = [
  { value: "flight", label: "Flight" },
  { value: "drive", label: "Drive" },
  { value: "train", label: "Train" },
  { value: "boat", label: "Boat" },
  { value: "other", label: "Other" }
];

export const LegsEditor = ({
  legs,
  stops,
  sources,
  onChange
}: {
  legs: AtlasLeg[];
  stops: AtlasStop[];
  sources: PickSources;
  onChange: (legs: AtlasLeg[]) => void;
}) => {
  const [mode, setMode] = useState<AtlasLegMode>("flight");
  const [from, setFrom] = useState<AtlasPlace | null>(null);
  const [to, setTo] = useState<AtlasPlace | null>(null);
  const [airline, setAirline] = useState("");
  const flight = mode === "flight";
  const returnLeg = returnLegFor(legs);
  // The add form is heavy; once a trip has legs it folds behind a button.
  const [adding, setAdding] = useState(legs.length === 0);
  const modeWord = (m: AtlasLegMode) => LEG_MODES.find((x) => x.value === m)?.label.toLowerCase();

  // A leg is added as soon as both ends are picked, so it can't be lost by
  // forgetting a button. A return leg is the usual next step, so the next
  // one starts where this one ended.
  const pickTo = (place: AtlasPlace | null) => {
    if (!place || !from) {
      setTo(place);
      return;
    }
    onChange([
      ...legs,
      { legId: newId("leg"), mode, from, to: place, airline: flight && airline.trim() ? airline.trim() : undefined }
    ]);
    setFrom(place);
    setTo(null);
    setAdding(false);
  };

  return (
    <div className="atlas-legs">
      {legs.map((l, i) => (
        <div key={l.legId} className="atlas-leg">
          <span className="atlas-leg__mode">{LEG_MODES.find((m) => m.value === l.mode)?.label}</span>
          <span className="atlas-leg__route">
            {legEndLabel(l.from)} → {legEndLabel(l.to)}
            {l.airline && <span className="muted"> · {l.airline}</span>}
          </span>
          <span className="atlas-stop__actions">
            <button type="button" aria-label="Move leg up" disabled={i === 0} onClick={() => onChange(move(legs, i, -1))}>↑</button>
            <button type="button" aria-label="Move leg down" disabled={i === legs.length - 1} onClick={() => onChange(move(legs, i, 1))}>↓</button>
            <button type="button" aria-label="Remove leg" onClick={() => onChange(legs.filter((x) => x.legId !== l.legId))}>✕</button>
          </span>
        </div>
      ))}
      {returnLeg && (
        <button
          type="button"
          className="atlas-return"
          onClick={() => {
            onChange([...legs, { legId: newId("leg"), ...returnLeg }]);
            setFrom(null);
          }}
        >
          <span aria-hidden="true">⇄</span> Add return {modeWord(returnLeg.mode)}
          <span className="muted">
            {legEndLabel(returnLeg.from)} → {legEndLabel(returnLeg.to)}
          </span>
        </button>
      )}
      {!adding && (
        <button type="button" className="atlas-add-leg" onClick={() => setAdding(true)}>
          + Add a flight or drive
        </button>
      )}
      {adding && (
      <div className="atlas-leg-form">
        <Segmented<AtlasLegMode> label="How" value={mode} options={LEG_MODES} onChange={setMode} />
        {flight && (
          <input className="atlas-leg-form__airline" value={airline} maxLength={80} autoCapitalize="words" autoCorrect="off" spellCheck={false} placeholder="Airline (optional)" onChange={(e) => setAirline(e.target.value)} />
        )}
        <div className="atlas-leg-form__ends">
          <LegEnd label="From" value={from} onChange={setFrom} airports={flight} picks={legEndPicks(sources, mode, stops, to)} />
          <LegEnd label="To" value={to} onChange={pickTo} airports={flight} picks={legEndPicks(sources, mode, stops, from)} />
        </div>
        {legs.length > 0 && (
          <button type="button" className="atlas-link atlas-leg-form__close" onClick={() => setAdding(false)}>
            Done adding
          </button>
        )}
      </div>
      )}
    </div>
  );
};

const LegEnd = ({
  label,
  value,
  onChange,
  airports,
  picks
}: {
  label: string;
  value: AtlasPlace | null;
  onChange: (p: AtlasPlace | null) => void;
  airports: boolean;
  picks: QuickPick[];
}) => (
  <div className="atlas-leg-end">
    <span className="atlas-eyebrow">{label}</span>
    {value ? (
      <button type="button" className="atlas-chip atlas-chip--on" onClick={() => onChange(null)}>
        {value.iata ?? value.name} ✕
      </button>
    ) : (
      <PlaceSearch
        airportsOnly={airports}
        placeholder={airports ? "Airport or code" : "Place"}
        quickPicks={picks}
        onPick={onChange}
      />
    )}
  </div>
);
