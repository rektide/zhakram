#!/usr/bin/env node
/**
 * resource-tables host: watch the guest's WASI 0.2 handle table breathe.
 *
 * Instantiate once, snapshot `_util.resourceTables.snapshot()` (injected by
 * `jcona transpile --expose-resources`), then call step1/step2/step3 and
 * print a compact table diff after each call. No otel anywhere — this is
 * pure resource-table introspection.
 *
 *   step1: +handle 1 (A)                 live: 1
 *   step2: +handle 2 (B), guest writes via 1   live: 2
 *   step3: -handle 1 (dropped), guest writes via 2   live: 1
 */
import assert from 'node:assert/strict';

import * as cli from '@bytecodealliance/preview2-shim/cli';
import * as io from '@bytecodealliance/preview2-shim/io';

// The world imports exactly two interfaces; io/error and io/poll ride along
// because wasi:io/streams uses their types.
const imports = {
  'wasi:cli/stdout': cli.stdout,
  'wasi:io/streams': io.streams,
  'wasi:io/error': io.error,
  'wasi:io/poll': io.poll,
};

const component = await import('./build/resource-tour-out/resource-tour.js');
const instance = await component.instantiate(undefined, imports);

const snapshot = () => component._util.resourceTables.snapshot();

/** Flatten every snapshot's handle tables into `{table, handle, ...entry}`. */
const tableEntries = (tables) =>
  tables.instances.flatMap((inst) =>
    inst.handleTables.flatMap((table) =>
      table.entries.map((entry) => ({ table: table.tableIndex, ...entry }))));

const liveMap = (entries) => {
  const live = new Map();
  for (const entry of entries) {
    if (entry.state === 'live') live.set(`${entry.table}:${entry.handle}`, entry);
  }
  return live;
};

/** rep -> host class name, via the capture tables the codemod snapshots. */
const repClasses = (tables) => {
  const classes = new Map();
  for (const inst of tables.instances) {
    for (const [name, table] of Object.entries(inst.captureTables ?? {})) {
      for (const entry of table.entries) {
        classes.set(entry.key, entry.value?.type ?? name);
      }
    }
  }
  return classes;
};

const label = (entry, classes) =>
  classes.has(entry.rep) ? `<${classes.get(entry.rep)}> rep=${entry.rep}` : `rep=${entry.rep}`;

const printDiff = (prevLive, tables) => {
  const entries = tableEntries(tables);
  const live = liveMap(entries);
  const classes = repClasses(tables);
  for (const [key, entry] of live) {
    if (!prevLive.has(key)) {
      console.log(`  + handle ${entry.handle} ${label(entry, classes)} own=${entry.own}`);
    }
  }
  for (const [key, entry] of prevLive) {
    if (!live.has(key)) {
      const now = entries.find((e) => `${e.table}:${e.handle}` === key);
      console.log(`  - handle ${entry.handle} ${label(entry, classes)} now ${now?.state ?? 'gone'}`);
    }
  }
  console.log(`  live handles: ${live.size}`);
  return live;
};

const compactTable = (tables) =>
  tables.instances
    .flatMap((inst) => inst.handleTables)
    .map((table) =>
      `table[${table.tableIndex}] (component ${table.componentIdx}): ${
        table.entries.length === 0
          ? '(empty)'
          : table.entries
            .map((e) => e.state === 'live' ? `${e.handle}=live(rep ${e.rep}, own)` : `${e.handle}=free`)
            .join(', ')}`)
    .join('\n');

console.log('== initial ==');
let prevLive = printDiff(new Map(), snapshot());

for (const step of ['step1', 'step2', 'step3']) {
  console.log(`\n== ${step} ==`);
  instance[step]();
  prevLive = printDiff(prevLive, snapshot());
}

const finalTables = snapshot();
const finalEntries = tableEntries(finalTables);
const dropped = finalEntries.find((e) => e.handle === 1 && e.state === 'free');
const survivor = finalEntries.find((e) => e.handle === 2 && e.state === 'live');

assert.ok(dropped, 'handle 1 should be free after step3');
assert.ok(survivor, 'handle 2 should still be live after step3');
assert.equal(finalEntries.filter((e) => e.state === 'live').length, 1);

console.log('\n== final table ==');
console.log(compactTable(finalTables));
console.log(
  'narrative: handle 1 acquired (step1) -> held alongside handle 2 (step2, guest wrote via 1)'
    + ' -> dropped (step3); handle 2 survived and served the final write.',
);
console.log(
  'RESOURCE-TABLES-NODE-OK:'
  + ` live=1 dropped=1 shape=${finalTables.shape} jco=${finalTables.generatedFor}`,
);
