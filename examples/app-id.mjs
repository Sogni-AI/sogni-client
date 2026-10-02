/**
 * Stable app IDs for the examples
 *
 * An app ID names one application installation (see "appId" in the README). Generate it once and
 * reuse it on every run: the socket recovers a client's in-flight and finished projects by app ID
 * after a restart (`projects.sync()`), allows one connection per app ID, and limits how many new
 * app IDs an account may connect with each day (error 4061). A fresh ID per run throws away that
 * recovery and burns the daily allowance.
 *
 * Each example gets its own ID, generated on first use and saved to examples/.app-ids.json (git
 * ignored), so two different examples can run side by side. Set SOGNI_APP_ID to use your own ID;
 * two runs of the same example at once need different IDs, since a second connection with the same
 * ID closes the first.
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const STORE = process.env.SOGNI_APP_ID_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), '.app-ids.json');

/**
 * The saved app ID for one example, created the first time it runs.
 * @param {string} name - Short example name, e.g. 'workflow-t2i'
 * @returns {string} The app ID to pass to SogniClient.createInstance
 */
export function exampleAppId(name) {
  if (process.env.SOGNI_APP_ID) return process.env.SOGNI_APP_ID;
  let ids = {};
  try {
    ids = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  } catch {
    // No saved IDs yet.
  }
  if (!ids[name]) {
    ids[name] = `sogni-example-${name}-${randomUUID()}`;
    fs.writeFileSync(STORE, `${JSON.stringify(ids, null, 2)}\n`, { mode: 0o600 });
  }
  return ids[name];
}
