import { useState } from "react";
import type { AtlasCircleColor } from "../../../types";
import { ColorSwatches } from "../Controls";

/** Inline "+ New circle" that expands into a name field and color swatches. */
export const NewCircleForm = ({ onCreate }: { onCreate: (name: string, color: AtlasCircleColor) => Promise<void> }) => {
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
      <input autoFocus value={name} maxLength={40} autoCapitalize="words" enterKeyHint="done" placeholder="Wife, Barbershop, College friends…" onChange={(e) => setName(e.target.value)} />
      <ColorSwatches value={color} onChange={setColor} />
      <button type="submit" className="primary" disabled={busy || !name.trim()}>Add</button>
    </form>
  );
};
