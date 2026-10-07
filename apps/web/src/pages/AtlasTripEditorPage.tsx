import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import clsx from "clsx";
import {
  ATLAS_CIRCLE_COLORS,
  ATLAS_SOLO_CIRCLE_ID,
  countryName,
  formatTripDates,
  type AtlasCircleColor,
  type AtlasLeg,
  type AtlasLegMode,
  type AtlasPlace,
  type AtlasStop,
  type AtlasTrip
} from "../types";
import {
  uploadCover,
  useAtlasSnapshot,
  useCircleMutations,
  usePersonMutations,
  useSaveTrip,
  useWishMutations,
  type TripInput
} from "../modules/atlas/useAtlas";
import { useAtlasGeo } from "../modules/atlas/geo";
import { CIRCLE_HEX } from "../modules/atlas/lens";
import { WorldMap, type WorldMapHandle } from "../components/atlas/WorldMap";
import { PlaceSearch, Segmented, Stars } from "../components/atlas/AtlasParts";

type Precision = "day" | "month" | "year";
const TODAY = new Date().toISOString().slice(0, 10);
const STEPS = ["Where", "When", "Who", "Details"] as const;

const newId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

const suggestTitle = (stops: AtlasStop[]) => {
  const names = stops.map((s) => s.place.locality ?? s.place.name);
  const unique = names.filter((n, i) => names.indexOf(n) === i);
  if (!unique.length) return "";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} & ${unique[1]}`;
  return `${unique[0]}, ${unique[1]} & more`;
};

const AtlasTripEditorPage = () => {
  const { tripId } = useParams();
  const { data: snapshot } = useAtlasSnapshot();
  if (!snapshot) return <div className="atlas-editor skel" style={{ height: 420 }} />;
  const trip = tripId ? snapshot.trips.find((t) => t.tripId === tripId) : undefined;
  if (tripId && !trip) {
    return (
      <div className="atlas-empty">
        <p className="atlas-empty__title">Trip not found</p>
        <Link to="/atlas" className="atlas-link">Back to the map</Link>
      </div>
    );
  }
  return <TripEditor key={tripId ?? "new"} trip={trip} />;
};

const TripEditor = ({ trip }: { trip?: AtlasTrip }) => {
  const { data: snapshot } = useAtlasSnapshot();
  const { geo } = useAtlasGeo();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const saveTrip = useSaveTrip();
  const wishes = useWishMutations();
  const circleMutations = useCircleMutations();
  const personMutations = usePersonMutations();
  const mapRef = useRef<WorldMapHandle>(null);

  const wish = snapshot?.wishes.find((w) => w.wishId === params.get("wish"));

  const [step, setStep] = useState(0);
  const [stops, setStops] = useState<AtlasStop[]>(
    trip?.stops ?? (wish ? [{ stopId: newId("stop"), place: wish.place }] : [])
  );
  const [precision, setPrecision] = useState<Precision>(trip?.datePrecision ?? "day");
  const [start, setStart] = useState(trip?.start ?? "");
  const [end, setEnd] = useState(trip?.end ?? "");
  const [circleIds, setCircleIds] = useState<string[]>(trip?.circleIds ?? wish?.circleIds ?? []);
  const [personIds, setPersonIds] = useState<string[]>(trip?.personIds ?? []);
  const [legs, setLegs] = useState<AtlasLeg[]>(trip?.legs ?? []);
  const [title, setTitle] = useState(trip?.title ?? "");
  const [titleTouched, setTitleTouched] = useState(Boolean(trip));
  const [rating, setRating] = useState<number | undefined>(trip?.rating);
  const [notes, setNotes] = useState(trip?.notes ?? "");
  const [coverKey, setCoverKey] = useState<string | null | undefined>(trip?.coverKey);
  const [coverPreview, setCoverPreview] = useState<string | undefined>(trip?.coverUrl);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!titleTouched) setTitle(suggestTitle(stops));
  }, [stops, titleTouched]);

  const places = useMemo(
    () => [...stops.map((s) => s.place), ...legs.flatMap((l) => [l.from, l.to])],
    [stops, legs]
  );
  useEffect(() => {
    const timer = setTimeout(() => mapRef.current?.flyTo(places), 120);
    return () => clearTimeout(timer);
  }, [places]);

  const previewVisits = useMemo(() => {
    const countryVisits: Record<string, number> = {};
    const regionVisits: Record<string, number> = {};
    for (const p of places) {
      countryVisits[p.countryCode] = 1;
      if (p.regionCode) regionVisits[p.regionCode] = 1;
    }
    return { countryVisits, regionVisits };
  }, [places]);

  if (!snapshot) return null;
  const circles = snapshot.circles;
  const lensColor =
    circleIds.length && circles.find((c) => c.circleId === circleIds[0])
      ? CIRCLE_HEX[circles.find((c) => c.circleId === circleIds[0])!.color]
      : "#748ffc";

  const startValid = /^\d{4}(-\d{2}(-\d{2})?)?$/.test(start);
  const canSave = (stops.length > 0 || legs.length > 0) && startValid && title.trim().length > 0;

  const toggleCircle = (id: string) => {
    setCircleIds((ids) => {
      if (ids.includes(id)) return ids.filter((i) => i !== id);
      if (id === ATLAS_SOLO_CIRCLE_ID) return [id];
      return [...ids.filter((i) => i !== ATLAS_SOLO_CIRCLE_ID), id];
    });
  };

  const save = async () => {
    setError(null);
    const input: TripInput = {
      title: title.trim(),
      start,
      end: precision === "day" && end ? end : null,
      circleIds,
      personIds,
      stops,
      legs,
      rating: rating ?? null,
      notes: notes.trim() || null,
      coverKey: coverKey ?? null
    };
    try {
      const saved = await saveTrip.mutateAsync({ tripId: trip?.tripId, input });
      if (wish) await wishes.update.mutateAsync({ wishId: wish.wishId, fulfilledByTripId: saved.tripId });
      navigate(trip ? `/atlas/trips/${saved.tripId}` : `/atlas?celebrate=${saved.tripId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the trip");
    }
  };

  const next = () => (step < STEPS.length - 1 ? setStep(step + 1) : void save());

  return (
    <div className="atlas-editor">
      <div className="atlas-editor__main">
        <div className="atlas-editor__top">
          <Link to={trip ? `/atlas/trips/${trip.tripId}` : "/atlas"} className="atlas-link">
            ← {trip ? "Back to trip" : "Map"}
          </Link>
          <ol className="atlas-steps" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li key={s}>
                <button
                  type="button"
                  className={clsx("atlas-steps__step", i === step && "atlas-steps__step--on", i < step && "atlas-steps__step--done")}
                  aria-current={i === step ? "step" : undefined}
                  onClick={() => setStep(i)}
                >
                  <span className="atlas-steps__num">{i + 1}</span>
                  {s}
                </button>
              </li>
            ))}
          </ol>
        </div>

        {step === 0 && (
          <section className="atlas-step">
            <h1 className="atlas-step__q">Where did you go?</h1>
            <PlaceSearch
              autoFocus
              onPick={(place) =>
                setStops((s) =>
                  s.some((x) => x.place.providerId === place.providerId)
                    ? s
                    : [...s, { stopId: newId("stop"), place }]
                )
              }
            />
            <ol className="atlas-stops">
              {stops.map((s, i) => (
                <li key={s.stopId} className="atlas-stop">
                  <span className="atlas-stop__num">{i + 1}</span>
                  <span className="atlas-stop__name">
                    {s.place.name}
                    <span className="muted"> {placeContext(s.place)}</span>
                  </span>
                  <span className="atlas-stop__actions">
                    <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => setStops(move(stops, i, -1))}>↑</button>
                    <button type="button" aria-label="Move down" disabled={i === stops.length - 1} onClick={() => setStops(move(stops, i, 1))}>↓</button>
                    <button type="button" aria-label={`Remove ${s.place.name}`} onClick={() => setStops(stops.filter((x) => x.stopId !== s.stopId))}>✕</button>
                  </span>
                </li>
              ))}
            </ol>
            {!stops.length && <p className="muted">Add each city, state or country you visited, in order.</p>}
          </section>
        )}

        {step === 1 && (
          <section className="atlas-step">
            <h1 className="atlas-step__q">When was it?</h1>
            <Segmented<Precision>
              label="Date precision"
              value={precision}
              options={[
                { value: "day", label: "Exact" },
                { value: "month", label: "Month" },
                { value: "year", label: "Year" }
              ]}
              onChange={(p) => {
                setPrecision(p);
                setStart((s) => (p === "year" ? s.slice(0, 4) : p === "month" ? s.slice(0, 7) : s));
              }}
            />
            <div className="atlas-dates">
              {precision === "day" && (
                <>
                  {/* Uncontrolled: a controlled date input resets mid-typing
                      whenever the partial value is momentarily invalid. */}
                  <label className="atlas-field">
                    <span>From</span>
                    <input
                      type="date"
                      min="1900-01-01"
                      max={TODAY}
                      defaultValue={start.length === 10 ? start : undefined}
                      onChange={(e) => {
                        const value = e.target.value;
                        setStart(value);
                        if (value && (!end || end < value)) setEnd(value);
                      }}
                    />
                  </label>
                  <label className="atlas-field">
                    <span>To</span>
                    <input
                      key={start}
                      type="date"
                      min={start || "1900-01-01"}
                      max={TODAY}
                      defaultValue={end || undefined}
                      onChange={(e) => setEnd(e.target.value)}
                    />
                  </label>
                </>
              )}
              {precision === "month" && (
                <label className="atlas-field">
                  <span>Month</span>
                  <input
                    type="month"
                    min="1900-01"
                    max={TODAY.slice(0, 7)}
                    defaultValue={start.length >= 7 ? start.slice(0, 7) : undefined}
                    onChange={(e) => setStart(e.target.value)}
                  />
                </label>
              )}
              {precision === "year" && (
                <label className="atlas-field">
                  <span>Year</span>
                  <select value={start.slice(0, 4)} onChange={(e) => setStart(e.target.value)}>
                    <option value="">Pick a year</option>
                    {Array.from({ length: 70 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <p className="muted">Don’t remember the day? Month or year is fine — old trips usually are.</p>
          </section>
        )}

        {step === 2 && (
          <section className="atlas-step">
            <h1 className="atlas-step__q">Who came along?</h1>
            <div className="atlas-who">
              {circles.map((c) => (
                <button
                  key={c.circleId}
                  type="button"
                  className={clsx("atlas-who__opt", circleIds.includes(c.circleId) && "atlas-who__opt--on")}
                  style={{ ["--chip" as string]: CIRCLE_HEX[c.color] }}
                  aria-pressed={circleIds.includes(c.circleId)}
                  onClick={() => toggleCircle(c.circleId)}
                >
                  <span className="atlas-chip__dot" />
                  {c.name}
                  {circleIds.includes(c.circleId) && <span className="atlas-who__check">✓</span>}
                </button>
              ))}
              <NewCircle
                onCreate={async (name, color) => {
                  const circle = await circleMutations.create.mutateAsync({ name, color });
                  toggleCircle(circle.circleId);
                }}
              />
            </div>
            {circleIds.some((id) => id !== ATLAS_SOLO_CIRCLE_ID) && (
              <div className="atlas-people">
                <p className="atlas-eyebrow">Tag people (optional)</p>
                <div className="atlas-chips atlas-chips--small">
                  {snapshot.people.map((p) => (
                    <button
                      key={p.personId}
                      type="button"
                      className={clsx("atlas-chip", personIds.includes(p.personId) && "atlas-chip--on")}
                      aria-pressed={personIds.includes(p.personId)}
                      onClick={() =>
                        setPersonIds((ids) =>
                          ids.includes(p.personId) ? ids.filter((i) => i !== p.personId) : [...ids, p.personId]
                        )
                      }
                    >
                      {p.name}
                    </button>
                  ))}
                  <AddPerson
                    onAdd={async (name) => {
                      const person = await personMutations.create.mutateAsync({
                        name,
                        circleIds: circleIds.filter((c) => c !== ATLAS_SOLO_CIRCLE_ID)
                      });
                      setPersonIds((ids) => [...ids, person.personId]);
                    }}
                  />
                </div>
              </div>
            )}
          </section>
        )}

        {step === 3 && (
          <section className="atlas-step">
            <h1 className="atlas-step__q">The details</h1>
            <label className="atlas-field atlas-field--wide">
              <span>Trip name</span>
              <input
                value={title}
                maxLength={120}
                placeholder="Napa anniversary"
                onChange={(e) => {
                  setTitle(e.target.value);
                  setTitleTouched(true);
                }}
              />
            </label>

            <p className="atlas-eyebrow">Getting there</p>
            <LegsEditor legs={legs} stops={stops} onChange={setLegs} />

            <div className="atlas-details-row">
              <div className="atlas-cover">
                {coverPreview ? (
                  <img src={coverPreview} alt="Cover" />
                ) : (
                  <span className="muted">{uploading ? "Uploading…" : "Add a cover photo"}</span>
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  aria-label="Cover photo"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setUploading(true);
                    setCoverPreview(URL.createObjectURL(file));
                    try {
                      setCoverKey(await uploadCover(file));
                    } catch {
                      setError("Cover upload failed");
                      setCoverPreview(trip?.coverUrl);
                    } finally {
                      setUploading(false);
                    }
                  }}
                />
                {coverPreview && (
                  <button type="button" className="atlas-link atlas-cover__remove" onClick={() => { setCoverKey(null); setCoverPreview(undefined); }}>
                    Remove
                  </button>
                )}
              </div>
              <div className="atlas-field">
                <span>How was it?</span>
                <Stars value={rating} onChange={setRating} />
              </div>
            </div>

            <label className="atlas-field atlas-field--wide">
              <span>Notes</span>
              <textarea rows={3} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What do you want to remember?" />
            </label>
          </section>
        )}

        {error && <p className="atlas-error" role="alert">{error}</p>}

        <div className="atlas-editor__nav">
          {step > 0 && (
            <button type="button" className="secondary" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <span className="atlas-editor__spacer" />
          {step < STEPS.length - 1 && canSave && (
            <button type="button" className="secondary" onClick={() => void save()} disabled={saveTrip.isPending || uploading}>
              Save now
            </button>
          )}
          <button
            type="button"
            className="primary"
            onClick={next}
            disabled={(step === 0 && !stops.length && !legs.length) || (step === 1 && !startValid) || (step === STEPS.length - 1 && (!canSave || uploading)) || saveTrip.isPending}
          >
            {step < STEPS.length - 1 ? "Next" : saveTrip.isPending ? "Saving…" : trip ? "Save changes" : "Save trip"}
          </button>
        </div>
      </div>

      <aside className="atlas-editor__preview" aria-hidden="true">
        {geo && (
          <WorldMap
            ref={mapRef}
            geo={geo}
            color={lensColor}
            countryVisits={previewVisits.countryVisits}
            regionVisits={previewVisits.regionVisits}
            pins={stops.map((s) => ({ key: s.stopId, place: s.place, color: "#f8fafc" }))}
            arcs={legs.filter((l) => l.mode === "flight").map((l) => ({ key: l.legId, leg: l, color: lensColor }))}
            interactive={false}
          />
        )}
        <p className="atlas-editor__summary">
          {title || "New trip"}
          {startValid && (
            <span className="muted">
              {" · "}
              {formatTripDates({ start, end: precision === "day" ? end : undefined, datePrecision: precision })}
            </span>
          )}
        </p>
      </aside>
    </div>
  );
};

const placeContext = (p: AtlasPlace) =>
  p.kind === "country"
    ? "country"
    : p.kind === "region"
      ? "state"
      : p.countryCode === "US"
        ? p.regionName ?? "United States"
        : countryName(p.countryCode);

const move = <T,>(list: T[], i: number, by: number) => {
  const next = [...list];
  const [item] = next.splice(i, 1);
  next.splice(i + by, 0, item);
  return next;
};

const NewCircle = ({ onCreate }: { onCreate: (name: string, color: AtlasCircleColor) => Promise<void> }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<AtlasCircleColor>("rose");
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button type="button" className="atlas-who__opt atlas-who__opt--new" onClick={() => setOpen(true)}>
        + New circle
      </button>
    );
  }
  return (
    <form
      className="atlas-newcircle"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        try {
          await onCreate(name.trim(), color);
          setOpen(false);
          setName("");
        } finally {
          setBusy(false);
        }
      }}
    >
      <input autoFocus value={name} maxLength={40} placeholder="Wife, Barbershop, College friends…" onChange={(e) => setName(e.target.value)} />
      <ColorSwatches value={color} onChange={setColor} />
      <button type="submit" className="primary" disabled={busy || !name.trim()}>Add</button>
    </form>
  );
};

export const ColorSwatches = ({ value, onChange }: { value: AtlasCircleColor; onChange: (c: AtlasCircleColor) => void }) => (
  <div className="atlas-swatches" role="radiogroup" aria-label="Circle color">
    {ATLAS_CIRCLE_COLORS.map((c) => (
      <button
        key={c}
        type="button"
        role="radio"
        aria-checked={value === c}
        aria-label={c}
        className={clsx("atlas-swatch", value === c && "atlas-swatch--on")}
        style={{ background: CIRCLE_HEX[c] }}
        onClick={() => onChange(c)}
      />
    ))}
  </div>
);

const AddPerson = ({ onAdd }: { onAdd: (name: string) => Promise<void> }) => {
  const [name, setName] = useState("");
  return (
    <form
      className="atlas-addperson"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        await onAdd(name.trim());
        setName("");
      }}
    >
      <input value={name} maxLength={80} placeholder="+ Add a person" onChange={(e) => setName(e.target.value)} />
    </form>
  );
};

