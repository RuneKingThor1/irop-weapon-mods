/* ============================================================================
   Insurrection: Weapon Mods

   Adds a mod tray under every ranged weapon, melee weapon and armor on a
   Sandbox character sheet. Drag a mod from your inventory onto the tray to
   fit it, drag it to another tray to move it, right click it (or drag it off
   onto the sheet) to take it off. Purely a record: nothing about the weapon
   changes mechanically.

   Built against Foundry 13.351 and Sandbox System Builder 0.16.2.

   HOW IT FITS IN
   Sandbox fills its item tables in its own async rendergActorSheet hook, so
   the rows do not exist yet when ours runs. A MutationObserver on the sheet
   window redraws the trays whenever Sandbox (re)builds a table, which is
   also what keeps them there after every update.

   What is fitted where lives in one actor flag, an array of
   { w: host entry id, m: mod entry id } pairs. Mods stay ordinary carried
   items in actor.system.citems, so their weight, description and quantity
   are untouched, and Sandbox's own data is never written. Turn the module
   off and the sheet goes back to how it was, with every mod in inventory.

   A mod is anything in a group named like "Ranged Mods", "Melee Mods" or
   "Armor Mods" (or carrying the group keys in KINDS below). A fitted mod
   stays in its own table, in the Gear box's Mods section, tagged with what
   it is fitted to, so that section always shows every mod carried and the
   Capacity it takes. A world setting hides fitted mods instead.
   ========================================================================= */

const MOD = "irop-weapon-mods";
const MIME = "application/x-irop-mod";

/* ---- config ---------------------------------------------------------------
   HOSTS: the sheet tables whose rows get a tray, and what kind of mod fits.
   KINDS: how a mod is recognised, by group key or by group name.
   SLOT_ATTRIBUTE: a weapon or armor with this attribute uses its value as
   its slot count, ahead of every rule below. Not in use yet; it exists so a
   "Mod Slots" property can be added to the weapon groups later. */
const HOSTS = {
  table_weapons: "ranged",
  table_melee_weapons: "melee",
  table_armors: "armor"
};
const KINDS = {
  ranged: { label: "ranged", key: "rngd_mods", name: /\branged\b.*\bmods?\b/i },
  melee: { label: "melee", key: "melee_mods", name: /\bmelee\b.*\bmods?\b/i },
  armor: { label: "armor", key: "armr_mods", name: /\barmou?r\b.*\bmods?\b/i }
};
const SLOT_ATTRIBUTE = "mod_slots";

const OBSERVE = { childList: true, subtree: true };
const sheets = new Map();          // app -> { root, obs }
let DRAG = null;                   // the mod being dragged on this client

