import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  Position,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  reconnectEdge,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";

import { Eye, Pencil } from "lucide-react";
import { StageConfigUI } from "@/components/config/StageConfigUI";
import { FlowCanvasToolbar } from "@/components/flow/FlowCanvasToolbar";
import { deserializePipeline, serializePipeline, type PipelineSchema } from "@/Schema";
import { STAGE_COLORS, STAGE_LABELS, defaultConfigFor, type StageNodeData, type StageType } from "@/types/Pipeline";
import {
  DEFAULT_EDGE_SOURCE_HANDLE_ID,
  DEFAULT_EDGE_TARGET_HANDLE_ID,
} from "./StageEdgeHandles";
import { GradientEdge } from "./GradientEdge";
import { NodeToolbarPositionProvider } from "./NodeToolbarPositionContext";
import { PopoverStageEditor } from "./PopoverStageEditor";
import { StageNode } from "./StageNode";
import { StageNodeContext, type StageNodeCallbacks } from "./StageNodeContext";

export interface TransformationFlowHandle {
  /** Adds a new stage node to the canvas and opens its edit form. */
  addStage: (stageType: StageType) => void;
}

export interface TransformationFlowProps {
  /**
   * Pipeline to load onto the canvas. When this reference changes (e.g. the
   * host loads a new sample), the canvas re-initializes. Changes caused by
   * the user editing the canvas do NOT trigger a reload — only genuinely new
   * schemas from outside do.
   */
  schema?: PipelineSchema | null;
  /** Fires after every meaningful user edit (drag-stop, connect, config save, delete). */
  onChange?: (schema: PipelineSchema) => void;
  /** Called when the user clicks a stage's output-table link. */
  onShowOutput?: (stageId: string) => void;
  /**
   * "popover" — the edit form floats next to the node on the canvas.
   * "panel"   — the edit form is pinned as a right sidebar.
   * Defaults to "popover".
   */
  configDisplayMode?: "popover" | "panel";
  confirmBeforeDelete?: boolean;
  /** When true, the canvas is view-only: no edits, no connections, no deletions. Node dragging is still allowed. */
  readOnly?: boolean;
}

const nodeTypes: NodeTypes = { stageNode: StageNode };
const edgeTypes: EdgeTypes = { gradient: GradientEdge };

function withDefaultHandles(e: Edge): Edge {
  return {
    ...e,
    sourceHandle: e.sourceHandle ?? DEFAULT_EDGE_SOURCE_HANDLE_ID,
    targetHandle: e.targetHandle ?? DEFAULT_EDGE_TARGET_HANDLE_ID,
  };
}

export const TransformationFlow = forwardRef<
  TransformationFlowHandle,
  TransformationFlowProps
