import { useEffect, useRef, useState } from 'react'
import type { Address } from 'viem'
import { copyWalletAddress } from './addressCopy'

interface AddressCopyButtonProps {
  readonly address: Address
}

export function AddressCopyButton({ address }: AddressCopyButtonProps) {
  const [feedback, setFeedback] = useState<'copied' | 'error' | null>(null)
  const feedbackTimer = useRef<number | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (feedbackTimer.current !== null) {
        window.clearTimeout(feedbackTimer.current)
      }
    }
  }, [])

  const handleCopy = async () => {
    if (feedbackTimer.current !== null) {
      window.clearTimeout(feedbackTimer.current)
      feedbackTimer.current = null
    }
    setFeedback(null)

    try {
      await copyWalletAddress(address)
      if (!mounted.current) return
      setFeedback('copied')
      feedbackTimer.current = window.setTimeout(() => {
        if (mounted.current) setFeedback(null)
        feedbackTimer.current = null
      }, 2_500)
    } catch {
      if (mounted.current) setFeedback('error')
    }
  }

  return (
    <div className="copy-address-control">
      <button
        type="button"
        className="secondary compact-button"
        aria-label="Copy address"
        onClick={() => void handleCopy()}
      >
        アドレスをコピー
      </button>
      {feedback === 'copied' && (
        <p className="copy-feedback" role="status" aria-live="polite">
          アドレスをコピーしました
        </p>
      )}
      {feedback === 'error' && (
        <p className="copy-feedback" role="alert">
          アドレスをコピーできませんでした。もう一度お試しください。
        </p>
      )}
    </div>
  )
}
