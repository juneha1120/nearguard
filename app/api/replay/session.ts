import { randomUUID } from "crypto";
import { cookies } from "next/headers";

const REPLAY_SESSION_COOKIE = "nearguard_replay_session";

export function getReplaySessionId() {
  const cookieStore = cookies();
  const existingSessionId = cookieStore.get(REPLAY_SESSION_COOKIE)?.value;
  if (existingSessionId) return existingSessionId;

  const sessionId = randomUUID();
  cookieStore.set(REPLAY_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/"
  });
  return sessionId;
}
