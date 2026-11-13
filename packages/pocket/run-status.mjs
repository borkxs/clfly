// What a finished run is: done, failed, or stopped at a question (clfly core `ctx.ask` off a
// terminal exits 10 with an `input_required` result on stdout; the page asks and reruns).
export const INPUT_REQUIRED_EXIT = 10;

/** @param {{ code: number, json?: unknown }} res */
export function runStatus(res) {
  if (res.code === 0) return "done";
  if (res.code === INPUT_REQUIRED_EXIT && res.json && typeof res.json === "object" && res.json.resultType === "input_required") {
    return "input-required";
  }
  return "failed";
}
