'use client'
import { useState } from 'react'
import { COUNTRIES, GRAPES } from '@/lib/wine-data'
import type { GrapeOption } from '@/lib/wine-data'
import type { Option } from '@/lib/types'

/** Shared dropdown chrome for both fields below. Every id it touches is
 *  suffixed by the caller so N copies of WineEditor on one page never share
 *  one element — the same rule the regions `<datalist>` already follows. */
const menu = 'absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-pale-stone/20 bg-deep-black shadow-lg'
const item = 'cursor-pointer px-3 py-1.5 text-sm'
const itemActive = 'bg-amber-gold/20'

function matches(q: string, ...fields: string[]) {
  return fields.some(f => f.toLowerCase().includes(q))
}

type FieldProps = {
  id: string
  className: string
  value: string
  onChange: (next: string) => void
  placeholder: string
}

/** Country — filters as you type against ru/en/value, picks fill the field
 *  with the English name (what countryOption/prepareWine match against).
 *  Free text that matches nothing is left alone; the red warning below the
 *  form already tells the admin what that costs. */
export function CountryField({ id, className, value, onChange, placeholder }: FieldProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const q = value.trim().toLowerCase()
  const options = q ? COUNTRIES.filter(c => matches(q, c.ru, c.en, c.value)) : COUNTRIES

  function pick(c: Option) {
    onChange(c.en)
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown') setOpen(true)
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, options.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { if (options[active]) { e.preventDefault(); pick(options[active]) } }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div className="relative">
      <input
        id={id}
        className={className}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        onChange={e => { onChange(e.target.value); setActive(0); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {open && options.length > 0 && (
        <ul id={`${id}-listbox`} role="listbox" className={menu}>
          {options.map((c, i) => (
            <li
              key={c.value}
              role="option"
              aria-selected={i === active}
              className={`${item} ${i === active ? itemActive : ''}`}
              onMouseDown={e => { e.preventDefault(); pick(c) }}
              onMouseEnter={() => setActive(i)}
            >
              {c.ru} <span className="text-pale-stone/50">· {c.en}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const GRAPE_PAGE = 8

/** Grape — opens showing the first 8 with a "Show all" control for the rest;
 *  typing filters the whole pool regardless of that toggle. Colour group is
 *  shown as a quiet hint since it decides which decoys a guest sees. */
export function GrapeField({ id, className, value, onChange, placeholder }: FieldProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [showAll, setShowAll] = useState(false)

  const q = value.trim().toLowerCase()
  const filtered = q ? GRAPES.filter(g => matches(q, g.ru, g.en, g.value)) : GRAPES
  const options = q || showAll ? filtered : filtered.slice(0, GRAPE_PAGE)
  const hasMore = !q && !showAll && filtered.length > GRAPE_PAGE

  function pick(g: GrapeOption) {
    onChange(g.en)
    setOpen(false)
    setShowAll(false)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown') setOpen(true)
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, options.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { if (options[active]) { e.preventDefault(); pick(options[active]) } }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div className="relative">
      <input
        id={id}
        className={className}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        onChange={e => { onChange(e.target.value); setActive(0); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {open && (options.length > 0 || hasMore) && (
        <ul id={`${id}-listbox`} role="listbox" className={menu}>
          {options.map((g, i) => (
            <li
              key={g.value}
              role="option"
              aria-selected={i === active}
              className={`${item} ${i === active ? itemActive : ''}`}
              onMouseDown={e => { e.preventDefault(); pick(g) }}
              onMouseEnter={() => setActive(i)}
            >
              {g.en}
              {g.group && <span className="ml-1 text-pale-stone/50">· {g.group}</span>}
            </li>
          ))}
          {hasMore && (
            <li
              className={`${item} text-amber-gold`}
              onMouseDown={e => { e.preventDefault(); setShowAll(true) }}
            >
              Show all ({GRAPES.length})
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
