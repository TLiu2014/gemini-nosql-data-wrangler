import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drag-to-resize helper for the homegrown splitter pattern. Returns a value
 * to bind to the resizable panel and an `onMouseDown` to wire to the handle.
 *
 * `compute(e)` takes a `MouseEvent` during drag and returns the next value;
 * the caller is free to clamp it to whatever range makes sense for that panel.
 * The hook itself only sets the document cursor / userSelect during drag.
 */
export function useDragResize<T>(
  initial: T,
  axis: "x" | "y",
  compute: (e: MouseEvent, current: T) => T,
) {
  const [value, setValue] = useState<T>(initial);
  const dragging = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => () => {
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        setValue((prev) => compute(ev, prev));
      };
      const onUp = () => {
        dragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [axis, compute],
  );

  return { value, setValue, onMouseDown };
}
