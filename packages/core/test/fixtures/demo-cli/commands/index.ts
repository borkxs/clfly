import type { Context } from "@clfly/core";

export const meta = {
  description: "Demo CLI rooted in a commands/ tree",
};

export default async function (_opts: unknown, ctx: Context) {
  ctx.stdout.write("demo — try `demo users list` or `demo --help`\n");
}
