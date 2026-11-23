import { useState } from "react";

/** "Select" mode of a list: which ids are ticked, and entering/leaving the mode (leaving clears the ticks). */
export function useSelection() {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  return {
    selecting,
    selected,
    start: () => setSelecting(true),
    stop: () => {
      setSelecting(false);
      setSelected([]);
    },
    toggle: (id: string) => setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])),
  };
}
