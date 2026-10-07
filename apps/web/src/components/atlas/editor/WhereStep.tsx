import type { AtlasStop } from "../../../types";
import { PlaceSearch } from "../PlaceSearch";
import { move, newId, placeContext, stopPicks, type PickSources } from "./editorUtils";

export const WhereStep = ({
  stops,
  sources,
  onChange
}: {
  stops: AtlasStop[];
  sources: PickSources;
  onChange: (stops: AtlasStop[]) => void;
}) => (
  <section className="atlas-step">
    <h1 className="atlas-step__q">Where did you go?</h1>
    <PlaceSearch
      autoFocus
      quickPicks={stopPicks(sources, stops)}
      onPick={(place) => {
        if (stops.some((x) => x.place.providerId === place.providerId)) return;
        onChange([...stops, { stopId: newId("stop"), place }]);
      }}
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
            <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => onChange(move(stops, i, -1))}>↑</button>
            <button type="button" aria-label="Move down" disabled={i === stops.length - 1} onClick={() => onChange(move(stops, i, 1))}>↓</button>
            <button type="button" aria-label={`Remove ${s.place.name}`} onClick={() => onChange(stops.filter((x) => x.stopId !== s.stopId))}>✕</button>
          </span>
        </li>
      ))}
    </ol>
    {!stops.length && <p className="muted">Add each city, state or country you visited, in order.</p>}
  </section>
);