const LEG_MODES: { value: AtlasLegMode; label: string }[] = [
  { value: "flight", label: "Flight" },
  { value: "drive", label: "Drive" },
  { value: "train", label: "Train" },
  { value: "boat", label: "Boat" },
  { value: "other", label: "Other" }
];

const LegsEditor = ({
  legs,
  stops,
  onChange
}: {
  legs: AtlasLeg[];
  stops: AtlasStop[];
  onChange: (legs: AtlasLeg[]) => void;
}) => {
  const [mode, setMode] = useState<AtlasLegMode>("flight");
  const [from, setFrom] = useState<AtlasPlace | null>(null);
  const [to, setTo] = useState<AtlasPlace | null>(null);
  const [airline, setAirline] = useState("");
  const flight = mode === "flight";

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
  };

  return (
    <div className="atlas-legs">
      {legs.map((l) => (
        <div key={l.legId} className="atlas-leg">
          <span className="atlas-leg__mode">{LEG_MODES.find((m) => m.value === l.mode)?.label}</span>
          <span className="atlas-leg__route">
            {l.from.iata ?? l.from.name} → {l.to.iata ?? l.to.name}
            {l.airline && <span className="muted"> · {l.airline}</span>}
          </span>
          <button type="button" aria-label="Remove leg" onClick={() => onChange(legs.filter((x) => x.legId !== l.legId))}>✕</button>
        </div>
      ))}
      <div className="atlas-leg-form">
        <Segmented<AtlasLegMode> label="How" value={mode} options={LEG_MODES} onChange={setMode} />
        {flight && (
          <input className="atlas-leg-form__airline" value={airline} maxLength={80} placeholder="Airline (optional)" onChange={(e) => setAirline(e.target.value)} />
        )}
        <div className="atlas-leg-form__ends">
          <LegEnd label="From" value={from} onChange={setFrom} airports={flight} stops={stops} />
          <LegEnd label="To" value={to} onChange={pickTo} airports={flight} stops={stops} />
        </div>
      </div>
    </div>
  );
};

const LegEnd = ({
  label,
  value,
  onChange,
  airports,
  stops
}: {
  label: string;
  value: AtlasPlace | null;
  onChange: (p: AtlasPlace | null) => void;
  airports: boolean;
  stops: AtlasStop[];
}) => (
  <div className="atlas-leg-end">
    <span className="atlas-eyebrow">{label}</span>
    {value ? (
      <button type="button" className="atlas-chip atlas-chip--on" onClick={() => onChange(null)}>
        {value.iata ?? value.name} ✕
      </button>
    ) : (
      <>
        <PlaceSearch airportsOnly={airports} placeholder={airports ? "Airport or code" : "Place"} onPick={onChange} />
        {!airports && stops.length > 0 && (
          <div className="atlas-chips atlas-chips--small">
            {stops.map((s) => (
              <button key={s.stopId} type="button" className="atlas-chip" onClick={() => onChange(s.place)}>
                {s.place.name}
              </button>
            ))}
          </div>
        )}
      </>
    )}
  </div>
);

export default AtlasTripEditorPage;
