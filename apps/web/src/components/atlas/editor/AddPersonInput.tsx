import { useState } from "react";

/** A pill-shaped "+ Add a person" field; Enter adds the name. */
export const AddPersonInput = ({ onAdd }: { onAdd: (name: string) => Promise<void> }) => {
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
      <input value={name} maxLength={80} autoCapitalize="words" enterKeyHint="done" placeholder="+ Add a person" onChange={(e) => setName(e.target.value)} />
    </form>
  );
};
