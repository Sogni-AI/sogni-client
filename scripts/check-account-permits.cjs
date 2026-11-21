'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Wallet, verifyTypedData } = require('ethers');
const AccountApi = require('../dist/Account/index.js').default;
const wallet = Wallet.createRandom();
const logger = { info() {}, warn() {}, error() {}, debug() {} };

async function run(
  mutate,
  rejected = false,
  { approve = false, testnet = false, provider = 'base' } = {}
) {
  const calls = [];
  let signed = 0;
  const auth = Object.assign(new EventEmitter(), { sessionVersion: 0 });
  const socket = Object.assign(new EventEmitter(), { isConnected: false });
  const rest = {
    async post(path, payload) {
      calls.push({ path, payload });
      if (path.endsWith('/permit')) {
        const data = {
          domain: {
            name: 'Sogni AI',
            version: '1',
            chainId: '8453',
            verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC'
          },
          types: {
            WithdrawTokenV2: [
              { name: 'walletAddress', type: 'address' },
              { name: 'amount', type: 'string' },
              { name: 'provider', type: 'string' },
              { name: 'nonce', type: 'string' }
            ]
          },
          message: { ...payload, nonce: 'one' }
        };
        data.domain.name = testnet ? 'Sogni-testnet' : 'Sogni AI';
        data.domain.chainId = String(
          testnet
            ? provider === 'etherlink'
              ? 11155111
              : 84532
            : provider === 'etherlink'
              ? 42793
              : 8453
        );
        if (approve) {
          data.domain.verifyingContract = testnet
            ? wallet.address
            : provider === 'etherlink'
              ? '0x2767Fc1048cd0ae4fd952eeF09853301c9DC7173'
              : '0xE014d2A4da6E450f21b5050120D291e63c8940FD';
          data.types = {
            Permit: [
              { name: 'owner', type: 'address' },
              { name: 'spender', type: 'address' },
              { name: 'value', type: 'uint256' },
              { name: 'nonce', type: 'uint256' },
              { name: 'deadline', type: 'uint256' }
            ]
          };
          data.message = {
            owner: wallet.address,
            spender: wallet.address,
            value: '100',
            nonce: '0',
            deadline: Math.floor(Date.now() / 1000) + 7 * 86400
          };
        }
        mutate?.(data);
        return { data };
      }
    }
  };
  const client = Object.assign(new EventEmitter(), { auth, socket, rest, logger });
  const account = new AccountApi({ client, eip712: {}, testnet });
  account.currentAccount._update({ username: 'permit-check', walletAddress: wallet.address });
  account.getWallet = () => ({
    address: wallet.address,
    async signTypedData(domain, types, message) {
      signed++;
      const signature = await wallet.signTypedData(domain, types, message);
      assert.equal(verifyTypedData(domain, types, message, signature), wallet.address);
      return signature;
    }
  });
  const action = () =>
    approve
      ? account.approveTokenUsage('unused', 'account', provider)
      : account.withdraw('unused', '1', provider);
  if (rejected) {
    await assert.rejects(action, /Unexpected signing request; nothing was signed/);
    assert.equal(signed, 0);
    assert.equal(calls.length, 1);
  } else {
    await action();
    assert.equal(signed, 1);
    assert.equal(calls.length, 2);
  }
}
(async () => {
  await run();
  await run((data) => {
    data.domain.chainId = 1;
  }, true);
  await run(
    (data) => {
      data.domain.chainId = 1;
    },
    true,
    { approve: true }
  );
  for (const testnet of [false, true])
    for (const provider of ['base', 'etherlink'])
      for (const approve of [false, true]) {
        const options = { testnet, provider, approve };
        await run(undefined, false, options);
        await run(
          (d) => {
            d.domain.chainId = Number(d.domain.chainId);
            d.domain.verifyingContract = d.domain.verifyingContract.toLowerCase();
          },
          false,
          options
        );
        for (const mutate of [
          (d) => {
            d.domain.chainId = 1;
          },
          (d) => {
            d.types.Extra = [{ name: 'other', type: 'string' }];
          },
          (d) => {
            Object.values(d.types)[0][0].type = 'string';
          },
          (d) => {
            Object.values(d.types)[0].reverse();
          },
          (d) => {
            d.message = null;
          },
          (d) => {
            d.domain = null;
          },
          (d) => {
            d.types = null;
          }
        ])
          await run(mutate, true, options);
        if (!approve || !testnet)
          await run(
            (d) => {
              d.domain.verifyingContract = wallet.address;
            },
            true,
            options
          );
        const mutations = approve
          ? [
              (d) => {
                d.message.owner = '0x0000000000000000000000000000000000000001';
              },
              (d) => {
                d.message.deadline = Math.floor(Date.now() / 1000) + 366 * 86400;
              },
              (d) => {
                d.message.deadline = (2n ** 256n - 1n).toString();
              },
              (d) => {
                d.message.deadline = Date.now() / 1000 + 0.12345;
              }
            ]
          : [
              (d) => {
                d.domain.name = 'Other';
              },
              (d) => {
                d.domain.version = '2';
              },
              (d) => {
                d.domain.salt = '0x' + '00'.repeat(32);
              },
              (d) => {
                d.message.walletAddress = '0x0000000000000000000000000000000000000001';
              },
              (d) => {
                d.message.amount = '2';
              },
              (d) => {
                d.message.provider = 'other';
              },
              (d) => {
                d.message.nonce = 1;
              }
            ];
        for (const mutate of mutations) await run(mutate, true, options);
        if (approve)
          for (const mutate of [
            (d) => {
              d.message.deadline = String(d.message.deadline);
            },
            // A client clock far behind or ahead of the API does not block a permit.
            (d) => {
              d.message.deadline = Math.floor(Date.now() / 1000) + 300 * 86400;
            },
            (d) => {
              d.message.deadline = Math.floor(Date.now() / 1000) - 30 * 86400;
            }
          ])
            await run(mutate, false, options);
        // The API issues Base permits for every provider other than exactly 'etherlink'.
        if (provider === 'base')
          for (const other of ['Base', 'ETHERLINK', 'other', '', '__proto__'])
            await run(undefined, false, { ...options, provider: other });
      }
  await run((d) => {
    d.domain.chainId = [8453];
  }, true);
  await run(
    (d) => {
      d.message.deadline = [Math.floor(Date.now() / 1000) + 86400];
    },
    true,
    { approve: true }
  );
  console.log('Account permit checks passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
