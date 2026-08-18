import { useEffect, useState } from 'react'

/** Once `active` becomes true, stays true (for lazy-loaded panels). */
export function useLazyMount(active: boolean) {
  const [mounted, setMounted] = useState(active)

  useEffect(() => {
    if (active) setMounted(true)
  }, [active])

  return mounted
}
