import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronIcon } from './ChevronIcon'

export type SelectOption<T extends string = string> = {
  value: T
  label: string
  leading?: ReactNode
}

type Props<T extends string> = {
  id?: string
  value: T
  options: ReadonlyArray<SelectOption<T>>
  onChange: (value: T) => void
  disabled?: boolean
  className?: string
  placeholder?: string
  'aria-labelledby'?: string
}

type MenuPos = {
  top: number
  left: number
  width: number
  maxHeight: number
  openUp: boolean
}

export function SelectDropdown<T extends string>({
  id,
  value,
  options,
  onChange,
  disabled,
  className,
  placeholder,
  'aria-labelledby': ariaLabelledBy,
}: Props<T>) {
  const autoId = useId()
  const listboxId = `${autoId}-listbox`
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [pos, setPos] = useState<MenuPos | null>(null)

  const selected = options.find((option) => option.value === value)
  const selectedIndex = options.findIndex((option) => option.value === value)

  const updatePosition = () => {
    const trigger = triggerRef.current
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    const gap = 6
    const viewportPad = 8
    const preferredMax = 240
    const spaceBelow = window.innerHeight - rect.bottom - gap - viewportPad
    const spaceAbove = rect.top - gap - viewportPad
    const openUp = spaceBelow < 140 && spaceAbove > spaceBelow
    const available = openUp ? spaceAbove : spaceBelow
    const maxHeight = Math.max(120, Math.min(preferredMax, available))

    setPos({
      top: openUp ? rect.top - gap : rect.bottom + gap,
      left: rect.left,
      width: rect.width,
      maxHeight,
      openUp,
    })
  }

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)

    const onReposition = () => updatePosition()
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open, selectedIndex])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
        return
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((current) => {
          if (options.length === 0) return -1
          if (current < 0) return event.key === 'ArrowDown' ? 0 : options.length - 1
          const delta = event.key === 'ArrowDown' ? 1 : -1
          return (current + delta + options.length) % options.length
        })
        return
      }

      if (event.key === 'Enter' || event.key === ' ') {
        if (activeIndex < 0 || activeIndex >= options.length) return
        event.preventDefault()
        onChange(options[activeIndex].value)
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, activeIndex, options, onChange])

  useEffect(() => {
    if (!open || activeIndex < 0) return
    const item = menuRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    )
    item?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  const choose = (next: T) => {
    onChange(next)
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div
      ref={rootRef}
      className={`select-dropdown${className ? ` ${className}` : ''}${open ? ' is-open' : ''}`}
    >
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="select-dropdown__trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-labelledby={ariaLabelledBy}
        onClick={() => {
          if (disabled) return
          setOpen((prev) => !prev)
        }}
        onKeyDown={(event) => {
          if (disabled) return
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span className="select-dropdown__value">
          {selected?.leading ? (
            <span className="select-dropdown__leading">{selected.leading}</span>
          ) : null}
          <span className="select-dropdown__label">
            {selected?.label ?? placeholder ?? ''}
          </span>
        </span>
        <span className="select-dropdown__chevron" aria-hidden>
          <ChevronIcon open={open} className="chevron-icon--down" />
        </span>
      </button>

      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              id={listboxId}
              className={`select-dropdown__menu${pos.openUp ? ' is-up' : ''}`}
              role="listbox"
              style={{
                top: pos.openUp ? undefined : pos.top,
                bottom: pos.openUp
                  ? window.innerHeight - pos.top
                  : undefined,
                left: pos.left,
                width: pos.width,
                maxHeight: pos.maxHeight,
              }}
            >
              {options.map((option, index) => {
                const isSelected = option.value === value
                const isActive = index === activeIndex
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    data-index={index}
                    aria-selected={isSelected}
                    className={`select-dropdown__option${isSelected ? ' is-selected' : ''}${isActive ? ' is-active' : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(option.value)}
                  >
                    {option.leading ? (
                      <span className="select-dropdown__leading">
                        {option.leading}
                      </span>
                    ) : null}
                    <span className="select-dropdown__label">{option.label}</span>
                    {isSelected ? (
                      <span className="select-dropdown__check" aria-hidden>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path
                            d="M2.5 7.2 5.6 10.2 11.5 3.8"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
