import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { formatTripDates, type AtlasLeg, type AtlasStop, type AtlasTrip } from "../types";
import {
  useAtlasSnapshot,
  useSaveTrip,
  useWishMutations,
  type TripInput
} from "../modules/atlas/useAtlas";
import { useAtlasGeo } from "../modules/atlas/geo";
import { CIRCLE_HEX } from "../modules/atlas/lens";
import { WorldMap, type WorldMapHandle } from "../components/atlas/WorldMap";
import { StepIndicator } from "../components/atlas/StepIndicator";
import { STEPS, newId, suggestTitle, type PickSources, type Precision } from "../components/atlas/editor/editorUtils";
import { WhereStep } from "../components/atlas/editor/WhereStep";
import { WhenStep } from "../components/atlas/editor/WhenStep";
import { WhoStep } from "../components/atlas/editor/WhoStep";
import { DetailsStep, type CoverState } from "../components/atlas/editor/DetailsStep";

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
  const [cover, setCover] = useState<CoverState>({
    key: trip?.coverKey,
    preview: trip?.coverUrl,
    uploading: false
  });
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

  const hasPlaces = stops.length > 0 || legs.length > 0;
  const sources: PickSources = {
    otherTrips: snapshot.trips.filter((t) => t.tripId !== trip?.tripId),
    home: snapshot.profile.homePlace
  };
  const startValid = /^\d{4}(-\d{2}(-\d{2})?)?$/.test(start);
  const canSave = hasPlaces && startValid && title.trim().length > 0;
  const uploading = cover.uploading;

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
      coverKey: cover.key ?? null
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
          <StepIndicator
            steps={STEPS}
            current={step}
            // Later steps need a place to hang off, same rule as Next.
            isLocked={(i) => i > 0 && !hasPlaces}
            isComplete={(i) => [hasPlaces, startValid, circleIds.length > 0, false][i]}
            onSelect={setStep}
          />
        </div>

        {step === 0 && <WhereStep stops={stops} sources={sources} onChange={setStops} />}
        {step === 1 && (
          <WhenStep
            precision={precision}
            start={start}
            end={end}
            onChange={(c) => {
              if (c.precision) setPrecision(c.precision);
              if (c.start !== undefined) setStart(c.start);
              if (c.end !== undefined) setEnd(c.end);
            }}
          />
        )}
        {step === 2 && (
          <WhoStep
            circles={circles}
            people={snapshot.people}
            circleIds={circleIds}
            personIds={personIds}
            onCirclesChange={setCircleIds}
            onPeopleChange={setPersonIds}
          />
        )}
        {step === 3 && (
          <DetailsStep
            title={title}
            onTitleChange={(t) => {
              setTitle(t);
              setTitleTouched(true);
            }}
            legs={legs}
            stops={stops}
            sources={sources}
            onLegsChange={setLegs}
            cover={cover}
            onCoverChange={setCover}
            originalCoverUrl={trip?.coverUrl}
            rating={rating}
            onRatingChange={setRating}
            notes={notes}
            onNotesChange={setNotes}
            onError={setError}
          />
        )}

        {error && <p className="atlas-error" role="alert">{error}</p>}

        <div className="atlas-editor__nav">
          {step > 0 && (
            <button type="button" className="secondary" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <span className="atlas-editor__spacer" />
          {/* Say why Save is off instead of leaving it mysteriously grey. */}
          {step === STEPS.length - 1 && hasPlaces && !startValid && (
            <button type="button" className="atlas-link" onClick={() => setStep(1)}>
              Add when it was to save
            </button>
          )}
          {step < STEPS.length - 1 && canSave && (
            <button type="button" className="secondary" onClick={() => void save()} disabled={saveTrip.isPending || uploading}>
              {trip ? "Save changes" : "Save now"}
            </button>
          )}
          <button
            type="button"
            className="primary"
            onClick={next}
            disabled={(step === 0 && !hasPlaces) || (step === 1 && !startValid) || (step === STEPS.length - 1 && (!canSave || uploading)) || saveTrip.isPending}
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

export default AtlasTripEditorPage;
