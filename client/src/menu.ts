export type MenuMode = "scoutz" | "gungame";
export type MenuLadder = "classic" | "arsenal";
export type MenuGravity = "standard" | "scoutz";
export type MenuMap = "auto" | "spire" | "foundry" | "duna" | "cascade";

export interface MenuSelection {
  readonly name: string;
  readonly create: boolean;
  readonly mode: MenuMode;
  readonly ladder: MenuLadder;
  readonly gravity: MenuGravity;
  readonly map: MenuMap;
  readonly quickplay?: boolean;
}

export interface CreateRoomState {
  readonly expanded: boolean;
  readonly mode: MenuMode;
  readonly ladder: MenuLadder;
  readonly gravity: MenuGravity;
  readonly map: MenuMap;
}

export type MenuConnectionState =
  | "idle"
  | "connecting"
  | "server-restarting"
  | "version-mismatch"
  | "room-full"
  | "room-not-found";

export type CreateRoomAction =
  | { readonly type: "toggle" }
  | { readonly type: "mode"; readonly value: MenuMode }
  | { readonly type: "ladder"; readonly value: MenuLadder }
  | { readonly type: "gravity"; readonly value: MenuGravity }
  | { readonly type: "map"; readonly value: MenuMap };

export const PLAYER_NAME_STORAGE_KEY = "gg:name";
export const FRONT_DOOR_CARD_MAX_WIDTH = 420;
export const FRONT_DOOR_VIEWPORT_GUTTER = 16;

const NAME_PATTERN = /^[a-zA-Z0-9_ -]{2,16}$/;
const INVALID_NAME_CHARACTERS = /[^a-zA-Z0-9_ -]+/g;

export function filterPlayerName(value: string): string {
  return value.replace(INVALID_NAME_CHARACTERS, "").slice(0, 16);
}

export function validPlayerName(value: string): boolean {
  return NAME_PATTERN.test(value);
}

export function persistedPlayerName(storage: Pick<Storage, "getItem">): string {
  return filterPlayerName(storage.getItem(PLAYER_NAME_STORAGE_KEY) ?? "");
}

export function persistPlayerName(storage: Pick<Storage, "setItem">, value: string): string {
  const filtered = filterPlayerName(value);
  storage.setItem(PLAYER_NAME_STORAGE_KEY, filtered);
  return filtered;
}

export function frontDoorCardWidth(viewportWidth: number): number {
  return Math.min(FRONT_DOOR_CARD_MAX_WIDTH, Math.max(0, viewportWidth - FRONT_DOOR_VIEWPORT_GUTTER * 2));
}

export function defaultCreateRoomState(): CreateRoomState {
  return {
    expanded: false,
    mode: "gungame",
    ladder: "classic",
    gravity: "standard",
    map: "auto",
  };
}

export function updateCreateRoomState(
  state: CreateRoomState,
  action: CreateRoomAction,
): CreateRoomState {
  if (action.type === "toggle") return { ...state, expanded: !state.expanded };
  if (action.type === "mode") {
    return {
      ...state,
      mode: action.value,
      map: state.map === "auto" || (action.value === "scoutz" && state.map === "spire") ||
        (action.value === "gungame" && state.map !== "spire")
        ? state.map
        : "auto",
    };
  }
  if (action.type === "ladder") {
    return {
      ...state,
      ladder: action.value,
      gravity: action.value === "arsenal" ? "scoutz" : state.gravity,
    };
  }
  if (action.type === "gravity") return { ...state, gravity: action.value };
  const compatible = action.value === "auto" ||
    (state.mode === "scoutz" ? action.value === "spire" : action.value !== "spire");
  return compatible ? { ...state, map: action.value } : state;
}

export function visibleCreateRows(state: CreateRoomState): readonly string[] {
  if (!state.expanded) return [];
  return state.mode === "gungame"
    ? ["mode", "ladder", "gravity", "map"]
    : ["mode", "gravity", "map"];
}

