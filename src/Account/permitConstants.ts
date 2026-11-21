// Chain IDs and withdrawal domains come from the sogni-api domain configuration.
// Mainnet token addresses come from the docs.sogni.ai SOGNI token overview.
export const PERMIT_NETWORKS = {
  mainnet: {
    base: { chainId: 8453, token: '0xE014d2A4da6E450f21b5050120D291e63c8940FD' },
    etherlink: { chainId: 42793, token: '0x2767Fc1048cd0ae4fd952eeF09853301c9DC7173' }
  },
  testnet: {
    base: { chainId: 84532, token: undefined },
    etherlink: { chainId: 11155111, token: undefined }
  }
} as const;

export const WITHDRAW_DOMAINS = {
  mainnet: {
    name: 'Sogni AI',
    version: '1',
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC'
  },
  testnet: {
    name: 'Sogni-testnet',
    version: '1',
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC'
  }
} as const;

// Typed data field order matches the sogni-api permit endpoints.
export const WITHDRAW_FIELDS = [
  { name: 'walletAddress', type: 'address' },
  { name: 'amount', type: 'string' },
  { name: 'provider', type: 'string' },
  { name: 'nonce', type: 'string' }
];

// sogni-api issues approval permits that expire 7 days after they are requested. Accepting up
// to 30 days ahead leaves room for a client clock up to 23 days behind the API's clock.
export const APPROVE_MAX_DEADLINE_SECONDS = 30 * 86400;

export const APPROVE_FIELDS = [
  { name: 'owner', type: 'address' },
  { name: 'spender', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint256' }
];
