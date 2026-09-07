// Compatibility shim for existing Kairos-focused imports.
export {
  RpcChainMismatchError,
  verifyActiveNetworkChain as verifyKairosChain,
  type ChainIdentityClient,
} from './networkChainVerification'
