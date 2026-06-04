'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { WineCard, WineColor } from '@/lib/types'
import {
  TASTE_OPTIONS_BY_COLOR, FOOD_OPTIONS, BUDGET_CAPS,
  recommend,
  type WizardAnswers, type TasteKey, type FoodKey, type BudgetKey,
} from '@/lib/wizard'
import { WineTile } from '@/components/WineTile'

const COLOR_OPTIONS: { key: WineColor; label: string }[] = [
  { key: 'red',       label: 'Red' },
  { key: 'white',     label: 'White' },
  { key: 'rose',      label: 'Rosé' },
  { key: 'sparkling', label: 'Sparkling' },
]

const BUDGET_OPTIONS: { key: BudgetKey; label: string }[] = [
  { key: 'low',  label: `Under ฿${BUDGET_CAPS.low!.toLocaleString('en-US')}` },
  { key: 'mid',  label: `Under ฿${BUDGET_CAPS.mid!.toLocaleString('en-US')}` },
  { key: 'high', label: `Under ฿${BUDGET_CAPS.high!.toLocaleString('en-US')}` },
  { key: 'any',  label: 'No limit' },
]

export default function WizardPage() {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1)
  const [answers, setAnswers] = useState<WizardAnswers>({
    color: null, taste: null, food: null, budget: null,
  })
  const [wines, setWines] = useState<WineCard[] | null>(null)

  useEffect(() => {
    fetch('/api/wines').then(r => r.json()).then(d => setWines(d.wines)).catch(() => setWines([]))
  }, [])

  const tasteOptions = answers.color ? TASTE_OPTIONS_BY_COLOR[answers.color] : []

  const recs = useMemo(() => {
    if (step !== 5 || !wines) return []
    return recommend(wines, answers, 3)
  }, [step, wines, answers])

  function pickColor(c: WineColor) {
    setAnswers(a => ({ ...a, color: c, taste: null }))
    setStep(2)
  }
  function pickTaste(t: TasteKey)  { setAnswers(a => ({ ...a, taste: t }));  setStep(3) }
  function pickFood(f: FoodKey)    { setAnswers(a => ({ ...a, food: f }));   setStep(4) }
  function pickBudget(b: BudgetKey){ setAnswers(a => ({ ...a, budget: b })); setStep(5) }

  return (
    <div className="flex-1 flex flex-col bg-warm-white">
      <div className="px-6 pt-6 pb-3 border-b border-pale-stone flex items-center justify-between">
        <Link href="/" className="overline text-graphite active:text-deep-black">← Cancel</Link>
        <div className="overline text-graphite">Step {Math.min(step, 4)} of 4</div>
        <div className="w-16" />
      </div>

      <div className="flex-1 px-6 pt-8 pb-32 overflow-y-auto">
        {step === 1 && (
          <Step title="What type of wine?">
            <Choices items={COLOR_OPTIONS.map(o => ({ key: o.key, label: o.label }))}
                     onPick={k => pickColor(k as WineColor)} />
          </Step>
        )}

        {step === 2 && (
          <Step title="Which taste do you prefer?">
            <Choices items={tasteOptions.map(o => ({ key: o.key, label: o.label, hint: o.hint }))}
                     onPick={k => pickTaste(k as TasteKey)} />
          </Step>
        )}

        {step === 3 && (
          <Step title="What will you drink it with?">
            <Choices items={FOOD_OPTIONS.map(o => ({ key: o.key, label: o.label, hint: o.hint }))}
                     onPick={k => pickFood(k as FoodKey)} />
          </Step>
        )}

        {step === 4 && (
          <Step title="Your budget?">
            <Choices items={BUDGET_OPTIONS.map(o => ({ key: o.key, label: o.label }))}
                     onPick={k => pickBudget(k as BudgetKey)} />
          </Step>
        )}

        {step === 5 && (
          <div>
            <div className="font-display text-5xl tracking-display text-deep-black leading-tight">YOUR PICKS</div>
            <div className="overline text-graphite mt-2 mb-6">3 wines, in stock, matched for you</div>
            {wines === null && <div className="text-graphite">Loading…</div>}
            {wines !== null && recs.length === 0 && (
              <div className="text-graphite text-lg">
                Nothing exact in stock — try a different budget or call our staff.
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              {recs.map(w => <WineTile key={w.id} wine={w} />)}
            </div>
            <button
              onClick={() => { setStep(1); setAnswers({ color: null, taste: null, food: null, budget: null }) }}
              className="mt-8 h-14 px-6 rounded-md border-2 border-deep-black text-deep-black font-heading font-semibold"
            >
              Start over
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-display text-5xl tracking-display text-deep-black leading-tight mb-8">
        {title.toUpperCase()}
      </div>
      {children}
    </div>
  )
}

function Choices({
  items, onPick,
}: { items: { key: string; label: string; hint?: string }[]; onPick: (k: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      {items.map(it => (
        <button
          key={it.key}
          onClick={() => onPick(it.key)}
          className="text-left h-24 px-6 rounded-lg bg-cream active:bg-pale-stone flex flex-col justify-center"
        >
          <div className="font-heading font-semibold text-2xl text-deep-black">{it.label}</div>
          {it.hint && <div className="text-sm text-graphite mt-1">{it.hint}</div>}
        </button>
      ))}
    </div>
  )
}
