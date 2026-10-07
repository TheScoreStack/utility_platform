import { useState } from "react";
import { Link } from "react-router-dom";
import { ATLAS_SOLO_CIRCLE_ID, tripsByCircle, type AtlasCircle, type AtlasCircleColor } from "../types";
import { useAtlasSnapshot, useCircleMutations, usePersonMutations } from "../modules/atlas/useAtlas";
import { CIRCLE_HEX } from "../modules/atlas/lens";
import { ColorSwatches } from "./AtlasTripEditorPage";
import { useConfirm } from "../components/ConfirmDialog";

const AtlasCirclesPage = () => {
  const { data: snapshot } = useAtlasSnapshot();
  const { create, update, remove } = useCircleMutations();
  const people = usePersonMutations();
  const confirm = useConfirm();
  const [name, setName] = useState("");
  const [color, setColor] = useState<AtlasCircleColor>("rose");

  if (!snapshot) return <div className="atlas-circles skel" style={{ height: 360 }} />;
  const counts = tripsByCircle(snapshot.trips);

  return (
    <div className="atlas-circles">
      <div className="atlas-detail__top">
        <Link to="/atlas" className="atlas-link">← Map</Link>
      </div>
      <h1 className="atlas-title">Circles</h1>
      <p className="muted">
        A circle is who you travel with. Each one gets a color that follows it across the map.
      </p>

      <form
        className="atlas-card atlas-newcircle atlas-newcircle--page"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          create.mutate({ name: name.trim(), color });
          setName("");
        }}
      >
        <input value={name} maxLength={40} placeholder="New circle — Wife, Barbershop, Family…" onChange={(e) => setName(e.target.value)} />
        <ColorSwatches value={color} onChange={setColor} />
        <button type="submit" className="primary" disabled={!name.trim()}>Add circle</button>
      </form>

      <ul className="atlas-circle-list">
        {snapshot.circles.map((c) => (
          <CircleRow
            key={c.circleId}
            circle={c}
            trips={counts[c.circleId] ?? 0}
            people={snapshot.people.filter((p) => p.circleIds.includes(c.circleId))}
            onUpdate={(changes) => update.mutate({ circleId: c.circleId, ...changes })}
            onDelete={async () => {
              const ok = await confirm({
                title: `Delete ${c.name}?`,
                body: "Its trips stay on your map; they just lose this tag.",
                confirmLabel: "Delete circle",
                tone: "danger"
              });
              if (ok) remove.mutate(c.circleId);
            }}
            onAddPerson={(personName) => people.create.mutate({ name: personName, circleIds: [c.circleId] })}
            onRemovePerson={(personId) => people.remove.mutate(personId)}
          />
        ))}
      </ul>
    </div>
  );
};

const CircleRow = ({
  circle,
  trips,
  people,
  onUpdate,
  onDelete,
  onAddPerson,
  onRemovePerson
}: {
  circle: AtlasCircle;
  trips: number;
  people: { personId: string; name: string }[];
  onUpdate: (changes: Partial<AtlasCircle>) => void;
  onDelete: () => void;
  onAddPerson: (name: string) => void;
  onRemovePerson: (personId: string) => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(circle.name);
  const [person, setPerson] = useState("");
  const solo = circle.circleId === ATLAS_SOLO_CIRCLE_ID;

  return (
    <li className="atlas-card atlas-circle-row" style={{ ["--chip" as string]: CIRCLE_HEX[circle.color] }}>
      <div className="atlas-circle-row__head">
        <span className="atlas-circle-row__dot" />
        {editing ? (
          <form
            className="atlas-circle-row__rename"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) onUpdate({ name: name.trim() });
              setEditing(false);
            }}
          >
            <input autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={() => setEditing(false)} />
          </form>
        ) : (
          <button type="button" className="atlas-circle-row__name" onClick={() => setEditing(true)} title="Rename">
            {circle.name}
          </button>
        )}
        <span className="muted">{trips} trip{trips === 1 ? "" : "s"}</span>
        {!solo && (
          <button type="button" className="atlas-link atlas-link--danger" onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
      <ColorSwatches value={circle.color} onChange={(color) => onUpdate({ color })} />
      {!solo && (
        <div className="atlas-chips atlas-chips--small">
          {people.map((p) => (
            <span key={p.personId} className="atlas-chip atlas-chip--static">
              {p.name}
              <button type="button" aria-label={`Remove ${p.name}`} onClick={() => onRemovePerson(p.personId)}>✕</button>
            </span>
          ))}
          <form
            className="atlas-addperson"
            onSubmit={(e) => {
              e.preventDefault();
              if (!person.trim()) return;
              onAddPerson(person.trim());
              setPerson("");
            }}
          >
            <input value={person} maxLength={80} placeholder="+ Add a person" onChange={(e) => setPerson(e.target.value)} />
          </form>
        </div>
      )}
    </li>
  );
};

export default AtlasCirclesPage;
