/**
 * Vendor spend acknowledgement for example scripts.
 *
 * Third-party vendor models (OpenAI GPT Image, ByteDance Seedance, Alibaba
 * HappyHorse, Wan 3) are billed by the vendor on every render. Scripts that
 * submit one require `--confirm-vendor-spend` or a yes at the terminal, so a
 * scripted or agent run can't spend without an explicit acknowledgement.
 * Dependency-free so contract checks can import the examples that use it.
 */

import * as readline from 'node:readline';

const VENDOR_MODEL_ID_PATTERN = /^(gpt-image|seedance|happyhorse|wan3)/i;

export const CONFIRM_VENDOR_SPEND_FLAG = '--confirm-vendor-spend';

export function isVendorModelId(modelId) {
  return typeof modelId === 'string' && VENDOR_MODEL_ID_PATTERN.test(modelId);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(typeof answer === 'string' ? answer.trim() : '');
    });
  });
}

/**
 * Exit unless a vendor-model render was acknowledged. Own-GPU models pass
 * straight through.
 * @param {Array<string|undefined>|string|undefined} modelIds - Model ids the run will submit
 * @param {boolean} confirmed - True when --confirm-vendor-spend was passed
 */
export async function confirmVendorSpend(modelIds, confirmed) {
  const vendorModels = [modelIds].flat().filter(isVendorModelId);
  if (vendorModels.length === 0) return;
  const label = vendorModels.join(', ');
  if (confirmed) {
    console.error(`✓ Vendor spend acknowledged for ${label} (${CONFIRM_VENDOR_SPEND_FLAG})`);
    return;
  }
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const answer = await ask(
      `${label} is a third-party vendor model billed per render. Submit? [y/N]: `
    );
    if (/^y(es)?$/i.test(answer)) return;
    console.error('❌ Cancelled; nothing was submitted.');
    process.exit(0);
  }
  console.error(
    `❌ ${label} is a third-party vendor model billed per render. ` +
      `Re-run with ${CONFIRM_VENDOR_SPEND_FLAG} once that spend is approved.`
  );
  process.exit(2);
}
