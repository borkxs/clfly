import type { LaunchProps } from "@raycast/api";
import { LineEditor } from "./components/LineEditor";

/**
 * The line editor. Give it a hotkey, and enable it as a Raycast fallback
 * command so text typed in root search (`pm search dune`) carries over.
 */
export default function Command(props: LaunchProps<{ arguments: { command?: string } }>) {
  const text = (props.fallbackText ?? props.arguments.command ?? "").trim();
  return <LineEditor initial={text ? `${text} ` : ""} />;
}
