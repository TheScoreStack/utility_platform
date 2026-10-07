import type { AtlasLeg, AtlasStop } from "../../../types";
import { uploadCover } from "../../../modules/atlas/useAtlas";
import { Stars } from "../Controls";
import { LegsEditor } from "./LegsEditor";
import type { PickSources } from "./editorUtils";

export interface CoverState {
  /** Key to save on the trip; null removes the cover. */
  key: string | null | undefined;
  preview?: string;
  uploading: boolean;
}

export const DetailsStep = ({
  title,
  onTitleChange,
  legs,
  stops,
  sources,
  onLegsChange,
  cover,
  onCoverChange,
  originalCoverUrl,
  rating,
  onRatingChange,
  notes,
  onNotesChange,
  onError
}: {
  title: string;
  onTitleChange: (title: string) => void;
  legs: AtlasLeg[];
  stops: AtlasStop[];
  sources: PickSources;
  onLegsChange: (legs: AtlasLeg[]) => void;
  cover: CoverState;
  onCoverChange: (cover: CoverState) => void;
  originalCoverUrl?: string;
  rating?: number;
  onRatingChange: (rating: number | undefined) => void;
  notes: string;
  onNotesChange: (notes: string) => void;
  onError: (message: string) => void;
}) => (
  <section className="atlas-step">
    <h1 className="atlas-step__q">The details</h1>
    <label className="atlas-field atlas-field--wide">
      <span>Trip name</span>
      <input
        value={title}
        maxLength={120}
        autoCapitalize="sentences"
        enterKeyHint="done"
        placeholder="Napa anniversary"
        onChange={(e) => onTitleChange(e.target.value)}
      />
    </label>

    <div>
      <p className="atlas-eyebrow">Travel (optional)</p>
      <p className="muted atlas-hint">Each flight or drive, out and back. Flights count toward your miles.</p>
    </div>
    <LegsEditor legs={legs} stops={stops} sources={sources} onChange={onLegsChange} />

    <div className="atlas-details-row">
      <div className="atlas-cover">
        {cover.preview ? (
          <img src={cover.preview} alt="Cover" />
        ) : (
          <span className="muted">{cover.uploading ? "Uploading…" : "Add a cover photo"}</span>
        )}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"
          aria-label="Cover photo"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const preview = URL.createObjectURL(file);
            onCoverChange({ ...cover, preview, uploading: true });
            try {
              onCoverChange({ key: await uploadCover(file), preview, uploading: false });
            } catch {
              onError("Cover upload failed");
              onCoverChange({ ...cover, preview: originalCoverUrl, uploading: false });
            }
          }}
        />
        {cover.preview && (
          <button
            type="button"
            className="atlas-link atlas-cover__remove"
            onClick={() => onCoverChange({ key: null, preview: undefined, uploading: false })}
          >
            Remove
          </button>
        )}
      </div>
      <div className="atlas-field">
        <span>How was it?</span>
        <Stars value={rating} onChange={onRatingChange} />
      </div>
    </div>

    <label className="atlas-field atlas-field--wide">
      <span>Notes</span>
      <textarea
        rows={3}
        maxLength={4000}
        autoCapitalize="sentences"
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
        placeholder="What do you want to remember?"
      />
    </label>
  </section>
);
