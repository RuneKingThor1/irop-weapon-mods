# Insurrection: Weapon Mods

A Foundry VTT 13 module for the Insurrection world on Sandbox System Builder. Every ranged weapon, melee weapon and armor on a character sheet gets a mod tray under it. Drag a mod from your inventory onto the tray to fit it. It is a record only: nothing about the weapon changes mechanically.

## Install

In Foundry setup, Add-on Modules, Install Module, paste this manifest URL:

```
https://raw.githubusercontent.com/RuneKingThor1/irop-weapon-mods/main/module.json
```

Then enable it in the world under Manage Modules.

## Using it

* Drag a mod by its name from the Ranged, Melee or Armor Mods table onto the tray under a weapon or armor.
* Drag a fitted mod to another tray to move it.
* Right click a fitted mod, or drag it off onto the sheet, to take it off.
* Click a fitted mod to open it. Hover it to read it.
* A GM can drag a mod straight from the Items sidebar onto a tray: it is added to the sheet and fitted in one go.

Fitted mods stay listed in the Mods section of the Gear box, tagged with what they are on, so that section always shows every mod carried, how many, and the Capacity they take. The Hide fitted mods setting takes them out of the list instead. Mods only fit their own kind, one of each per item, and only as many as there are slots.

## Setup

Run the GM macro `weapon-mods-setup.js` (kept with the Insurrection Foundry macros) on apply. It makes the Ranged, Melee and Armor Mods groups and tables, puts the tables in the Gear box on the Loadout tab, and once every character has been reloaded from the template, adds their Capacity to Current Weight.

## Slots

Set under Configure Settings, Module Settings. Defaults: ranged weapons 3, melee weapons 2, Light armor 3, Medium armor 4, Heavy armor 3. Armor is classed by the word Light, Medium or Heavy in its name; anything else in the armor table gets the Other armor value. Slot overrides fixes individual items, for example `Kevlar Armor = Medium; Ballistic Shield = 0`.

## What it stores

One flag on each actor listing which mod entry is fitted to which item. Mods stay ordinary carried items, so weight and quantity are untouched, and no Sandbox data is written. Disabling the module returns the sheet to normal with every mod in inventory.

## Updating

Edit, bump `version` in module.json, run `python pack.py` in this folder, and push module.json and the zip. Foundry and Sqyre offer the update once the new version is on GitHub.
