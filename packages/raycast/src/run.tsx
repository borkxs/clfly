import { Detail, type LaunchProps } from "@raycast/api";
import type { Favorite } from "./lib/favorites";
import { FavoriteTarget } from "./components/FavoriteTarget";
import { useTrees } from "./components/useTrees";

/** Deeplink / quicklink target: `context.favorite` names the command to run. */
export default function Command(props: LaunchProps<{ launchContext: { favorite?: Omit<Favorite, "id">; mode?: "run" | "form" } }>) {
  const favorite = props.launchContext?.favorite;
  const trees = useTrees();
  if (!favorite) {
    return <Detail markdown={"Nothing to run. Open this command from a quicklink made with **Create Quicklink** on a clfly command."} />;
  }
  return <FavoriteTarget favorite={favorite} trees={trees.data} mode={props.launchContext?.mode ?? "run"} isLoading={trees.isLoading} />;
}
