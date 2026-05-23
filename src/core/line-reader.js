import { createInterface } from "node:readline";

export async function* readLines(stream) {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    yield line;
  }
}
