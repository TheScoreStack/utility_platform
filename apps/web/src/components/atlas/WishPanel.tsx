import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { countryName, type AtlasPlace, type AtlasSnapshot } from "../../types";
import { useWishMutations } from "../../modules/atlas/useAtlas";
import { ALL_HEX, circleHex } from "../../modules/atlas/lens";
import { circleNames } from "../../modules/atlas/format";
import { useConfirm } from "../ConfirmDialog";
import { CircleChip } from "./Controls";
import { PlaceSearch } from "./PlaceSearch";

/** "Want to go": add places, filter by circle, check them off as trips. */
export const WishPanel = ({
  snapshot,
  circleFilter,
  onFly
}: {
  snapshot: AtlasSnapshot;
  circleFilter: string;
  onFly: (place: AtlasPlace) => void;
}) => {
  const { create, remove } = useWishMutations();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [circleIds, setCircleIds] = useState<string[]>(
    circleFilter !== "all" ? [circleFilter] : []
  );
  const open = snapshot.wishes.filter(
    (w) => !w.fulfilledByTripId && (circleFilter === "all" || w.circleIds.includes(circleFilter))
  );
  const done = snapshot.wishes.filter((w) => w.fulfilledByTripId);

  return (
    <>
      <div className="atlas-panel__head">
        <h2 className="atlas-panel__title">Want to go</h2>
        <span className="muted">{open.length}</span>
      </div>
      <div className="atlas-wish-add">
        <PlaceSearch
          placeholder="Add a place to the wishlist"
          onPick={(place) => create.mutate({ place, circleIds })}
        />
        <div className="atlas-chips atlas-chips--small">
          {snapshot.circles.map((c) => (
            <CircleChip
              key={c.circleId}
              circle={c}
              active={circleIds.includes(c.circleId)}
              onClick={() =>
                setCircleIds((ids) =>
                  ids.includes(c.circleId) ? ids.filter((i) => i !== c.circleId) : [...ids, c.circleId]
                )
              }
            />
          ))}
        </div>
      </div>
      <ul className="atlas-trips">
        {open.map((w) => (
          <li key={w.wishId} className="atlas-wish">
            <button type="button" className="atlas-wish__main" onClick={() => onFly(w.place)}>
              <span className="atlas-wish__pin" style={{ borderColor: w.circleIds.length ? circleHex(snapshot.circles, w.circleIds[0]) : ALL_HEX }} />
              <span className="atlas-trip__text">
                <span className="atlas-trip__title">{w.place.name}</span>
                <span className="atlas-trip__sub">
                  {[countryName(w.place.countryCode), circleNames(snapshot, w.circleIds) && `with ${circleNames(snapshot, w.circleIds)}`]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </button>
            <div className="atlas-wish__actions">
              <button type="button" className="atlas-link" onClick={() => navigate(`/atlas/new?wish=${w.wishId}`)}>
                Went!
              </button>
              <button
                type="button"
                className="atlas-link atlas-link--quiet"
                aria-label={`Remove ${w.place.name}`}
                onClick={async () => {
                  if (await confirm({ title: `Remove ${w.place.name}?`, confirmLabel: "Remove", tone: "danger" })) {
                    remove.mutate(w.wishId);
                  }
                }}
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>
      {!open.length && <p className="muted atlas-panel__empty">Add the places you’re dreaming about.</p>}
      {done.length > 0 && (
        <p className="muted atlas-panel__foot">
          {done.length} wish{done.length > 1 ? "es" : ""} checked off
        </p>
      )}
    </>
  );
};
