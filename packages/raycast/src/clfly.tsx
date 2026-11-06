import type { LaunchProps } from "@raycast/api";
import { TreeList } from "./components/TreeList";
import { TreeRoot } from "./components/TreeRoot";
import { tokenize } from "./lib/model";

/**
 * Free-text entry, meant as a Raycast fallback command: whatever is in root
 * search (`pm status --all`) runs as that clfly command. The first word names
 * the tree; with no text it opens the tree list.
 */
export default function Command(props: LaunchProps<{ arguments: { command?: string } }>) {
  const text = (props.fallbackText ?? props.arguments.command ?? "").trim();
  const [first] = tokenize(text);
  if (!first) return <TreeList />;
  return <TreeRoot name={first} typed={text.slice(text.indexOf(first) + first.length)} />;
}
