const addressPattern = /^0x[0-9a-f]{40}$/i
const hashPattern = /^0x[0-9a-f]{64}$/i

function sameHex(left, right) {
  return (
    typeof left === 'string' &&
    typeof right === 'string' &&
    left.toLowerCase() === right.toLowerCase()
  )
}

export function assertFeeDelegatedReceipt({
  ethereumReceipt,
  kaiaReceipt,
  transactionHash,
}) {
  if (
    typeof ethereumReceipt !== 'object' ||
    ethereumReceipt === null ||
    typeof kaiaReceipt !== 'object' ||
    kaiaReceipt === null ||
    kaiaReceipt.status !== '0x1' ||
    !sameHex(kaiaReceipt.transactionHash, transactionHash) ||
    !sameHex(kaiaReceipt.blockHash, ethereumReceipt.blockHash) ||
    !sameHex(kaiaReceipt.from, ethereumReceipt.from) ||
    !sameHex(kaiaReceipt.to, ethereumReceipt.to) ||
    kaiaReceipt.type !== 'TxTypeFeeDelegatedSmartContractExecution' ||
    kaiaReceipt.typeInt !== 49 ||
    typeof kaiaReceipt.senderTxHash !== 'string' ||
    !hashPattern.test(kaiaReceipt.senderTxHash) ||
    typeof kaiaReceipt.feePayer !== 'string' ||
    !addressPattern.test(kaiaReceipt.feePayer) ||
    !Array.isArray(kaiaReceipt.feePayerSignatures) ||
    kaiaReceipt.feePayerSignatures.length === 0
  ) {
    throw new Error('Live Kairos receipt is not fee delegated')
  }

  return kaiaReceipt.feePayer.toLowerCase()
}
