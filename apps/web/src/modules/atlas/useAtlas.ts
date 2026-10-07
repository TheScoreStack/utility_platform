import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type {
  AtlasCircle,
  AtlasDraftTrip,
  AtlasLeg,
  AtlasPerson,
  AtlasPlace,
  AtlasPlaceSuggestion,
  AtlasProfile,
  AtlasSnapshot,
  AtlasTrip,
  AtlasWish
} from "../../types";

export const ATLAS_KEY = ["atlas", "snapshot"] as const;

/**
 * The whole atlas in one payload. Lenses filter it in memory, so switching
 * one never touches the network. Cover urls are signed for 6 h; refetching
 * after 30 min keeps them fresh.
 */
export const useAtlasSnapshot = () =>
  useQuery({
    queryKey: ATLAS_KEY,
    queryFn: () => api.get<AtlasSnapshot>("/atlas/snapshot"),
    staleTime: 30 * 60 * 1000
  });

export type TripInput = Partial<
  Omit<
    AtlasTrip,
    | "tripId"
    | "createdAt"
    | "updatedAt"
    | "datePrecision"
    | "coverUrl"
    | "stops"
    | "legs"
    | "title"
    | "start"
    | "end"
    | "rating"
    | "notes"
    | "coverKey"
  >
> & {
  /** New stops and legs may omit their ids; the API assigns them. */
  stops?: Array<{ stopId?: string; place: AtlasPlace }>;
  legs?: Array<Omit<AtlasLeg, "legId"> & { legId?: string }>;
  title: string;
  start: string;
  end?: string | null;
  rating?: number | null;
  notes?: string | null;
  coverKey?: string | null;
};

/** Applies a change to the cached snapshot; returns a rollback. */
const useSnapshotPatch = () => {
  const client = useQueryClient();
  return (patch: (snapshot: AtlasSnapshot) => AtlasSnapshot) => {
    const previous = client.getQueryData<AtlasSnapshot>(ATLAS_KEY);
    if (previous) client.setQueryData(ATLAS_KEY, patch(previous));
    return () => previous && client.setQueryData(ATLAS_KEY, previous);
  };
};

const upsert = <T, K extends keyof T>(list: T[], item: T, key: K): T[] =>
  list.some((x) => x[key] === item[key])
    ? list.map((x) => (x[key] === item[key] ? item : x))
    : [item, ...list];

export const useSaveTrip = () => {
  const patch = useSnapshotPatch();
  return useMutation({
    mutationFn: ({ tripId, input }: { tripId?: string; input: TripInput }) =>
      tripId
        ? api.patch<AtlasTrip>(`/atlas/trips/${encodeURIComponent(tripId)}`, input)
        : api.post<AtlasTrip>("/atlas/trips", input),
    onSuccess: (trip) => {
      patch((s) => ({
        ...s,
        trips: upsert(s.trips, trip, "tripId").sort(
          (a, b) => b.start.localeCompare(a.start) || a.title.localeCompare(b.title)
        )
      }));
    }
  });
};

export const useDeleteTrip = () => {
  const patch = useSnapshotPatch();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (tripId: string) => api.delete(`/atlas/trips/${encodeURIComponent(tripId)}`),
    onMutate: (tripId) =>
      patch((s) => ({
        ...s,
        trips: s.trips.filter((t) => t.tripId !== tripId),
        wishes: s.wishes.map((w) =>
          w.fulfilledByTripId === tripId ? { ...w, fulfilledByTripId: undefined } : w
        )
      })),
    onError: (_e, _id, rollback) => rollback?.(),
    onSettled: () => client.invalidateQueries({ queryKey: ATLAS_KEY })
  });
};

export const useCircleMutations = () => {
  const patch = useSnapshotPatch();
  const client = useQueryClient();
  const settle = () => client.invalidateQueries({ queryKey: ATLAS_KEY });
  return {
    create: useMutation({
      mutationFn: (input: Pick<AtlasCircle, "name" | "color">) =>
        api.post<AtlasCircle>("/atlas/circles", input),
      onSuccess: (circle) =>
        patch((s) => ({
          ...s,
          circles: [...s.circles, circle].sort((a, b) => a.sortOrder - b.sortOrder)
        }))
    }),
    update: useMutation({
      mutationFn: ({ circleId, ...input }: Partial<AtlasCircle> & { circleId: string }) =>
        api.patch<AtlasCircle>(`/atlas/circles/${encodeURIComponent(circleId)}`, input),
      onMutate: (input) =>
        patch((s) => ({
          ...s,
          circles: s.circles.map((c) => (c.circleId === input.circleId ? { ...c, ...input } : c))
        })),
      onError: (_e, _v, rollback) => rollback?.(),
      onSettled: settle
    }),
    remove: useMutation({
      mutationFn: (circleId: string) =>
        api.delete(`/atlas/circles/${encodeURIComponent(circleId)}`),
      onMutate: (circleId) =>
        patch((s) => ({
          ...s,
          circles: s.circles.filter((c) => c.circleId !== circleId),
          trips: s.trips.map((t) => ({
            ...t,
            circleIds: t.circleIds.filter((c) => c !== circleId)
          }))
        })),
      onError: (_e, _v, rollback) => rollback?.(),
      onSettled: settle
    })
  };
};

