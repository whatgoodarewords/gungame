export interface MenuSelection {
  readonly name: string;
  readonly create: boolean;
  readonly mode: "scoutz" | "gungame";
  readonly ladder: "classic" | "arsenal";
  readonly gravity: "standard" | "scoutz";
}

const NAME_PATTERN = /^[a-zA-Z0-9_ -]{2,16}$/;

export function validPlayerName(value: string): boolean {
  return NAME_PATTERN.test(value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ""));
}

export function showNameEntry(parent: HTMLElement, onSelection: (selection: MenuSelection) => void): void {
  const shell = document.createElement("main");
  shell.className = "join-screen";
  shell.innerHTML = `
    <form class="join-card">
      <h1>GUNGAME</h1>
      <p>Choose a name, then quickplay or create a room.</p>
      <label>Name<input name="name" minlength="2" maxlength="16" pattern="[a-zA-Z0-9_ -]+" autocomplete="nickname" autofocus></label>
      <div class="create-options" hidden>
        <label>Mode<select name="mode"><option value="gungame">Gun Game</option><option value="scoutz">Scoutzknivez</option></select></label>
        <label class="gun-option">Ladder<select name="ladder"><option value="classic">CLASSIC</option><option value="arsenal">ARSENAL</option></select></label>
        <label class="gun-option">Gravity<select name="gravity"><option value="standard">Standard</option><option value="scoutz">Scoutz</option></select></label>
      </div>
      <div class="menu-actions"><button type="submit" name="action" value="play">Play</button><button type="button" class="create-toggle">Create room</button></div>
      <small>Dev: ?mode=scoutz|gungame&amp;ladder=classic|arsenal&amp;gravity=standard|scoutz</small>
    </form>`;
  parent.appendChild(shell);
  const form = shell.querySelector<HTMLFormElement>("form")!;
  const input = form.elements.namedItem("name") as HTMLInputElement;
  const mode = form.elements.namedItem("mode") as HTMLSelectElement;
  const ladder = form.elements.namedItem("ladder") as HTMLSelectElement;
  const gravity = form.elements.namedItem("gravity") as HTMLSelectElement;
  const options = shell.querySelector<HTMLElement>(".create-options")!;
  const toggle = shell.querySelector<HTMLButtonElement>(".create-toggle")!;
  let creating = false;
  toggle.onclick = () => {
    creating = !creating;
    options.hidden = !creating;
    toggle.textContent = creating ? "Create and play" : "Create room";
    toggle.type = creating ? "submit" : "button";
  };
  mode.onchange = () => {
    for (const element of shell.querySelectorAll<HTMLElement>(".gun-option")) {
      element.hidden = mode.value === "scoutz";
    }
  };
  ladder.onchange = () => {
    if (ladder.value === "arsenal") gravity.value = "scoutz";
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    const name = input.value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
    if (!validPlayerName(name)) {
      input.setCustomValidity("Use 2–16 letters, numbers, spaces, _ or -");
      input.reportValidity();
      return;
    }
    onSelection({
      name,
      create: creating,
      mode: mode.value === "scoutz" ? "scoutz" : "gungame",
      ladder: ladder.value === "arsenal" ? "arsenal" : "classic",
      gravity: gravity.value === "scoutz" ? "scoutz" : "standard",
    });
  };
}