>(function TransformationFlow(
  {
    schema,
    onChange,
    onShowOutput,
    configDisplayMode = "popover",
    confirmBeforeDelete = true,
    readOnly = false,
  },
  ref,
) {
  const [nodes, setNodes] = useState<Node<StageNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [toolbarExpanded, setToolbarExpanded] = useState(true);
  const [popoverPosition, setPopoverPosition] = useState<Position>(Position.Right);
  const [isReadOnly, setIsReadOnly] = useState(readOnly);
  // Reconnect constraints use refs so StageNode reads synchronously-set values
  // when useConnection triggers its re-render (zustand fires before React
  // flushes state, so state would arrive a render too late).
  const validReconnectNodeIdRef = useRef<string | null>(null);
  const selfLoopReconnectNodeIdRef = useRef<string | null>(null);

  // Refs always hold the latest render values — safe to use in callbacks.
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const pipelineNameRef = useRef(schema?.pipeline.name ?? "pipeline");
  nodesRef.current = nodes;
  edgesRef.current = edges;

  // Tracks the last schema we emitted so we don't re-init the canvas on our
  // own onChange round-trips from the host.
  const lastEmitted = useRef<PipelineSchema | null>(null);

  // Load (or reload) from the schema prop — only when it's a genuinely new
  // schema from outside, not one we emitted ourselves.
  useEffect(() => {
    if (!schema) return;
    if (schema === lastEmitted.current) return;
    const { name, nodes: newNodes, edges: newEdges } = deserializePipeline(schema);
    pipelineNameRef.current = name;
    setNodes(newNodes);
    // Resolve default handle IDs on load so emitted schemas are complete.
    setEdges(newEdges.map(withDefaultHandles));
    setSelectedNodeId(null);
    setEditingNodeId(null);
  }, [schema]);

  const emit = useCallback(
    (emitNodes: Node<StageNodeData>[], emitEdges: Edge[]) => {
      if (!onChange) return;
      const s = serializePipeline(emitNodes, emitEdges, {
        name: pipelineNameRef.current,
      });
      lastEmitted.current = s;
      onChange(s);
    },
    [onChange],
  );

  // ── Canvas event handlers ────────────────────────────────────────────────

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<StageNodeData>>[]) => {
      const removes = changes.filter((c) => c.type === "remove");
      const others = changes.filter((c) => c.type !== "remove");

      if (removes.length > 0) {
        const removedIds = new Set(removes.map((c) => c.id));
        // Apply any non-remove changes first, then filter out removed nodes.
        const afterOthers =
          others.length > 0
            ? (applyNodeChanges(others, nodesRef.current) as Node<StageNodeData>[])
            : nodesRef.current;
        const newNodes = afterOthers.filter((n) => !removedIds.has(n.id));
        const newEdges = edgesRef.current.filter(
          (e) => !removedIds.has(e.source) && !removedIds.has(e.target),
        );
        setNodes(newNodes);
        setEdges(newEdges);
        setSelectedNodeId((cur) => (cur && removedIds.has(cur) ? null : cur));
        setEditingNodeId((cur) => (cur && removedIds.has(cur) ? null : cur));
        emit(newNodes, newEdges);
      } else {
        setNodes((ns) => applyNodeChanges(others, ns) as Node<StageNodeData>[]);
      }
    },
    [emit],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removes = changes.filter((c) => c.type === "remove");
      const others = changes.filter((c) => c.type !== "remove");

      if (removes.length > 0) {
        const removedIds = new Set(removes.map((c) => c.id));
        const baseEdges =
          others.length > 0
            ? applyEdgeChanges(others, edgesRef.current)
            : edgesRef.current;
        const newEdges = baseEdges.filter((e) => !removedIds.has(e.id));
        setEdges(newEdges);
        emit(nodesRef.current, newEdges);
      } else {
        setEdges((es) => applyEdgeChanges(others, es));
      }
    },
    [emit],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (connection.source === connection.target) return;
      const newEdges = addEdge(
        withDefaultHandles({ ...connection, type: "gradient" } as Edge),
        edgesRef.current,
      );
      setEdges(newEdges);
      emit(nodesRef.current, newEdges);
    },
    [emit],
  );

  const reconnectSucceeded = useRef(false);

  const handleReconnectStart = useCallback(
    (_: unknown, edge: Edge, handleType: "source" | "target") => {
      // React Flow's onReconnectStart passes handleType as the type of the
      // OPPOSITE/FIXED handle, not the one being dragged. So:
      // - handleType === 'target' → dragged side is source, fixed side is target
      // - handleType === 'source' → dragged side is target, fixed side is source
      // validRef = the dragged side's node (in view-only, the only valid target).
      // selfLoopRef = the fixed side's node (connecting dragged side here = self-loop).
      reconnectSucceeded.current = false;
      const draggedNodeId = handleType === "target" ? edge.source : edge.target;
      const fixedNodeId = handleType === "target" ? edge.target : edge.source;
      validReconnectNodeIdRef.current = isReadOnly ? draggedNodeId : null;
      selfLoopReconnectNodeIdRef.current = fixedNodeId;
    },
    [isReadOnly],
  );

  const isValidConnection = useCallback(
    (connection: Connection | Edge): boolean => {
      // During reconnect selfLoopReconnectNodeIdRef is non-null. React Flow
      // passes {source: drag-origin, target: hovered} so same-node handle
      // changes look like self-loops — return true and let StageNode's
      // reconnectInvalid (from refs) drive the shadow instead.
      if (selfLoopReconnectNodeIdRef.current != null) return true;
      // New connection drag: only reject self-loops.
      return connection.source !== connection.target;
    },
    [],
  );

  const handleReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      // Never allow self-loops.
      if (newConnection.source === newConnection.target) return;
      // In read-only mode only allow changing the handle side on the same node.
      if (
        isReadOnly &&
        (newConnection.source !== oldEdge.source ||
          newConnection.target !== oldEdge.target)
      ) {
        return;
      }
      reconnectSucceeded.current = true;
      const newEdges = reconnectEdge(oldEdge, newConnection, edgesRef.current);
      setEdges(newEdges);
      emit(nodesRef.current, newEdges);
    },
    [emit, isReadOnly],
  );

  const handleReconnectEnd = useCallback((_: unknown, edge: Edge) => {
    if (!reconnectSucceeded.current) {
      // Drag dropped to nothing or rejected — restore the edge if React Flow
      // removed it via onEdgesChange.
      setEdges((prev) =>
        prev.some((e) => e.id === edge.id) ? prev : [...prev, edge],
      );
    }
    reconnectSucceeded.current = false;
    validReconnectNodeIdRef.current = null;
    selfLoopReconnectNodeIdRef.current = null;
  }, []);

  // ── Node interaction ─────────────────────────────────────────────────────

  const handleNodeClick = (node: Node<StageNodeData>) => {
    setSelectedNodeId(node.id);
    if (!isReadOnly && configDisplayMode === "panel") setEditingNodeId(node.id);
  };

  const handleNodeDoubleClick = (node: Node<StageNodeData>) => {
    setSelectedNodeId(node.id);
    if (!isReadOnly) setEditingNodeId(node.id);
  };

  const handlePaneClick = () => {
    setSelectedNodeId(null);
    if (configDisplayMode !== "popover") setEditingNodeId(null);
  };

  const handleEditNode = (stageId: string) => {
    setSelectedNodeId(stageId);
    setEditingNodeId(stageId);
  };

  // ── Config panel mutations ───────────────────────────────────────────────

  const handleUpdateNode = useCallback(
    (id: string, patch: Partial<StageNodeData>) => {
      const newNodes = nodesRef.current.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...patch } } : n,
      );
      setNodes(newNodes);
      emit(newNodes, edgesRef.current);
    },
    [emit],
  );

  const handleDelete = useCallback(
    (id: string) => {
      const newNodes = nodesRef.current.filter((n) => n.id !== id);
      const newEdges = edgesRef.current.filter(
        (e) => e.source !== id && e.target !== id,
      );
      setNodes(newNodes);
      setEdges(newEdges);
      setSelectedNodeId((cur) => (cur === id ? null : cur));
      setEditingNodeId((cur) => (cur === id ? null : cur));
      emit(newNodes, newEdges);
    },
    [emit],
  );

  // ── Imperative handle (addStage) ─────────────────────────────────────────

  const addStage = useCallback(
    (stageType: StageType) => {
      const id = `n${Date.now().toString(36)}`;
      const stageIndex = nodesRef.current.length + 1;
      const newNode: Node<StageNodeData> = {
        id,
        type: "stageNode",
        position: {
          x: 80 + (stageIndex % 3) * 60,
          y: 80 + stageIndex * 80,
        },
        data: {
          stageType,
          label: `${STAGE_LABELS[stageType]} #${stageIndex}`,
          stageIndex,
          config: defaultConfigFor(stageType),
          outputTableName: `${stageType.toLowerCase()}_${stageIndex}`,
        },
      };
      const newNodes = [...nodesRef.current, newNode];
      setNodes(newNodes);
      setSelectedNodeId(id);
      setEditingNodeId(id);
      emit(newNodes, edgesRef.current);
    },
    [emit],
  );

  useImperativeHandle(ref, () => ({ addStage }), [addStage]);

  // ── Derived state for render ─────────────────────────────────────────────

  const editingNode = useMemo(
    () => nodes.find((n) => n.id === editingNodeId) ?? null,
    [nodes, editingNodeId],
  );

  const decoratedNodes = useMemo(
    () => nodes.map((n) => ({ ...n, selected: n.id === selectedNodeId })),
    [nodes, selectedNodeId],
  );

  const callbacks = useMemo<StageNodeCallbacks>(
    () => ({ onShowOutput, onEdit: isReadOnly ? undefined : handleEditNode, readOnly: isReadOnly, validReconnectNodeIdRef, selfLoopReconnectNodeIdRef }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onShowOutput, isReadOnly],
  );

  return (
    <StageNodeContext.Provider value={callbacks}>
      <NodeToolbarPositionProvider value={popoverPosition}>
        <div className="flex h-full min-h-[480px]">
          <div className="relative min-w-0 flex-1">
            <div className="pointer-events-none absolute left-2 top-2 z-20">
              <button
                type="button"
                onClick={() => {
                  setIsReadOnly((v) => !v);
                  setEditingNodeId(null);
                }}
                title={isReadOnly ? "Switch to edit mode" : "Switch to view-only mode"}
                aria-label={isReadOnly ? "Switch to edit mode" : "Switch to view-only mode"}
                className="pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white/95 px-3 text-xs font-medium text-gray-700 shadow-md backdrop-blur hover:bg-gray-50"
              >
                {isReadOnly ? (
                  <>
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </>
                ) : (
                  <>
                    <Eye className="h-3.5 w-3.5" />
                    View only
                  </>
                )}
              </button>
            </div>
            {!isReadOnly && (
              <div className="pointer-events-none absolute left-2 top-12 z-20 flex max-w-[min(100%-1rem,18rem)] flex-col gap-1">
                <FlowCanvasToolbar
                  expanded={toolbarExpanded}
                  onExpandedChange={setToolbarExpanded}
                  editPanelPosition={popoverPosition}
                  onEditPanelPositionChange={setPopoverPosition}
                  onAddStage={addStage}
                />
              </div>
            )}
            <ReactFlow
              nodes={decoratedNodes}
              edges={edges}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onConnect={isReadOnly ? undefined : handleConnect}
              isValidConnection={isValidConnection}
              onReconnectStart={handleReconnectStart}
              onReconnect={handleReconnect}
              onReconnectEnd={handleReconnectEnd}
              onNodeClick={(_, node) => handleNodeClick(node as Node<StageNodeData>)}
              onNodeDoubleClick={(_, node) => handleNodeDoubleClick(node as Node<StageNodeData>)}
              onNodeDragStop={() => emit(nodesRef.current, edgesRef.current)}
              onPaneClick={handlePaneClick}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              defaultEdgeOptions={{ type: "gradient" }}
              connectionMode={ConnectionMode.Loose}
              deleteKeyCode={isReadOnly ? null : "Delete"}
              onInit={(instance) =>
                requestAnimationFrame(() => instance.fitView({ padding: 0.1 }))
              }
              proOptions={{ hideAttribution: true }}
              className="h-full w-full"
            >
              <Background color="#e5e7eb" gap={16} />
              <Controls className="!shadow-md" />
              <MiniMap
                pannable
                zoomable
                nodeColor={(n) => {
                  const data = n.data as StageNodeData | undefined;
                  return data ? STAGE_COLORS[data.stageType] : "#9ca3af";
                }}
                className="!bg-white"
              />
              {!isReadOnly && configDisplayMode === "popover" && editingNode && (
                <PopoverStageEditor
                  node={editingNode}
                  onUpdate={handleUpdateNode}
                  onDelete={handleDelete}
                  onCancel={() => setEditingNodeId(null)}
                  confirmBeforeDelete={confirmBeforeDelete}
                />
              )}
            </ReactFlow>
          </div>

          {!isReadOnly && configDisplayMode === "panel" && (
            <div className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-gray-200 bg-white">
              <StageConfigUI
                node={editingNode}
                onUpdate={(id, patch) => {
                  handleUpdateNode(id, patch);
                  setEditingNodeId(null);
                }}
                onDelete={handleDelete}
                onCancel={() => setEditingNodeId(null)}
                confirmBeforeDelete={confirmBeforeDelete}
              />
            </div>
          )}
        </div>
      </NodeToolbarPositionProvider>
    </StageNodeContext.Provider>
  );
});