export const usePersonMutations = () => {
  const patch = useSnapshotPatch();
  const client = useQueryClient();
  const settle = () => client.invalidateQueries({ queryKey: ATLAS_KEY });
  return {
    create: useMutation({
      mutationFn: (input: Pick<AtlasPerson, "name" | "circleIds">) =>
        api.post<AtlasPerson>("/atlas/people", input),
      onSuccess: (person) => patch((s) => ({ ...s, people: [...s.people, person] }))
    }),
    update: useMutation({
      mutationFn: ({ personId, ...input }: Partial<AtlasPerson> & { personId: string }) =>
        api.patch<AtlasPerson>(`/atlas/people/${encodeURIComponent(personId)}`, input),
      onSuccess: (person) =>
        patch((s) => ({ ...s, people: upsert(s.people, person, "personId") }))
    }),
    remove: useMutation({
      mutationFn: (personId: string) =>
        api.delete(`/atlas/people/${encodeURIComponent(personId)}`),
      onMutate: (personId) =>
        patch((s) => ({ ...s, people: s.people.filter((p) => p.personId !== personId) })),
      onError: (_e, _v, rollback) => rollback?.(),
      onSettled: settle
    })
  };
};

export const useWishMutations = () => {
  const patch = useSnapshotPatch();
  const client = useQueryClient();
  return {
    create: useMutation({
      mutationFn: (input: { place: AtlasPlace; circleIds: string[]; note?: string }) =>
        api.post<AtlasWish>("/atlas/wishes", input),
      onSuccess: (wish) => patch((s) => ({ ...s, wishes: [wish, ...s.wishes] }))
    }),
    update: useMutation({
      mutationFn: ({ wishId, ...input }: { wishId: string; fulfilledByTripId?: string | null; note?: string | null; circleIds?: string[] }) =>
        api.patch<AtlasWish>(`/atlas/wishes/${encodeURIComponent(wishId)}`, input),
      onSuccess: (wish) => patch((s) => ({ ...s, wishes: upsert(s.wishes, wish, "wishId") }))
    }),
    remove: useMutation({
      mutationFn: (wishId: string) => api.delete(`/atlas/wishes/${encodeURIComponent(wishId)}`),
      onMutate: (wishId) =>
        patch((s) => ({ ...s, wishes: s.wishes.filter((w) => w.wishId !== wishId) })),
      onError: (_e, _v, rollback) => rollback?.(),
      onSettled: () => client.invalidateQueries({ queryKey: ATLAS_KEY })
    })
  };
};

export const useUpdateAtlasProfile = () => {
  const patch = useSnapshotPatch();
  return useMutation({
    mutationFn: (input: { homePlace?: AtlasPlace | null; units?: "mi" | "km" }) =>
      api.patch<{ profile: AtlasProfile }>("/atlas/profile", input),
    onSuccess: ({ profile }) => patch((s) => ({ ...s, profile }))
  });
};

export const searchPlaces = (q: string) =>
  api.get<{ results: AtlasPlaceSuggestion[] }>(
    `/atlas/places/search?q=${encodeURIComponent(q)}`
  );

export const resolveSuggestion = async (s: AtlasPlaceSuggestion): Promise<AtlasPlace> =>
  s.place ??
  (await api.get<{ place: AtlasPlace }>(`/atlas/places/${encodeURIComponent(s.providerId)}`))
    .place;

export const quickAdd = (text: string) =>
  api.post<{ drafts: AtlasDraftTrip[] }>("/atlas/quick-add", { text });

/** Uploads a cover image straight to S3; returns the key to save on the trip. */
export const uploadCover = async (file: File): Promise<string> => {
  const contentType = file.type || "image/jpeg";
  const { coverKey, uploadUrl } = await api.post<{ coverKey: string; uploadUrl: string }>(
    "/atlas/photos/upload-url",
    { fileName: file.name, contentType }
  );
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: file
  });
  if (!response.ok) throw new Error("Cover upload failed");
  return coverKey;
};
