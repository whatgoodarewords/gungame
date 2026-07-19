export const RECONNECT_ATTEMPT_STORAGE_KEY = "gg:reconnect-attempt";
export const MAX_AUTOMATIC_RECONNECTS = 3;

export interface ReconnectAttempt {
  readonly attempt: number;
  readonly countdownSeconds: number;
  readonly allowed: boolean;
}

interface StoredAttempt {
  readonly count: number;
  readonly at: number;
}

export function nextReconnectAttempt(
  storage: Pick<Storage, "getItem" | "setItem">,
  nowMs: number,
): ReconnectAttempt {
  let prior: StoredAttempt = { count: 0, at: 0 };
  try {
    prior = JSON.parse(storage.getItem(RECONNECT_ATTEMPT_STORAGE_KEY) ?? "") as StoredAttempt;
  } catch {
    // A malformed or absent record starts a new retry window.
  }
  const count = nowMs - prior.at <= 60_000 ? prior.count + 1 : 1;
  storage.setItem(RECONNECT_ATTEMPT_STORAGE_KEY, JSON.stringify({ count, at: nowMs }));
  return {
    attempt: count,
    countdownSeconds: 3,
    allowed: count <= MAX_AUTOMATIC_RECONNECTS,
  };
}

export function clearReconnectAttempts(
  storage: Pick<Storage, "removeItem">,
): void {
  storage.removeItem(RECONNECT_ATTEMPT_STORAGE_KEY);
}
