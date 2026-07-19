import { createServer } from 'node:http'
import {
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  keccak256,
  padHex,
  parseTransaction,
  recoverTransactionAddress,
  toHex,
} from 'viem'

const tokenContract = getAddress(
  '0xe7c3d8c9a439fede00d2600032d5db0be71c3c29',
)
const expectedRecipient = getAddress(
  '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
)
const expectedAmount = 125_000_000_000_000_000_000n
const transferTopic =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const backendReceiptMisses = 10

const erc20Abi = [
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
]

const port = parsePort(process.env.LIVT_E2E_RPC_PORT)
let state = createState('happy')

const server = createServer(async (request, response) => {
  setCorsHeaders(response)

  if (request.method === 'OPTIONS') {
    response.writeHead(204).end()
    return
  }

  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, { ok: true })
    return
  }

  if (request.method === 'GET' && request.url === '/control/state') {
    sendJson(response, 200, publicState(state))
    return
  }

  if (request.method === 'POST' && request.url === '/control/reset') {
    try {
      const body = await readJsonBody(request)
      const scenario = parseScenario(body?.scenario)
      state = createState(scenario)
      sendJson(response, 200, publicState(state))
    } catch {
      sendJson(response, 400, { error: 'Invalid E2E scenario' })
    }
    return
  }

  if (request.method !== 'POST' || request.url !== '/') {
    sendJson(response, 404, { error: 'Not found' })
    return
  }

  let rpcRequest
  try {
    rpcRequest = await readJsonBody(request)
    const result = await rpcResult(
      rpcRequest.method,
      rpcRequest.params ?? [],
      typeof request.headers.origin === 'string',
    )
    sendJson(response, 200, {
      jsonrpc: '2.0',
      id: rpcRequest.id,
      result,
    })
  } catch {
    sendJson(response, 200, {
      jsonrpc: '2.0',
      id: rpcRequest?.id ?? null,
      error: {
        code: -32000,
        message: 'E2E RPC request rejected',
      },
    })
  }
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write('Payment E2E RPC ready\n')
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}

async function rpcResult(method, parameters, browserRequest) {
  if (method === 'eth_chainId') {
    state.chainChecks += 1
    return '0x3e9'
  }
  if (method === 'eth_getBalance') {
    state.nativeBalanceReads += 1
    return '0xde0b6b3a7640000'
  }
  if (method === 'eth_getCode') {
    assertTokenAddress(parameters[0])
    return '0x6000'
  }
  if (method === 'eth_call') {
    return ethCall(parameters)
  }
  if (method === 'eth_estimateGas') {
    assertTransferCall(parameters[0])
    return '0xea60'
  }
  if (method === 'eth_gasPrice') return '0x5d21dba00'
  if (method === 'eth_getTransactionCount') return '0x0'
  if (method === 'eth_sendRawTransaction') {
    return recordBroadcast(parameters[0])
  }
  if (method === 'eth_getTransactionReceipt') {
    return transactionReceipt(parameters[0], browserRequest)
  }

  throw new Error('Unsupported E2E RPC method')
}

function ethCall(parameters) {
  const call = parameters[0]
  assertTokenAddress(call?.to)
  const data = String(call?.data ?? '').toLowerCase()

  if (data.startsWith('0x95d89b41')) {
    return encodeFunctionResult({
      abi: erc20Abi,
      functionName: 'symbol',
      result: 'JPYC',
    })
  }
  if (data.startsWith('0x313ce567')) {
    return encodeFunctionResult({
      abi: erc20Abi,
      functionName: 'decimals',
      result: 18,
    })
  }
  if (data.startsWith('0x70a08231')) {
    state.tokenBalanceReads += 1
    return encodeFunctionResult({
      abi: erc20Abi,
      functionName: 'balanceOf',
      result: 9_000_000_000_000_000_000_000n,
    })
  }

  assertTransferCall(call)
  state.simulations += 1
  return encodeFunctionResult({
    abi: erc20Abi,
    functionName: 'transfer',
    result: true,
  })
}

