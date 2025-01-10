import { AbstractSigner, TypedDataDomain, TypedDataField } from 'ethers';

type EIP712Types = Record<string, TypedDataField[]>;
type SupportedTypes = 'authentication' | 'signup' | 'withdraw' | 'deposit';

const EIP712_TYPES: Record<SupportedTypes, EIP712Types> = {
  authentication: {
    Authentication: [
      { name: 'walletAddress', type: 'address' },
      { name: 'nonce', type: 'string' }
    ]
  },
  signup: {
    Signup: [
      { name: 'appid', type: 'string' },
      { name: 'username', type: 'string' },
      { name: 'email', type: 'string' },
      { name: 'subscribe', type: 'uint256' },
      { name: 'walletAddress', type: 'address' },
      { name: 'nonce', type: 'string' }
    ]
  },
  withdraw: {
    WithdrawToken: [
      { name: 'walletAddress', type: 'address' },
      { name: 'amount', type: 'string' },
      { name: 'nonce', type: 'string' }
    ]
  },
  deposit: {
    DepositToken: [
      { name: 'walletAddress', type: 'address' },
      { name: 'amount', type: 'string' },
      { name: 'deadline', type: 'uint256' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
      { name: 'nonce', type: 'string' }
    ]
  }
};

interface Options {
  name: string;
  version: string;
  chainId: string;
}

class EIP712Helper {
  private readonly EIP712Domain: TypedDataDomain;

  constructor(options: Options) {
    this.EIP712Domain = {
      name: options.name,
      version: options.version,
      chainId: options.chainId,
      verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC'
    };
  }

  signTypedData(
    signer: AbstractSigner,
    type: SupportedTypes,
    data: Record<string, string | number>
  ) {
    const types = EIP712_TYPES[type];
    if (!types) {
      throw new Error(`Unknown type: ${type}`);
    }

    return signer.signTypedData(this.EIP712Domain, types, data);
  }
}

export default EIP712Helper;
