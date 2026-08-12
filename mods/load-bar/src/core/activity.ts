export type NavigationToken = number;

export type TerminalOutcome = "success" | "canceled" | "network-error";

export type ActivityState =
  | { readonly kind: "idle" }
  | { readonly kind: "waiting"; readonly token: NavigationToken }
  | { readonly kind: "visible"; readonly token: NavigationToken }
  | {
      readonly kind: "completing";
      readonly token: NavigationToken;
      readonly outcome: "success";
    }
  | {
      readonly kind: "canceling";
      readonly token: NavigationToken;
      readonly outcome: Exclude<TerminalOutcome, "success">;
    };

export type ActivityEvent =
  | { readonly kind: "begin"; readonly token: NavigationToken }
  | { readonly kind: "reveal"; readonly token: NavigationToken }
  | {
      readonly kind: "finish";
      readonly token: NavigationToken;
      readonly outcome: TerminalOutcome;
    }
  | { readonly kind: "settle"; readonly token: NavigationToken };

export const IDLE_ACTIVITY = { kind: "idle" } as const satisfies ActivityState;

export const reduceActivity = (
  state: ActivityState,
  event: ActivityEvent,
): ActivityState => {
  if (event.kind === "begin") {
    return { kind: "waiting", token: event.token };
  }
  if (state.kind === "idle" || state.token !== event.token) {
    return state;
  }

  switch (event.kind) {
    case "reveal":
      return state.kind === "waiting" ? { kind: "visible", token: state.token } : state;
    case "finish":
      if (state.kind === "waiting") {
        return IDLE_ACTIVITY;
      }
      if (state.kind !== "visible") {
        return state;
      }
      return event.outcome === "success"
        ? { kind: "completing", token: state.token, outcome: event.outcome }
        : { kind: "canceling", token: state.token, outcome: event.outcome };
    case "settle":
      return state.kind === "completing" || state.kind === "canceling"
        ? IDLE_ACTIVITY
        : state;
  }
};
