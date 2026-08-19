import { stepReplay } from "@/lib/agent/session-store";

export async function POST() {
  return Response.json(stepReplay());
}
