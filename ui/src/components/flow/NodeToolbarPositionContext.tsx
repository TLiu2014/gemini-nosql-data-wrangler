import { createContext, useContext, type ReactNode } from "react";
import { Position } from "@xyflow/react";

const NodeToolbarPositionContext = createContext<Position>(Position.Right);

export function NodeToolbarPositionProvider({
  value,
  children,
}: {
  value: Position;
  children: ReactNode;
}) {
  return (
    <NodeToolbarPositionContext.Provider value={value}>
      {children}
    </NodeToolbarPositionContext.Provider>
  );
}

/** Position for NodeToolbar when used as the floating stage editor (under TransformationFlow). */
export function useNodeToolbarPosition(): Position {
  return useContext(NodeToolbarPositionContext);
}
