import clsx from "clsx";
import { ATLAS_SOLO_CIRCLE_ID, type AtlasCircle, type AtlasPerson } from "../../../types";
import { useCircleMutations, usePersonMutations } from "../../../modules/atlas/useAtlas";
import { CIRCLE_HEX } from "../../../modules/atlas/lens";
import { AddPersonInput } from "./AddPersonInput";
import { NewCircleForm } from "./NewCircleForm";

/** Solo means "no companions", so it can't be combined with another circle. */
export const toggleCircleId = (ids: string[], id: string): string[] => {
  if (ids.includes(id)) return ids.filter((i) => i !== id);
  if (id === ATLAS_SOLO_CIRCLE_ID) return [id];
  return [...ids.filter((i) => i !== ATLAS_SOLO_CIRCLE_ID), id];
};

export const WhoStep = ({
  circles,
  people,
  circleIds,
  personIds,
  onCirclesChange,
  onPeopleChange
}: {
  circles: AtlasCircle[];
  people: AtlasPerson[];
  circleIds: string[];
  personIds: string[];
  onCirclesChange: (ids: string[]) => void;
  onPeopleChange: (ids: string[]) => void;
}) => {
  const circleMutations = useCircleMutations();
  const personMutations = usePersonMutations();

  return (
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
            onClick={() => onCirclesChange(toggleCircleId(circleIds, c.circleId))}
          >
            <span className="atlas-chip__dot" />
            {c.name}
            {circleIds.includes(c.circleId) && <span className="atlas-who__check">✓</span>}
          </button>
        ))}
        <NewCircleForm
          onCreate={async (name, color) => {
            const circle = await circleMutations.create.mutateAsync({ name, color });
            onCirclesChange(toggleCircleId(circleIds, circle.circleId));
          }}
        />
      </div>
      {circleIds.some((id) => id !== ATLAS_SOLO_CIRCLE_ID) && (
        <div className="atlas-people">
          <p className="atlas-eyebrow">Tag people (optional)</p>
          <div className="atlas-chips atlas-chips--small">
            {people.map((p) => (
              <button
                key={p.personId}
                type="button"
                className={clsx("atlas-chip", personIds.includes(p.personId) && "atlas-chip--on")}
                aria-pressed={personIds.includes(p.personId)}
                onClick={() =>
                  onPeopleChange(
                    personIds.includes(p.personId)
                      ? personIds.filter((i) => i !== p.personId)
                      : [...personIds, p.personId]
                  )
                }
              >
                {p.name}
              </button>
            ))}
            <AddPersonInput
              onAdd={async (name) => {
                const person = await personMutations.create.mutateAsync({
                  name,
                  circleIds: circleIds.filter((c) => c !== ATLAS_SOLO_CIRCLE_ID)
                });
                onPeopleChange([...personIds, person.personId]);
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
};