export interface MenuController {
  readonly element: HTMLElement;
  setConnectionState(state: MenuConnectionState): void;
  destroy(): void;
}

interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

function segmentedRow<T extends string>(
  label: string,
  options: readonly SegmentOption<T>[],
  current: T,
  onChange: (value: T) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "create-row";
  const title = document.createElement("span");
  title.className = "create-row-label";
  title.textContent = label;
  const segments = document.createElement("div");
  segments.className = "segments";
  segments.setAttribute("role", "group");
  segments.setAttribute("aria-label", label);
  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "segment";
    button.dataset.value = option.value;
    button.textContent = option.label;
    button.classList.toggle("active", option.value === current);
    button.setAttribute("aria-pressed", String(option.value === current));
    button.onclick = () => onChange(option.value);
    segments.appendChild(button);
  }
  row.append(title, segments);
  return row;
}

export function showNameEntry(
  parent: HTMLElement,
  onSelection: (selection: MenuSelection) => void,
): MenuController {
  const shell = document.createElement("main");
  shell.className = "join-screen";
  shell.innerHTML = `
    <form class="join-card" novalidate>
      <div class="wordmark" aria-label="gungame online"><span>gungame</span><i></i></div>
      <input class="name-field" name="name" maxlength="16" autocomplete="nickname"
        aria-label="Your name" placeholder="your name" autofocus>
      <button class="play-button" type="submit"><span>play</span></button>
      <div class="menu-divider"></div>
      <button class="create-disclosure" type="button" aria-expanded="false">
        <span class="chevron">›</span><span>create room</span>
      </button>
      <div class="create-options" hidden></div>
      <div class="menu-message" aria-live="polite" hidden></div>
    </form>`;
  parent.appendChild(shell);

  const form = shell.querySelector<HTMLFormElement>("form")!;
  const input = form.elements.namedItem("name") as HTMLInputElement;
  const play = shell.querySelector<HTMLButtonElement>(".play-button")!;
  const disclosure = shell.querySelector<HTMLButtonElement>(".create-disclosure")!;
  const options = shell.querySelector<HTMLElement>(".create-options")!;
  const message = shell.querySelector<HTMLElement>(".menu-message")!;
  let createState = defaultCreateRoomState();
  let connectionState: MenuConnectionState = "idle";

  input.value = persistedPlayerName(localStorage);

  const syncPlay = (): void => {
    const valid = validPlayerName(input.value);
    play.disabled = !valid || connectionState === "connecting";
  };

  const renderCreateOptions = (): void => {
    options.replaceChildren();
    options.hidden = !createState.expanded;
    disclosure.setAttribute("aria-expanded", String(createState.expanded));
    disclosure.querySelector(".chevron")!.classList.toggle("expanded", createState.expanded);
    if (!createState.expanded) return;
    const update = (action: CreateRoomAction): void => {
      createState = updateCreateRoomState(createState, action);
      renderCreateOptions();
    };
    options.appendChild(segmentedRow("mode", [
      { value: "gungame", label: "gun game" },
      { value: "scoutz", label: "scoutz" },
    ], createState.mode, (value) => update({ type: "mode", value })));
    if (createState.mode === "gungame") {
      options.appendChild(segmentedRow("ladder", [
        { value: "classic", label: "classic" },
        { value: "arsenal", label: "arsenal" },
      ], createState.ladder, (value) => update({ type: "ladder", value })));
    }
    options.appendChild(segmentedRow("gravity", [
      { value: "standard", label: "standard" },
      { value: "scoutz", label: "scoutz" },
    ], createState.gravity, (value) => update({ type: "gravity", value })));
    const mapOptions: readonly SegmentOption<MenuMap>[] = createState.mode === "gungame"
      ? [
          { value: "auto", label: "auto-rotate" },
          { value: "foundry", label: "foundry" },
          { value: "duna", label: "duna" },
          { value: "cascade", label: "cascade" },
        ]
      : [
          { value: "auto", label: "auto-rotate" },
          { value: "spire", label: "spire" },
        ];
    options.appendChild(segmentedRow("map", mapOptions, createState.map, (value) => {
      update({ type: "map", value });
    }));
    const create = document.createElement("button");
    create.type = "submit";
    create.className = "create-button";
    create.dataset.action = "create";
    create.textContent = "create room";
    create.disabled = !validPlayerName(input.value) || connectionState === "connecting";
    options.appendChild(create);
  };

  const setConnectionState = (state: MenuConnectionState): void => {
    connectionState = state;
    message.hidden = state === "idle" || state === "connecting";
    message.replaceChildren();
    play.classList.toggle("connecting", state === "connecting");
    play.innerHTML = state === "connecting"
      ? `<i class="spinner" aria-hidden="true"></i><span>finding a room…</span>`
      : "<span>play</span>";
    if (state === "server-restarting") {
      message.className = "menu-message toast";
      message.textContent = "server restarting — reconnecting…";
    } else if (state === "version-mismatch") {
      message.className = "menu-message inline-prompt";
      const text = document.createElement("span");
      text.textContent = "version mismatch";
      const reload = document.createElement("button");
      reload.type = "button";
      reload.textContent = "reload";
      reload.onclick = () => location.reload();
      message.append(text, reload);
    } else if (state === "room-full") {
      message.className = "menu-message inline-prompt";
      const text = document.createElement("span");
      text.textContent = "room full — quickplay instead?";
      const quickplay = document.createElement("button");
      quickplay.type = "button";
      quickplay.textContent = "quickplay";
      quickplay.onclick = () => onSelection({
        name: input.value,
        create: false,
        mode: "gungame",
        ladder: "classic",
        gravity: "standard",
        map: "auto",
        quickplay: true,
      });
      message.append(text, quickplay);
    } else if (state === "room-not-found") {
      message.className = "menu-message inline-prompt";
      const text = document.createElement("span");
      text.textContent = "room not found";
      const quickplay = document.createElement("button");
      quickplay.type = "button";
      quickplay.textContent = "quickplay";
      quickplay.onclick = () => onSelection({
        name: input.value,
        create: false,
        mode: "gungame",
        ladder: "classic",
        gravity: "standard",
        map: "auto",
        quickplay: true,
      });
      message.append(text, quickplay);
    }
    syncPlay();
    renderCreateOptions();
  };

  input.addEventListener("input", () => {
    const filtered = filterPlayerName(input.value);
    if (input.value !== filtered) input.value = filtered;
    persistPlayerName(localStorage, filtered);
    input.setCustomValidity("");
    syncPlay();
    renderCreateOptions();
  });
  disclosure.onclick = () => {
    createState = updateCreateRoomState(createState, { type: "toggle" });
    renderCreateOptions();
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    const name = persistPlayerName(localStorage, input.value);
    if (!validPlayerName(name)) return;
    const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
    const creating = submitter?.dataset.action === "create";
    setConnectionState("connecting");
    onSelection({
      name,
      create: creating,
      mode: createState.mode,
      ladder: createState.ladder,
      gravity: createState.gravity,
      map: createState.map,
    });
  };

  renderCreateOptions();
  syncPlay();
  requestAnimationFrame(() => input.focus());
  return {
    element: shell,
    setConnectionState,
    destroy: () => shell.remove(),
  };
}

export function showMobileGate(parent: HTMLElement): HTMLElement {
  const gate = document.createElement("main");
  gate.className = "mobile-gate";
  gate.textContent = "gungame needs a mouse + keyboard. grab a computer.";
  parent.replaceChildren(gate);
  return gate;
}

export function likelyTouchOnly(
  navigatorLike: Pick<Navigator, "maxTouchPoints">,
  coarsePointer: boolean,
): boolean {
  return coarsePointer && navigatorLike.maxTouchPoints > 0;
}