async function recordBroadcast(serializedTransaction) {
  if (typeof serializedTransaction !== 'string') {
    throw new Error('Missing serialized transaction')
  }

  const transaction = parseTransaction(serializedTransaction)
  if (
    transaction.chainId !== 1001 ||
    transaction.type !== 'legacy' ||
    (transaction.value ?? 0n) !== 0n ||
    transaction.to === null ||
    getAddress(transaction.to) !== tokenContract
  ) {
    throw new Error('Unexpected transaction envelope')
  }

  const transfer = decodeFunctionData({
    abi: erc20Abi,
    data: transaction.data,
  })
  if (
    transfer.functionName !== 'transfer' ||
    getAddress(transfer.args[0]) !== expectedRecipient ||
    transfer.args[1] !== expectedAmount
  ) {
    throw new Error('Unexpected transfer call')
  }

  const transactionHash = keccak256(serializedTransaction)
  const sender = await recoverTransactionAddress({ serializedTransaction })
  state.broadcasts += 1
  state.transactionHash = transactionHash
  state.sender = sender
  state.lastTransfer = {
    recipient: expectedRecipient,
    amount: expectedAmount.toString(),
  }
  return transactionHash
}

function transactionReceipt(transactionHash, browserRequest) {
  if (
    typeof transactionHash !== 'string' ||
    transactionHash !== state.transactionHash ||
    state.sender === null
  ) {
    return null
  }

  state.receiptReads += 1
  if (browserRequest) {
    state.browserReceiptReads += 1
  } else {
    state.backendReceiptReads += 1
    if (
      state.scenario === 'receipt-pending-once' &&
      state.backendReceiptReads <= backendReceiptMisses
    ) {
      return null
    }
  }

  return successfulReceipt(transactionHash, state.sender)
}

function successfulReceipt(transactionHash, sender) {
  const blockHash = `0x${'1'.repeat(64)}`
  const log = {
    address: tokenContract,
    blockHash,
    blockNumber: '0x1',
    data: toHex(expectedAmount, { size: 32 }),
    logIndex: '0x0',
    removed: false,
    topics: [
      transferTopic,
      padHex(sender, { size: 32 }),
      padHex(expectedRecipient, { size: 32 }),
    ],
    transactionHash,
    transactionIndex: '0x0',
  }

  return {
    blockHash,
    blockNumber: '0x1',
    contractAddress: null,
    cumulativeGasUsed: '0xea60',
    effectiveGasPrice: '0x5d21dba00',
    from: sender,
    gasUsed: '0xea60',
    logs: [log],
    logsBloom: `0x${'0'.repeat(512)}`,
    status: '0x1',
    to: tokenContract,
    transactionHash,
    transactionIndex: '0x0',
    type: '0x0',
  }
}

function assertTransferCall(call) {
  assertTokenAddress(call?.to)
  const transfer = decodeFunctionData({
    abi: erc20Abi,
    data: call?.data,
  })
  if (
    transfer.functionName !== 'transfer' ||
    getAddress(transfer.args[0]) !== expectedRecipient ||
    transfer.args[1] !== expectedAmount
  ) {
    throw new Error('Unexpected simulated transfer')
  }
}

function assertTokenAddress(value) {
  if (typeof value !== 'string' || getAddress(value) !== tokenContract) {
    throw new Error('Unexpected token contract')
  }
}

function createState(scenario) {
  return {
    scenario,
    chainChecks: 0,
    simulations: 0,
    broadcasts: 0,
    receiptReads: 0,
    browserReceiptReads: 0,
    backendReceiptReads: 0,
    nativeBalanceReads: 0,
    tokenBalanceReads: 0,
    transactionHash: null,
    sender: null,
    lastTransfer: null,
  }
}

function publicState(value) {
  return {
    scenario: value.scenario,
    chainChecks: value.chainChecks,
    simulations: value.simulations,
    broadcasts: value.broadcasts,
    receiptReads: value.receiptReads,
    browserReceiptReads: value.browserReceiptReads,
    backendReceiptReads: value.backendReceiptReads,
    nativeBalanceReads: value.nativeBalanceReads,
    tokenBalanceReads: value.tokenBalanceReads,
    transactionHash: value.transactionHash,
    sender: value.sender,
    lastTransfer: value.lastTransfer,
  }
}

function parseScenario(value) {
  if (value === 'happy' || value === 'receipt-pending-once') return value
  throw new Error('Unknown E2E scenario')
}

function parsePort(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error('Missing E2E RPC port')
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
    throw new Error('Invalid E2E RPC port')
  }
  return parsed
}

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'content-type')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.setHeader('Cache-Control', 'no-store')
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

async function readJsonBody(request) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > 1_000_000) throw new Error('Request too large')
  }
  return JSON.parse(body)
}
