import { useCachedPromise } from "@raycast/utils";
import { fetchTrees } from "../lib/exec";

/** Cached across launches, so lists open instantly and refresh behind. */
export function useTrees() {
  return useCachedPromise(fetchTrees, [], { keepPreviousData: true });
}