const log = (...m) => console.log("%c[weapon mods]", "color:#3fb8b0;font-weight:bold", ...m);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = s => String(s ?? "").toLowerCase().replace(/['\x60]|\u2019/g, "").replace(/\s+/g, " ").trim();
const setting = key => Number(game.settings.get(MOD, key)) || 0;
const countOf = e => Math.max(1, parseInt(e?.number) || 1);

/* ---- settings ---------------------------------------------------------- */
Hooks.once("init", () => {
  const redraw = () => { for (const app of sheets.keys()) decorate(app); };
  const slot = (key, name, hint, value) => game.settings.register(MOD, key, {
    name, hint, scope: "world", config: true, type: Number, default: value,
    range: { min: 0, max: 8, step: 1 }, onChange: redraw
  });
  slot("slotsRanged", "Ranged weapon slots", "Mod slots on every ranged weapon.", 3);
  slot("slotsMelee", "Melee weapon slots", "Mod slots on every melee weapon.", 2);
  slot("slotsLight", "Light armor slots", "Armor with Light in its name.", 3);
  slot("slotsMedium", "Medium armor slots", "Armor with Medium in its name.", 4);
  slot("slotsHeavy", "Heavy armor slots", "Armor with Heavy in its name.", 3);
  slot("slotsArmorOther", "Other armor slots", "Anything in the armor table whose name says none of Light, Medium or Heavy, unless it is listed under Slot overrides.", 3);
  game.settings.register(MOD, "overrides", {
    name: "Slot overrides",
    hint: "Items whose slots the rules above get wrong, separated by semicolons. Give a class (Light, Medium, Heavy) or a number. Example: Kevlar Armor = Medium; Ballistic Shield = 0",
    scope: "world", config: true, type: String, default: "Kevlar Armor = Medium", onChange: redraw
  });
  game.settings.register(MOD, "hideFitted", {
    name: "Hide fitted mods",
    hint: "Take a mod out of its Mods table while it is fitted. Off, it stays listed and tagged with what it is fitted to.",
    scope: "world", config: true, type: Boolean, default: false, onChange: redraw
  });
});

/* ---- reading the sheet's data -------------------------------------------- */
function modKind(groups) {
  for (const g of groups ?? []) {
    for (const [kind, def] of Object.entries(KINDS)) {
      if (g?.ikey === def.key || def.name.test(g?.name ?? "")) return kind;
    }
  }
  return null;
}

let overridesCache = { raw: null, map: new Map() };
function overrides() {
  const raw = String(game.settings.get(MOD, "overrides") ?? "");
  if (raw === overridesCache.raw) return overridesCache.map;
  const map = new Map();
  for (const part of raw.split(/[;\n]/)) {
    const [name, value] = part.split("=").map(s => s?.trim());
    if (name && value) map.set(norm(name), value);
  }
  overridesCache = { raw, map };
  return map;
}

const CLASS_SETTING = { light: "slotsLight", medium: "slotsMedium", heavy: "slotsHeavy" };
function slotsFor(kind, entry) {
  const own = entry?.attributes?.[SLOT_ATTRIBUTE];
  const ownRaw = own && typeof own === "object" ? own.value : own;
  if (ownRaw !== undefined && ownRaw !== null && String(ownRaw).trim() !== "" && Number.isFinite(Number(ownRaw))) {
    return Math.max(0, Math.floor(Number(ownRaw)));
  }
  const ov = overrides().get(norm(entry?.name));
  if (ov !== undefined) {
    if (CLASS_SETTING[ov.toLowerCase()]) return setting(CLASS_SETTING[ov.toLowerCase()]);
    if (Number.isFinite(Number(ov))) return Math.max(0, Math.floor(Number(ov)));
  }
  if (kind === "ranged") return setting("slotsRanged");
  if (kind === "melee") return setting("slotsMelee");
  const name = String(entry?.name ?? "");
  if (/\bheavy\b/i.test(name)) return setting("slotsHeavy");
  if (/\bmedium\b/i.test(name)) return setting("slotsMedium");
  if (/\blight\b/i.test(name)) return setting("slotsLight");
  return setting("slotsArmorOther");
}

/* Every link whose host and mod are both still carried, and no more fits of
   a mod than the character has of it. Stale links are dropped here and
   vanish from the flag on the next write. */
function readState(actor) {
  const citems = Array.isArray(actor?.system?.citems) ? actor.system.citems : [];
  const byId = new Map(citems.map(e => [e.id, e]));
  const raw = actor?.getFlag?.(MOD, "links");
  const links = [], perMod = new Map(), onHost = new Map(), hostsOf = new Map();
  for (const l of Array.isArray(raw) ? raw : []) {
    const host = byId.get(l?.w), mod = byId.get(l?.m);
    if (!host || !mod || l.w === l.m) continue;
    const n = perMod.get(l.m) ?? 0;
    if (n >= countOf(mod)) continue;
    perMod.set(l.m, n + 1);
    links.push({ w: l.w, m: l.m });
    if (!onHost.has(l.w)) onHost.set(l.w, []);
    onHost.get(l.w).push(mod);
    if (!hostsOf.has(l.m)) hostsOf.set(l.m, []);
    hostsOf.get(l.m).push(host);
  }
  return { byId, links, perMod, onHost, hostsOf };
}

function libraryItem(entry) {
  return game.items.get(entry?.ciKey) ?? game.items.get(entry?.id)
    ?? game.items.find(i => i.system?.ciKey && i.system.ciKey === entry?.ciKey) ?? null;
}

function plainText(html) {
  if (!html) return "";
  const text = new DOMParser().parseFromString(String(html), "text/html").body.textContent ?? "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 280 ? `${flat.slice(0, 277)}...` : flat;
}

/* ---- the rules ------------------------------------------------------------- */
function planFit(actor, { mod, from, to, kind }) {
  const s = readState(actor);
  const modEntry = s.byId.get(mod), host = s.byId.get(to);
  if (!modEntry || !host) return { error: "That item is no longer on this sheet." };
  const mk = modKind(modEntry.groups);
  if (!mk) return { error: `${modEntry.name} is not in a mod group.` };
  if (mk !== kind) return { error: `${modEntry.name} is a ${KINDS[mk].label} mod, so it can't go on ${host.name}.` };
  if (from === to) return { noop: true };
  const links = s.links.slice();
  let moving = false;
  if (from) {
    const i = links.findIndex(l => l.w === from && l.m === mod);
    if (i >= 0) { links.splice(i, 1); moving = true; }
  }
  if (!moving && links.filter(l => l.m === mod).length >= countOf(modEntry)) {
    return { error: countOf(modEntry) > 1
      ? `All ${countOf(modEntry)} of ${modEntry.name} are already fitted.`
      : `${modEntry.name} is already fitted. Drag it from that tray instead.` };
  }
  if (links.some(l => l.w === to && l.m === mod)) return { error: `${host.name} already has ${modEntry.name}.` };
  const slots = slotsFor(kind, host);
  if (links.filter(l => l.w === to).length >= slots) {
    return { error: slots ? `${host.name} has no free mod slots (${slots}).` : `${host.name} takes no mods.` };
  }
  links.push({ w: to, m: mod });
  return { links };
}

function planRemove(actor, { host, mod }) {
  const links = readState(actor).links;
  const i = links.findIndex(l => l.w === host && l.m === mod);
  if (i < 0) return { noop: true };
  links.splice(i, 1);
  return { links };
}

async function save(actor, plan) {
  if (plan.error) return ui.notifications.warn(plan.error);
  if (plan.noop) return;
  // render: false skips Sandbox's full sheet rebuild; the trays redraw from
  // the updateActor hook below, on every client.
  await actor.update({ [`flags.${MOD}.links`]: plan.links }, { render: false });
  redrawActor(actor);
}

/* ---- drawing ------------------------------------------------------------------ */
function buildTray(doc, { host, kind, slots, mods, editable, cols }) {
  const tr = doc.createElement("tr");
  tr.className = "irop-mods-row";
  tr.dataset.for = host.id;
  const td = doc.createElement("td");
  td.colSpan = cols;
  const tray = doc.createElement("div");
  tray.className = "irop-mods-tray";
  tray.dataset.host = host.id;
  tray.dataset.kind = kind;
  if (!editable) tray.classList.add("irop-mods-locked");

  const label = doc.createElement("span");
  label.className = "irop-mods-label";
  label.textContent = `Mods ${mods.length}/${slots}`;
  tray.append(label);

  mods.forEach((mod, i) => {
    const lib = libraryItem(mod);
    const chip = doc.createElement("div");
    chip.className = "irop-mod";
    if (i >= slots) chip.classList.add("irop-mod-over");
    chip.dataset.mod = mod.id;
    chip.draggable = editable;
    const desc = plainText(lib?.system?.description);
    chip.dataset.tooltipHtml = `<strong>${esc(mod.name)}</strong>${desc ? `<br>${esc(desc)}` : ""}`
      + (i >= slots ? "<br><em>Over the slot limit.</em>" : "")
      + (editable ? "<br><em>Right click to remove.</em>" : "");
    const img = doc.createElement("img");
    img.src = lib?.img || "icons/svg/item-bag.svg";
    img.alt = mod.name ?? "";
    img.draggable = false;
    chip.append(img);
    tray.append(chip);
  });
  for (let i = mods.length; i < slots; i++) {
    const slot = doc.createElement("div");
    slot.className = "irop-mod-slot";
    tray.append(slot);
  }
  td.append(tray);
  tr.append(td);
  return tr;
}

function decorate(app) {
  const root = app?.element?.[0] ?? app?.element;
  const actor = app?.actor;
  if (!(root instanceof HTMLElement) || !root.isConnected || !actor || actor.system?.istemplate) return;
  const s = readState(actor);
  const editable = !!app.isEditable;
  const obs = sheets.get(app)?.obs;
  obs?.disconnect();
  try {
    // trays whose weapon row has gone, or moved out from above them
    for (const tr of root.querySelectorAll("tr.irop-mods-row")) {
      if (tr.previousElementSibling?.id !== tr.dataset.for) tr.remove();
    }

    for (const [tableKey, kind] of Object.entries(HOSTS)) {
      for (const row of root.querySelectorAll(`table[data-property-key="${tableKey}"] > tbody > tr.table-row[id]`)) {
        const next = row.nextElementSibling;
        const old = next?.classList.contains("irop-mods-row") ? next : null;
        const host = s.byId.get(row.id);
        const mods = s.onHost.get(row.id) ?? [];
        const slots = host ? slotsFor(kind, host) : 0;
        if (!host || (!slots && !mods.length)) {
          old?.remove();
          row.classList.remove("irop-has-tray");
          continue;
        }
        row.classList.add("irop-has-tray");
        const sig = JSON.stringify([kind, slots, editable, mods.map(m => [m.id, m.name, libraryItem(m)?.img])]);
        if (old?.dataset.sig === sig) continue;
        const cols = [...row.cells].reduce((n, c) => n + (c.colSpan || 1), 0) || 1;
        const tr = buildTray(root.ownerDocument, { host, kind, slots, mods, editable, cols });
        tr.dataset.sig = sig;
        if (old) old.replaceWith(tr); else row.after(tr);
      }
    }

    // the mods' own tables: tagged with where they are fitted (or, with the
    // hide setting on, fitted ones step out), and armed for dragging
    const hide = !!game.settings.get(MOD, "hideFitted");
    for (const row of root.querySelectorAll("tr.table-row[id]")) {
      const entry = s.byId.get(row.id);
      if (!entry || !modKind(entry.groups)) continue;
      const fitted = s.perMod.get(row.id) ?? 0, total = countOf(entry);
      row.classList.toggle("irop-mod-fitted", hide && fitted >= total);
      row.classList.toggle("irop-mod-all-fitted", !hide && fitted >= total);
      let tag = row.querySelector(".irop-mod-count");
      const text = !fitted ? ""
        : hide ? (fitted < total ? `${fitted} fitted` : "")
        : `on ${(s.hostsOf.get(row.id) ?? []).map(h => h.name).join(", ")}`;
      if (text) {
        if (!tag) {
          tag = root.ownerDocument.createElement("span");
          tag.className = "irop-mod-count";
          (row.querySelector(".sb-two-col-card-name") ?? row.querySelector("td.tablenamecell"))?.append(tag);
        }
        tag.textContent = text;
      } else tag?.remove();
      const cell = row.querySelector("td.tablenamecell");
      if (cell && editable && !cell.classList.contains("irop-mod-source")) {
        cell.classList.add("irop-mod-source");
        cell.draggable = true;
      }
    }
  } catch (err) {
    log("could not draw the trays", err);
  } finally {
    if (obs && root.isConnected) obs.observe(root, OBSERVE);
  }
}

function redrawActor(actor) {
  for (const app of sheets.keys()) {
    if (app.actor === actor || (actor?.uuid && app.actor?.uuid === actor.uuid)) decorate(app);
  }
}

/* ---- drag and drop -------------------------------------------------------------- */
function clearMarks(root) {
  for (const t of root.querySelectorAll(".irop-drop-ok, .irop-drop-bad")) t.classList.remove("irop-drop-ok", "irop-drop-bad");
}
function mark(root, tray, ok) {
  for (const t of root.querySelectorAll(".irop-drop-ok, .irop-drop-bad")) if (t !== tray) t.classList.remove("irop-drop-ok", "irop-drop-bad");
  tray.classList.toggle("irop-drop-ok", ok);
  tray.classList.toggle("irop-drop-bad", !ok);
}
function endDrag() {
  DRAG = null;
  for (const root of document.querySelectorAll("[data-irop-drag]")) { delete root.dataset.iropDrag; clearMarks(root); }
}

function onDragStart(app, root, ev) {
  if (!app.isEditable) return;
  const chip = ev.target.closest?.(".irop-mod[data-mod]");
  const cell = chip ? null : ev.target.closest?.("td.tablenamecell.irop-mod-source");
  if (!chip && !cell) return;
  const id = chip ? chip.dataset.mod : cell.closest("tr.table-row[id]")?.id;
  const entry = readState(app.actor).byId.get(id);
  const kind = entry && modKind(entry.groups);
  if (!kind) return;
  ev.stopPropagation();
  DRAG = { actor: app.actor.uuid, mod: id, from: chip ? chip.closest(".irop-mods-tray")?.dataset.host ?? null : null, kind };
  ev.dataTransfer.setData(MIME, JSON.stringify(DRAG));
  ev.dataTransfer.effectAllowed = "move";
  const img = (chip ?? cell).querySelector("img");
  if (img) ev.dataTransfer.setDragImage(img, 12, 12);
  root.dataset.iropDrag = kind;
}

function onDragOver(app, root, ev) {
  const types = [...(ev.dataTransfer?.types ?? [])];
  const tray = ev.target.closest?.(".irop-mods-tray");
  if (types.includes(MIME)) {
    ev.preventDefault();
    ev.stopPropagation();
    if (!DRAG || DRAG.actor !== app.actor.uuid || !app.isEditable) { ev.dataTransfer.dropEffect = "none"; return; }
    if (tray) {
      const ok = !planFit(app.actor, { mod: DRAG.mod, from: DRAG.from, to: tray.dataset.host, kind: tray.dataset.kind }).error;
      mark(root, tray, ok);
      ev.dataTransfer.dropEffect = ok ? "move" : "none";
    } else {
      clearMarks(root);
      ev.dataTransfer.dropEffect = DRAG.from ? "move" : "none";   // off a tray means take it off
    }
    return;
  }
  // an item dragged in from the sidebar, straight onto a tray
  if (tray && app.isEditable && types.includes("text/plain")) {
    ev.preventDefault();
    ev.stopPropagation();
    ev.dataTransfer.dropEffect = "copy";
  }
}

function onDrop(app, root, ev) {
  const types = [...(ev.dataTransfer?.types ?? [])];
  const tray = ev.target.closest?.(".irop-mods-tray");

  if (types.includes(MIME)) {
    ev.preventDefault();
    ev.stopPropagation();
    let data;
    try { data = JSON.parse(ev.dataTransfer.getData(MIME)); } catch (e) { data = null; }
    endDrag();
    if (!data || !app.isEditable) return;
    if (data.actor !== app.actor.uuid) return ui.notifications.warn("Mods can only be fitted on the sheet they are carried on.");
    if (tray) return save(app.actor, planFit(app.actor, { mod: data.mod, from: data.from, to: tray.dataset.host, kind: tray.dataset.kind }));
    if (data.from) return save(app.actor, planRemove(app.actor, { host: data.from, mod: data.mod }));
    return;
  }

  // A world item dropped on a tray: Sandbox adds it as usual, then it is
  // fitted. Anything else (a transfer from another sheet, a tab, a drop
  // anywhere but a tray) is left entirely to Sandbox.
  if (!tray || !app.isEditable || typeof app._onDrop !== "function") return;
  let data;
  try { data = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch (e) { return; }
  if (data?.type !== "Item" || data.ownerID) return;
  const fromUuid = foundry.utils.fromUuidSync ?? globalThis.fromUuidSync;
  const item = data.uuid ? fromUuid(data.uuid) : game.items.get(data.id);
  if (item?.type !== "cItem" || item.pack) return;
  ev.preventDefault();
  ev.stopPropagation();
  const kind = tray.dataset.kind, hostId = tray.dataset.host;
  const mk = modKind(item.system?.groups);
  const s = readState(app.actor), host = s.byId.get(hostId);
  if (!mk) return ui.notifications.warn(`${item.name} is not in a mod group.`);
  if (mk !== kind) return ui.notifications.warn(`${item.name} is a ${KINDS[mk].label} mod, so it can't go on ${host?.name ?? "that"}.`);
  if (host && s.links.filter(l => l.w === hostId).length >= slotsFor(kind, host)) return ui.notifications.warn(`${host.name} has no free mod slots.`);
  // _onDrop reads the drop data before its first await, so this call has to
  // happen now, inside the drop event.
  app._onDrop(ev).then(() => {
    const entry = (app.actor.system?.citems ?? []).find(e => e.id === item.id || e.ciKey === item.id);
    if (entry) return save(app.actor, planFit(app.actor, { mod: entry.id, from: null, to: hostId, kind }));
  }).catch(err => log("drop failed", err));
}

function onContextMenu(app, ev) {
  const chip = ev.target.closest?.(".irop-mods-tray .irop-mod[data-mod]");
  if (!chip || !app.isEditable) return;
  ev.preventDefault();
  ev.stopPropagation();
  save(app.actor, planRemove(app.actor, { host: chip.closest(".irop-mods-tray").dataset.host, mod: chip.dataset.mod }));
}

/* A fitted mod opens the same way its name does in the table, which keeps
   Sandbox's own choice between the item sheet and the info card. */
function onClick(app, root, ev) {
  const chip = ev.target.closest?.(".irop-mods-tray .irop-mod[data-mod]");
  if (!chip) return;
  ev.preventDefault();
  ev.stopPropagation();
  const cell = root.querySelector(`tr.table-row[id="${CSS.escape(chip.dataset.mod)}"] td.tablenamecell`);
  if (cell) return cell.click();
  libraryItem(readState(app.actor).byId.get(chip.dataset.mod))?.sheet?.render(true);
}

/* ---- wiring -------------------------------------------------------------------------- */
function attach(app) {
  const root = app?.element?.[0] ?? app?.element;
  if (!(root instanceof HTMLElement)) return;
  const known = sheets.get(app);
  if (known?.root === root) return;
  known?.obs.disconnect();
  const obs = new MutationObserver(() => decorate(app));
  sheets.set(app, { root, obs });
  root.addEventListener("dragstart", ev => onDragStart(app, root, ev), true);
  root.addEventListener("dragover", ev => onDragOver(app, root, ev), true);
  root.addEventListener("drop", ev => onDrop(app, root, ev), true);
  root.addEventListener("contextmenu", ev => onContextMenu(app, ev), true);
  root.addEventListener("click", ev => onClick(app, root, ev), true);
  root.addEventListener("dragleave", ev => { if (!root.contains(ev.relatedTarget)) clearMarks(root); }, true);
  obs.observe(root, OBSERVE);
}

Hooks.on("rendergActorSheet", app => {
  attach(app);
  decorate(app);
});

Hooks.on("closegActorSheet", app => {
  sheets.get(app)?.obs.disconnect();
  sheets.delete(app);
});

Hooks.on("updateActor", (actor, changes) => {
  if (foundry.utils.hasProperty(changes, `flags.${MOD}`) || foundry.utils.hasProperty(changes, `flags.-=${MOD}`)) redrawActor(actor);
});

document.addEventListener("dragend", endDrag, true);
