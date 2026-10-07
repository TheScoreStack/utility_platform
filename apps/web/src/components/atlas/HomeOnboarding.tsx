import clsx from "clsx";
import { useUpdateAtlasProfile } from "../../modules/atlas/useAtlas";
import { PlaceSearch } from "./PlaceSearch";

/** First run: pick home so the map never starts blank. */
export const HomeOnboarding = () => {
  const updateProfile = useUpdateAtlasProfile();
  return (
    <div className={clsx("atlas-onboard", updateProfile.isPending && "atlas-onboard--busy")}>
      <p className="atlas-onboard__title">Where’s home?</p>
      <p className="muted">We’ll start your map there. You can change it any time.</p>
      <PlaceSearch autoFocus onPick={(homePlace) => updateProfile.mutate({ homePlace })} />
    </div>
  );
};
