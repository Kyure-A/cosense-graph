import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import Graph from "graphology";
import {
  useEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import Sigma from "sigma";
import type { GraphNode, PageGraph } from "./graph";

type MotionSettings = {
  center: number;
  repel: number;
  linkStrength: number;
  linkDistance: number;
};

type GraphCanvasProps = {
  graph: PageGraph;
  motion: MotionSettings;
  selectedId?: string;
  matchedIds: string[];
  animateVersion: number;
  showParticles: boolean;
  showLabels: boolean;
  focusMode: boolean;
  viewVersion: number;
  onSelect: (id?: string) => void;
  onHover: (id?: string) => void;
  onPreviewChange: (preview?: { id: string; x: number; y: number }) => void;
  onOpenPage: (id: string) => void;
};

type SigmaNodeAttributes = {
  x: number;
  y: number;
  size: number;
  baseSize: number;
  color: string;
  baseColor: string;
  label: string;
  title: string;
  degree: number;
  incoming: number;
  outgoing: number;
  cluster: number;
  isGhost: boolean;
  image?: string | null;
  updated?: number;
};

type SigmaEdgeAttributes = {
  size: number;
  baseSize: number;
  color: string;
  baseColor: string;
  highlightColor: string;
  value: number;
  importance: number;
};

type LayoutNode = SimulationNodeDatum & {
  id: string;
  degree: number;
  radius: number;
  cluster: number;
  isGhost: boolean;
  index: number;
};

type LayoutLink = SimulationLinkDatum<LayoutNode> & {
  source: LayoutNode;
  target: LayoutNode;
  value: number;
};

type ReducerState = {
  selectedId?: string;
  matchedIds: Set<string>;
  showParticles: boolean;
  showLabels: boolean;
  focusMode: boolean;
  hoveredId?: string;
  focusedIds?: Set<string>;
  largeGraphMode: boolean;
  ultraGraphMode: boolean;
  timelineCutoff: number;
};

type DragGestureState = {
  pointerDown: boolean;
  pointerId?: number;
  dragging: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastClickAt: number;
  lastClickNode?: string;
};

const DRAG_THRESHOLD = 2;
const DOUBLE_CLICK_DELAY = 280;
const WHEEL_ZOOM_SENSITIVITY = 0.006;
const WHEEL_ZOOM_DELTA_CAP = 120;
const LARGE_GRAPH_NODES = 2_500;
const ULTRA_GRAPH_NODES = 10_000;
const LARGE_GRAPH_EDGES = 12_000;
const ULTRA_GRAPH_EDGES = 60_000;
const MOTION_ANIMATION_NODE_LIMIT = 1_800;
const MOTION_ANIMATION_DURATION = 820;
const TIMELINE_ANIMATION_DURATION = 1_850;

type SavedCameraState = {
  x: number;
  y: number;
  angle: number;
  ratio: number;
};

export function GraphCanvas({
  graph,
  motion,
  selectedId,
  matchedIds,
  animateVersion,
  showParticles,
  showLabels,
  focusMode,
  viewVersion,
  onSelect,
  onHover,
  onPreviewChange,
  onOpenPage,
}: GraphCanvasProps) {
  const glowCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const interactionLayerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<Sigma<SigmaNodeAttributes, SigmaEdgeAttributes> | null>(null);
  const graphRef = useRef<Graph<SigmaNodeAttributes, SigmaEdgeAttributes> | null>(null);
  const hoveredIdRef = useRef<string | undefined>();
  const cameraStateRef = useRef<SavedCameraState | null>(null);
  const appliedFitVersionRef = useRef(-1);
  const requestedFitVersionRef = useRef(viewVersion);
  const layoutFrameRef = useRef<number | null>(null);
  const timelineFrameRef = useRef<number | null>(null);
  const dragGestureRef = useRef<DragGestureState>({
    pointerDown: false,
    pointerId: undefined,
    dragging: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    lastClickAt: 0,
    lastClickNode: undefined,
  });
  const reducerStateRef = useRef<ReducerState>({
    selectedId,
    matchedIds: new Set(matchedIds),
    showParticles,
    showLabels,
    focusMode,
    hoveredId: undefined,
    focusedIds: undefined,
    largeGraphMode: false,
    ultraGraphMode: false,
    timelineCutoff: Number.POSITIVE_INFINITY,
  });

  const largeGraphMode =
    graph.nodes.length >= LARGE_GRAPH_NODES || graph.links.length >= LARGE_GRAPH_EDGES;
  const ultraGraphMode =
    graph.nodes.length >= ULTRA_GRAPH_NODES || graph.links.length >= ULTRA_GRAPH_EDGES;
  const initialLayout = useMemo(() => computeSeedLayout(graph), [graph]);
  const targetLayout = useMemo(
    () => computeLayout(graph, motion),
    [graph, motion.center, motion.linkDistance, motion.linkStrength, motion.repel],
  );
  const sigmaGraph = useMemo(
    () => buildSigmaGraph(graph, initialLayout),
    [graph, initialLayout],
  );

  function setHoveredNode(node?: string) {
    if (hoveredIdRef.current === node) return;
    hoveredIdRef.current = node;
    reducerStateRef.current.hoveredId = node;
    onHover(node);
    rendererRef.current?.refresh({ schedule: true });
  }

  function clearHover() {
    setHoveredNode(undefined);
  }

  function setPreview(
    nodeId: string | undefined,
    point?: { x: number; y: number },
  ) {
    if (!nodeId || !point) {
      onPreviewChange(undefined);
      return;
    }

    onPreviewChange({
      id: nodeId,
      x: point.x,
      y: point.y,
    });
  }

  function handleInteractionPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    if (event.button !== 0) return;
    setPreview(undefined);
    dragGestureRef.current.pointerDown = true;
    dragGestureRef.current.pointerId = event.pointerId;
    dragGestureRef.current.dragging = false;
    dragGestureRef.current.startX = event.clientX;
    dragGestureRef.current.startY = event.clientY;
    dragGestureRef.current.lastX = event.clientX;
    dragGestureRef.current.lastY = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleInteractionPointerMove(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    const renderer = rendererRef.current;
    const sigmaGraphInstance = graphRef.current;
    const layer = interactionLayerRef.current;
    if (!renderer || !sigmaGraphInstance || !layer) return;

    if (
      !dragGestureRef.current.pointerDown ||
      dragGestureRef.current.pointerId !== event.pointerId
    ) {
      const point = eventPoint(event.nativeEvent, layer);
      const hitNode = pickNodeAt(renderer, sigmaGraphInstance, point);
      setHoveredNode(hitNode);
      setPreview(
        event.ctrlKey || event.metaKey ? hitNode : undefined,
        event.ctrlKey || event.metaKey ? { x: event.clientX, y: event.clientY } : undefined,
      );
      return;
    }

    const distance = Math.hypot(
      event.clientX - dragGestureRef.current.startX,
      event.clientY - dragGestureRef.current.startY,
    );
    if (!dragGestureRef.current.dragging && distance < DRAG_THRESHOLD) return;
    if (!dragGestureRef.current.dragging) {
      dragGestureRef.current.dragging = true;
      clearHover();
      setPreview(undefined);
    }

    panCamera(
      renderer,
      layer,
      dragGestureRef.current.lastX,
      dragGestureRef.current.lastY,
      event.clientX,
      event.clientY,
    );
    dragGestureRef.current.lastX = event.clientX;
    dragGestureRef.current.lastY = event.clientY;
  }

  function handleInteractionPointerUp(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    const renderer = rendererRef.current;
    const sigmaGraphInstance = graphRef.current;
    const layer = interactionLayerRef.current;
    if (!renderer || !sigmaGraphInstance || !layer) return;
    if (dragGestureRef.current.pointerId !== event.pointerId) return;

    const wasDragging = dragGestureRef.current.dragging;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragGestureRef.current.pointerDown = false;
    dragGestureRef.current.pointerId = undefined;
    dragGestureRef.current.dragging = false;

    if (wasDragging) return;
    setPreview(undefined);

    const hitNode = pickNodeAt(
      renderer,
      sigmaGraphInstance,
      eventPoint(event.nativeEvent, layer),
    );
    const now = performance.now();
    const isDoubleClick =
      Boolean(hitNode) &&
      dragGestureRef.current.lastClickNode === hitNode &&
      now - dragGestureRef.current.lastClickAt < DOUBLE_CLICK_DELAY;

    dragGestureRef.current.lastClickAt = now;
    dragGestureRef.current.lastClickNode = hitNode;

    if (isDoubleClick && hitNode) {
      onOpenPage(hitNode);
      return;
    }

    onSelect(hitNode);
    setHoveredNode(hitNode);
  }

  function handleInteractionWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    applyWheelZoom(event.nativeEvent);
  }

  function handleInteractionLeave() {
    if (!dragGestureRef.current.pointerDown) {
      clearHover();
    }
    setPreview(undefined);
  }

  useEffect(() => {
    requestedFitVersionRef.current = viewVersion;
  }, [viewVersion]);

  useEffect(() => {
    const layer = interactionLayerRef.current;
    if (!layer) return;

    const handleNativeWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      applyWheelZoom(event);
    };
    const handleGesture = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    layer.addEventListener("wheel", handleNativeWheel, { passive: false });
    layer.addEventListener("gesturestart", handleGesture);
    layer.addEventListener("gesturechange", handleGesture);
    layer.addEventListener("gestureend", handleGesture);

    return () => {
      layer.removeEventListener("wheel", handleNativeWheel);
      layer.removeEventListener("gesturestart", handleGesture);
      layer.removeEventListener("gesturechange", handleGesture);
      layer.removeEventListener("gestureend", handleGesture);
    };
  }, []);

  useEffect(() => {
    reducerStateRef.current = {
      selectedId,
      matchedIds: new Set(matchedIds),
      showParticles,
      showLabels,
      focusMode,
      hoveredId: hoveredIdRef.current,
      largeGraphMode,
      ultraGraphMode,
      timelineCutoff: reducerStateRef.current.timelineCutoff,
      focusedIds:
        selectedId && graphRef.current
          ? focusedNodeIds(graphRef.current, selectedId)
          : undefined,
    };

    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setSetting("renderLabels", showLabels && !ultraGraphMode);
    renderer.refresh({ schedule: true });
    drawGlowLayer(
      renderer,
      graphRef.current,
      glowCanvasRef.current,
      reducerStateRef.current,
    );
  }, [
    focusMode,
    largeGraphMode,
    matchedIds,
    selectedId,
    showLabels,
    showParticles,
    ultraGraphMode,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || sigmaGraph.order === 0) return;

    reducerStateRef.current = {
      selectedId,
      matchedIds: new Set(matchedIds),
      showParticles,
      showLabels,
      focusMode,
      hoveredId: hoveredIdRef.current,
      largeGraphMode,
      ultraGraphMode,
      timelineCutoff: Number.POSITIVE_INFINITY,
      focusedIds: selectedId ? focusedNodeIds(sigmaGraph, selectedId) : undefined,
    };

    const sigmaInstance = new Sigma(sigmaGraph, container, {
      allowInvalidContainer: true,
      autoCenter: true,
      autoRescale: true,
      enableCameraZooming: true,
      hideEdgesOnMove: true,
      hideLabelsOnMove: true,
      enableCameraPanning: true,
      itemSizesReference: "screen",
      labelDensity: ultraGraphMode ? 0.02 : largeGraphMode ? 0.12 : 0.92,
      labelGridCellSize: ultraGraphMode ? 180 : largeGraphMode ? 132 : 96,
      labelRenderedSizeThreshold: ultraGraphMode ? 18 : largeGraphMode ? 14 : 12,
      labelColor: { color: "#c3cad6" },
      labelFont: "Inter, ui-sans-serif, system-ui, sans-serif",
      labelSize: 12,
      labelWeight: "500",
      minEdgeThickness: ultraGraphMode ? 0.3 : 0.5,
      renderEdgeLabels: false,
      renderLabels: showLabels && !ultraGraphMode,
      stagePadding: 36,
      zIndex: true,
      minCameraRatio: 0.035,
      maxCameraRatio: 7,
      nodeReducer: (node, data) =>
        reduceNode({
          graph: sigmaGraph,
          node,
          data,
          state: reducerStateRef.current,
        }),
      edgeReducer: (edge, data) =>
        reduceEdge({
          graph: sigmaGraph,
          edge,
          data,
          state: reducerStateRef.current,
        }),
    });

    graphRef.current = sigmaGraph;
    rendererRef.current = sigmaInstance;
    sigmaInstance.getCamera().on("updated", (state) => {
      cameraStateRef.current = {
        x: state.x,
        y: state.y,
        angle: state.angle,
        ratio: state.ratio,
      };
    });
    sigmaInstance.on("afterRender", () => {
      drawGlowLayer(
        sigmaInstance,
        graphRef.current,
        glowCanvasRef.current,
        reducerStateRef.current,
      );
    });

    if (requestedFitVersionRef.current > appliedFitVersionRef.current) {
      appliedFitVersionRef.current = requestedFitVersionRef.current;
      void sigmaInstance.getCamera().animatedReset({ duration: 220 });
    } else if (cameraStateRef.current) {
      sigmaInstance.getCamera().setState(cameraStateRef.current);
    }

    return () => {
      cancelAnimationFrameSafe(layoutFrameRef);
      cancelAnimationFrameSafe(timelineFrameRef);
      hoveredIdRef.current = undefined;
      sigmaInstance.kill();
      rendererRef.current = null;
      graphRef.current = null;
    };
  }, [
    largeGraphMode,
    onHover,
    onOpenPage,
    onPreviewChange,
    onSelect,
    showLabels,
    sigmaGraph,
    ultraGraphMode,
  ]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const sigmaGraphInstance = graphRef.current;
    if (!renderer || !sigmaGraphInstance || sigmaGraphInstance.order === 0) return;

    cancelAnimationFrameSafe(layoutFrameRef);

    const startPositions = new Map<string, { x: number; y: number }>();
    for (const node of sigmaGraphInstance.nodes()) {
      const data = sigmaGraphInstance.getNodeAttributes(node);
      startPositions.set(node, { x: data.x, y: data.y });
    }

    if (
      ultraGraphMode ||
      sigmaGraphInstance.order > MOTION_ANIMATION_NODE_LIMIT
    ) {
      for (const node of sigmaGraphInstance.nodes()) {
        const position = targetLayout.get(node);
        if (!position) continue;
        sigmaGraphInstance.mergeNodeAttributes(node, position);
      }
      renderer.refresh({ schedule: true });
      return;
    }

    const startedAt = performance.now();
    const step = (now: number) => {
      const progress = clamp((now - startedAt) / MOTION_ANIMATION_DURATION, 0, 1);
      const eased = easeOutCubic(progress);

      for (const node of sigmaGraphInstance.nodes()) {
        const from = startPositions.get(node);
        const to = targetLayout.get(node);
        if (!from || !to) continue;
        sigmaGraphInstance.mergeNodeAttributes(node, {
          x: mix(from.x, to.x, eased),
          y: mix(from.y, to.y, eased),
        });
      }

      renderer.refresh({ schedule: true });
      if (progress < 1) {
        layoutFrameRef.current = window.requestAnimationFrame(step);
      } else {
        layoutFrameRef.current = null;
      }
    };

    layoutFrameRef.current = window.requestAnimationFrame(step);
    return () => {
      cancelAnimationFrameSafe(layoutFrameRef);
    };
  }, [graph, targetLayout, ultraGraphMode]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const sigmaGraphInstance = graphRef.current;
    if (!renderer || !sigmaGraphInstance) return;

    reducerStateRef.current.timelineCutoff = Number.POSITIVE_INFINITY;
    renderer.refresh({ schedule: true });
  }, [graph]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const sigmaGraphInstance = graphRef.current;
    if (!renderer || !sigmaGraphInstance || animateVersion <= 0) return;

    const timestamps = sigmaGraphInstance
      .nodes()
      .map((node) => sigmaGraphInstance.getNodeAttribute(node, "updated"))
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      .sort((a, b) => a - b);

    if (timestamps.length < 2) return;

    cancelAnimationFrameSafe(timelineFrameRef);
    const minUpdated = timestamps[0];
    const maxUpdated = timestamps[timestamps.length - 1];
    reducerStateRef.current.timelineCutoff = minUpdated - 1;
    renderer.refresh({ schedule: true });

    const startedAt = performance.now();
    const step = (now: number) => {
      const progress = clamp((now - startedAt) / TIMELINE_ANIMATION_DURATION, 0, 1);
      const eased = easeInOutCubic(progress);
      reducerStateRef.current.timelineCutoff = mix(minUpdated, maxUpdated, eased);
      renderer.refresh({ schedule: true });

      if (progress < 1) {
        timelineFrameRef.current = window.requestAnimationFrame(step);
      } else {
        reducerStateRef.current.timelineCutoff = Number.POSITIVE_INFINITY;
        timelineFrameRef.current = null;
        renderer.refresh({ schedule: true });
      }
    };

    timelineFrameRef.current = window.requestAnimationFrame(step);
    return () => {
      cancelAnimationFrameSafe(timelineFrameRef);
      reducerStateRef.current.timelineCutoff = Number.POSITIVE_INFINITY;
      renderer.refresh({ schedule: true });
    };
  }, [animateVersion, graph]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || viewVersion <= appliedFitVersionRef.current) return;
    appliedFitVersionRef.current = viewVersion;
    void renderer.getCamera().animatedReset({ duration: 220 });
  }, [viewVersion]);

  function applyWheelZoom(event: WheelEvent) {
    const renderer = rendererRef.current;
    const layer = interactionLayerRef.current;
    if (!renderer || !layer) return;

    const camera = renderer.getCamera();
    const currentRatio = camera.getState().ratio;
    const clampedDelta = clamp(Math.abs(event.deltaY), 0, WHEEL_ZOOM_DELTA_CAP);
    const zoomFactor = Math.exp(clampedDelta * WHEEL_ZOOM_SENSITIVITY);
    const nextRatio = camera.getBoundedRatio(
      currentRatio * (event.deltaY < 0 ? 1 / zoomFactor : zoomFactor),
    );

    camera.setState(
      renderer.getViewportZoomedState(eventPoint(event, layer), nextRatio),
    );
  }

  return (
    <div ref={stageRef} className="graph-canvas-wrap sigma-stage">
      <div ref={containerRef} className="sigma-container" />
      <canvas ref={glowCanvasRef} className="glow-layer" aria-hidden="true" />
      <div
        ref={interactionLayerRef}
        className="graph-interaction-layer"
        aria-hidden="true"
        onPointerDown={handleInteractionPointerDown}
        onPointerMove={handleInteractionPointerMove}
        onPointerUp={handleInteractionPointerUp}
        onPointerCancel={handleInteractionPointerUp}
        onPointerLeave={handleInteractionLeave}
        onWheel={handleInteractionWheel}
      />
    </div>
  );
}

function eventPoint(
  event: MouseEvent | PointerEvent | WheelEvent,
  container: HTMLDivElement,
) {
  const rect = container.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function panCamera(
  renderer: Sigma<SigmaNodeAttributes, SigmaEdgeAttributes>,
  container: HTMLDivElement,
  fromClientX: number,
  fromClientY: number,
  toClientX: number,
  toClientY: number,
) {
  const previous = renderer.viewportToFramedGraph({
    x: fromClientX - container.getBoundingClientRect().left,
    y: fromClientY - container.getBoundingClientRect().top,
  });
  const current = renderer.viewportToFramedGraph({
    x: toClientX - container.getBoundingClientRect().left,
    y: toClientY - container.getBoundingClientRect().top,
  });
  const camera = renderer.getCamera();
  const state = camera.getState();

  camera.setState({
    x: state.x - (current.x - previous.x),
    y: state.y - (current.y - previous.y),
  });
  renderer.scheduleRender();
}

function pickNodeAt(
  renderer: Sigma<SigmaNodeAttributes, SigmaEdgeAttributes>,
  graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>,
  point: { x: number; y: number },
) {
  let bestNode: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const node of graph.nodes()) {
    const data = renderer.getNodeDisplayData(node);
    if (!data || data.hidden) continue;
    const viewport = renderer.framedGraphToViewport({ x: data.x, y: data.y });
    const radius = renderer.scaleSize(data.size) + 4;
    const distance = Math.hypot(viewport.x - point.x, viewport.y - point.y);
    if (distance > radius) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestNode = node;
    }
  }

  return bestNode;
}

function drawGlowLayer(
  renderer: Sigma<SigmaNodeAttributes, SigmaEdgeAttributes> | null,
  graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes> | null,
  canvas: HTMLCanvasElement | null,
  state: ReducerState,
) {
  if (!renderer || !graph || !canvas) return;

  const container = renderer.getContainer();
  const rect = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.globalCompositeOperation = "lighter";

  const clusterBuckets = new Map<
    number,
    { x: number; y: number; weight: number; color: string }
  >();
  const topNodes = [...graph.nodes()]
    .map((node) => ({ node, data: graph.getNodeAttributes(node) }))
    .filter(({ data }) => !data.isGhost)
    .sort((a, b) => b.data.degree - a.data.degree)
    .slice(0, state.ultraGraphMode ? 10 : state.largeGraphMode ? 18 : 24);

  for (const { data } of topNodes) {
    const point = renderer.graphToViewport({ x: data.x, y: data.y });
    const bucket = clusterBuckets.get(data.cluster) ?? {
      x: 0,
      y: 0,
      weight: 0,
      color: data.baseColor,
    };
    const weight = Math.max(1, Math.sqrt(data.degree));
    bucket.x += point.x * weight;
    bucket.y += point.y * weight;
    bucket.weight += weight;
    clusterBuckets.set(data.cluster, bucket);
  }

  for (const bucket of clusterBuckets.values()) {
    const x = bucket.x / Math.max(1, bucket.weight);
    const y = bucket.y / Math.max(1, bucket.weight);
    const radius =
      state.ultraGraphMode
        ? 132
        : state.largeGraphMode
          ? 176
          : 210;
    drawGlow(ctx, x, y, radius, bucket.color, 0.038);
  }

  for (const { node, data } of topNodes) {
    const point = renderer.graphToViewport({ x: data.x, y: data.y });
    const active =
      state.hoveredId === node ||
      state.selectedId === node ||
      state.matchedIds.has(node);
    const glowRadius =
      (active ? 24 : 14) +
      Math.sqrt(Math.max(1, data.degree)) *
        (state.ultraGraphMode ? 1.2 : state.largeGraphMode ? 1.6 : 2);
    const alpha = active ? 0.14 : state.ultraGraphMode ? 0.018 : 0.035;
    drawGlow(ctx, point.x, point.y, glowRadius, data.baseColor, alpha);
  }
}

function drawGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha: number,
) {
  const rgb = hexToRgb(color);
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`);
  gradient.addColorStop(0.35, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha * 0.22})`);
  gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
}

function buildSigmaGraph(
  pageGraph: PageGraph,
  layout: Map<string, { x: number; y: number }>,
) {
  const graph = new Graph<SigmaNodeAttributes, SigmaEdgeAttributes>({
    type: "directed",
    multi: false,
    allowSelfLoops: false,
  });

  for (const node of pageGraph.nodes) {
    const position = layout.get(node.id) ?? { x: 0, y: 0 };
    const x = Number.isFinite(position.x) ? position.x : jitter(node.id, 0);
    const y = Number.isFinite(position.y) ? position.y : jitter(`${node.id}:y`, 0);
    const baseSize = node.isGhost
      ? 1.8 + Math.sqrt(Math.max(node.degree, 0)) * 0.32
      : 4.5 + Math.sqrt(Math.max(node.degree, 0)) * 0.62;

    graph.addNode(node.id, {
      x,
      y,
      size: baseSize,
      baseSize,
      color: node.color,
      baseColor: node.color,
      label: node.title,
      title: node.title,
      degree: node.degree,
      incoming: node.incoming,
      outgoing: node.outgoing,
      cluster: node.cluster,
      isGhost: node.isGhost,
      image: node.image,
      updated: node.updated,
    });
  }

  for (const link of pageGraph.links) {
    const source = nodeId(link.source);
    const target = nodeId(link.target);
    if (!graph.hasNode(source) || !graph.hasNode(target) || graph.hasEdge(link.id)) {
      continue;
    }

    const sourceColor = graph.getNodeAttribute(source, "baseColor");
    const importance = Math.max(
      graph.getNodeAttribute(source, "degree"),
      graph.getNodeAttribute(target, "degree"),
    );
    const baseSize = link.value >= 1 ? 1.1 : 0.72;

    graph.addDirectedEdgeWithKey(link.id, source, target, {
      size: baseSize,
      baseSize,
      color: rgba("#6a7282", link.value >= 1 ? 0.2 : 0.065),
      baseColor: "#6a7282",
      highlightColor: sourceColor,
      value: link.value,
      importance,
    });
  }

  return graph;
}

function reduceNode({
  graph,
  node,
  data,
  state,
}: {
  graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>;
  node: string;
  data: SigmaNodeAttributes;
  state: ReducerState;
}) {
  const hovered = state.hoveredId === node;
  const selected = state.selectedId === node;
  const matched = state.matchedIds.has(node);
  const active = hovered || selected || matched;
  const dimmed = Boolean(
    state.focusMode &&
      state.focusedIds &&
      !state.focusedIds.has(node) &&
      node !== state.hoveredId &&
      node !== state.selectedId,
  );
  const hiddenByTimeline =
    Number.isFinite(state.timelineCutoff) &&
    typeof data.updated === "number" &&
    data.updated > state.timelineCutoff;

  return {
    x: data.x,
    y: data.y,
    color: dimmed
      ? data.isGhost
        ? "#4a505a"
        : rgba(data.baseColor, 0.16)
      : active
        ? data.baseColor
        : data.isGhost
          ? rgba("#707887", 0.62)
          : rgba(data.baseColor, 0.94),
    forceLabel: active,
    highlighted: active,
    hidden: hiddenByTimeline,
    label: state.ultraGraphMode && !active ? null : dimmed && !active ? null : data.label,
    size: active
      ? data.baseSize * (selected ? 1.65 : hovered ? 1.38 : 1.22)
      : dimmed
        ? data.baseSize * 0.72
        : state.ultraGraphMode
          ? data.baseSize * 0.92
          : data.baseSize,
    type: "circle",
    zIndex: active ? 2 : data.degree,
  };
}

function reduceEdge({
  graph,
  edge,
  data,
  state,
}: {
  graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>;
  edge: string;
  data: SigmaEdgeAttributes;
  state: ReducerState;
}) {
  const [source, target] = graph.extremities(edge);
  const touchesHovered = source === state.hoveredId || target === state.hoveredId;
  const touchesSelected = source === state.selectedId || target === state.selectedId;
  const touchesMatched = state.matchedIds.has(source) || state.matchedIds.has(target);
  const highlighted = touchesHovered || touchesSelected || touchesMatched;
  const hiddenByFocus = Boolean(
    state.focusMode &&
      state.focusedIds &&
      (!state.focusedIds.has(source) || !state.focusedIds.has(target)) &&
      !highlighted,
  );
  const hiddenByLod =
    !highlighted &&
    (state.ultraGraphMode
      ? data.importance < 18
      : state.largeGraphMode
        ? data.importance < 10
        : false);
  const sourceUpdated = graph.getNodeAttribute(source, "updated");
  const targetUpdated = graph.getNodeAttribute(target, "updated");
  const hiddenByTimeline =
    Number.isFinite(state.timelineCutoff) &&
    ((typeof sourceUpdated === "number" && sourceUpdated > state.timelineCutoff) ||
      (typeof targetUpdated === "number" && targetUpdated > state.timelineCutoff));

  if (hiddenByFocus || hiddenByLod || hiddenByTimeline) {
    return {
      color: rgba(data.baseColor, 0.01),
      forceLabel: false,
      hidden: true,
      label: null,
      size: data.baseSize,
      type: "line",
      zIndex: 0,
    };
  }

  return {
    color: highlighted
      ? rgba(data.highlightColor, touchesSelected ? 0.48 : 0.28)
      : state.showParticles
        ? rgba(data.baseColor, data.value >= 1 ? 0.18 : 0.08)
        : rgba(data.baseColor, data.value >= 1 ? 0.18 : 0.08),
    hidden: false,
    size: highlighted
      ? data.baseSize * 1.6
      : state.showParticles
        ? data.baseSize
        : data.baseSize * 0.72,
    forceLabel: false,
    label: null,
    type: "line",
    zIndex: highlighted ? 1 : 0,
  };
}

function focusedNodeIds(
  graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>,
  selectedId: string,
) {
  const nodes = new Set<string>([selectedId]);
  for (const neighbor of graph.neighbors(selectedId)) {
    nodes.add(neighbor);
  }
  return nodes;
}

function computeLayout(pageGraph: PageGraph, motion: MotionSettings) {
  if (
    pageGraph.nodes.length >= LARGE_GRAPH_NODES ||
    pageGraph.links.length >= LARGE_GRAPH_EDGES
  ) {
    return computeFastLayout(pageGraph, motion);
  }

  return computeForceLayout(pageGraph, motion);
}

function computeSeedLayout(pageGraph: PageGraph) {
  const layoutNodes: LayoutNode[] = pageGraph.nodes.map((node, index) => ({
    id: node.id,
    degree: node.degree,
    radius: node.radius,
    cluster: node.cluster < 0 ? 0 : node.cluster,
    isGhost: node.isGhost,
    x: 0,
    y: 0,
    index,
  }));
  const clusterIds = [...new Set(layoutNodes.map((node) => node.cluster))].sort(
    (a, b) => a - b,
  );
  const clusterRadius = 0.24 + Math.sqrt(layoutNodes.length) * 0.018;
  const centers = createClusterCenters(clusterIds, clusterRadius, clusterRadius * 0.72);

  return new Map(
    layoutNodes.map((node) => {
      const center = centers.get(node.cluster) ?? { x: 0, y: 0 };
      const angle = (hashString(node.id) % 1000) / 1000 * Math.PI * 2;
      const spread = clamp(0.02 + Math.sqrt(node.degree + 1) * 0.012, 0.03, 0.18);
      return [
        node.id,
        {
          x: finite(center.x + Math.cos(angle) * spread + jitter(`${node.id}:sx`, 0.014)),
          y: finite(center.y + Math.sin(angle) * spread + jitter(`${node.id}:sy`, 0.014)),
        },
      ];
    }),
  );
}

function computeForceLayout(pageGraph: PageGraph, motion: MotionSettings) {
  const layoutNodes: LayoutNode[] = pageGraph.nodes.map((node, index) => ({
    id: node.id,
    degree: node.degree,
    radius: node.radius,
    cluster: node.cluster < 0 ? 0 : node.cluster,
    isGhost: node.isGhost,
    x: 0,
    y: 0,
    index,
  }));
  const nodeById = new Map(layoutNodes.map((node) => [node.id, node]));
  const clusterIds = [...new Set(layoutNodes.map((node) => node.cluster))].sort(
    (a, b) => a - b,
  );
  const centerStrength = scaleControl(motion.center, 0.02, 0.15);
  const repelScale = scaleControl(motion.repel, 0.35, 2.1);
  const linkStrengthScale = scaleControl(motion.linkStrength, 0.32, 1.9);
  const linkDistanceScale = scaleControl(motion.linkDistance, 0.72, 1.7);
  const clusterRadius = (140 + Math.sqrt(layoutNodes.length) * 14) * linkDistanceScale;
  const centers = createClusterCenters(clusterIds, clusterRadius, clusterRadius * 0.72);

  for (const node of layoutNodes) {
    const center = centers.get(node.cluster) ?? { x: 0, y: 0 };
    const angle = (hashString(node.id) % 1000) / 1000 * Math.PI * 2;
    const jitter = 24 + Math.sqrt(node.degree + 1) * 7;
    node.x = center.x + Math.cos(angle) * jitter;
    node.y = center.y + Math.sin(angle) * jitter;
  }

  const layoutLinks: LayoutLink[] = pageGraph.links
    .map((link) => {
      const source = nodeById.get(nodeId(link.source));
      const target = nodeById.get(nodeId(link.target));
      if (!source || !target) return null;
      return { source, target, value: link.value };
    })
    .filter((link): link is LayoutLink => link !== null);

  const simulation = forceSimulation<LayoutNode>(layoutNodes)
    .force(
      "link",
      forceLink<LayoutNode, LayoutLink>(layoutLinks)
        .id((node) => node.id)
        .distance((link) =>
          (link.value >= 1
            ? 22 + Math.sqrt(link.source.degree + link.target.degree) * 2.4
            : 30 + Math.sqrt(link.source.degree + link.target.degree) * 2.8) *
          linkDistanceScale,
        )
        .strength((link) => (link.value >= 1 ? 0.18 : 0.08) * linkStrengthScale),
    )
    .force(
      "charge",
      forceManyBody<LayoutNode>().strength((node) =>
        (node.isGhost ? -12 : -26 - Math.sqrt(node.degree) * 5.4) * repelScale,
      ),
    )
    .force(
      "collide",
      forceCollide<LayoutNode>().radius(
        (node) => (node.isGhost ? 3.8 : 6.5) + Math.sqrt(node.degree),
      ),
    )
    .force(
      "x",
      forceX<LayoutNode>((node) => centers.get(node.cluster)?.x ?? 0).strength((node) =>
        node.isGhost ? centerStrength * 0.34 : centerStrength,
      ),
    )
    .force(
      "y",
      forceY<LayoutNode>((node) => centers.get(node.cluster)?.y ?? 0).strength((node) =>
        node.isGhost ? centerStrength * 0.34 : centerStrength,
      ),
    )
    .velocityDecay(0.28)
    .alphaDecay(0.03)
    .stop();

  const ticks = Math.min(320, Math.max(140, Math.floor(layoutNodes.length * 0.42)));
  for (let index = 0; index < ticks; index += 1) {
    simulation.tick();
  }
  simulation.stop();

  const minX = Math.min(...layoutNodes.map((node) => node.x ?? 0));
  const maxX = Math.max(...layoutNodes.map((node) => node.x ?? 0));
  const minY = Math.min(...layoutNodes.map((node) => node.y ?? 0));
  const maxY = Math.max(...layoutNodes.map((node) => node.y ?? 0));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const scaleBase = Math.max(width, height);
  const scale = Number.isFinite(scaleBase) && scaleBase > 0 ? 2 / scaleBase : 1;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return new Map(
    layoutNodes.map((node) => [
      node.id,
      {
        x: finite(((node.x ?? 0) - centerX) * scale),
        y: finite(((node.y ?? 0) - centerY) * scale),
      },
    ]),
  );
}

function computeFastLayout(pageGraph: PageGraph, motion: MotionSettings) {
  const nodesByCluster = new Map<number, GraphNode[]>();
  for (const node of pageGraph.nodes) {
    const cluster = node.cluster < 0 ? 0 : node.cluster;
    const current = nodesByCluster.get(cluster) ?? [];
    current.push(node);
    nodesByCluster.set(cluster, current);
  }

  const clusterIds = [...nodesByCluster.keys()].sort((a, b) => a - b);
  const distanceScale = scaleControl(motion.linkDistance, 0.9, 1.45);
  const centerScale = scaleControl(motion.center, 0.8, 1.2);
  const centers = createClusterCenters(
    clusterIds,
    0.58 * distanceScale * centerScale,
    0.32 * distanceScale,
  );

  const layout = new Map<string, { x: number; y: number }>();
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (const clusterId of clusterIds) {
    const nodes = [...(nodesByCluster.get(clusterId) ?? [])].sort(
      (a, b) => b.degree - a.degree || a.title.localeCompare(b.title),
    );
    const center = centers.get(clusterId) ?? { x: 0, y: 0 };
    const clusterSpread = clamp(0.1 + Math.sqrt(nodes.length) * 0.01, 0.14, 0.52);

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const rank = index + 1;
      const angle =
        goldenAngle * rank + ((hashString(node.id) % 360) / 360) * Math.PI * 0.28;
      const spiral = Math.sqrt(rank / Math.max(1, nodes.length));
      const radial = clusterSpread * spiral;
      const localJitter = node.isGhost ? 0.016 : 0.006;

      layout.set(node.id, {
        x:
          center.x +
          Math.cos(angle) * radial +
          jitter(`${node.id}:x`, localJitter),
        y:
          center.y +
          Math.sin(angle) * radial +
          jitter(`${node.id}:y`, localJitter),
      });
    }
  }

  return layout;
}

function scaleControl(value: number, min: number, max: number) {
  return min + (max - min) * clamp(value, 0, 100) / 100;
}

function mix(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

function easeInOutCubic(value: number) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function cancelAnimationFrameSafe(ref: { current: number | null }) {
  if (ref.current === null) return;
  window.cancelAnimationFrame(ref.current);
  ref.current = null;
}

function nodeId(node: string | GraphNode) {
  return typeof node === "string" ? node : node.id;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function jitter(value: string, amount: number) {
  return ((hashString(value) % 1000) / 1000 - 0.5) * amount;
}

function createClusterCenters(
  clusterIds: number[],
  firstRingRadius: number,
  ringStep: number,
) {
  const centers = new Map<number, { x: number; y: number }>();
  if (clusterIds.length === 0) return centers;
  if (clusterIds.length === 1) {
    centers.set(clusterIds[0], { x: 0, y: 0 });
    return centers;
  }

  let cursor = 0;
  let ringIndex = 0;

  while (cursor < clusterIds.length) {
    const slots = ringIndex === 0 ? 1 : Math.max(6, ringIndex * 8);
    const radius = ringIndex === 0 ? 0 : firstRingRadius + (ringIndex - 1) * ringStep;
    const count = Math.min(slots, clusterIds.length - cursor);

    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      centers.set(clusterIds[cursor], {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
      cursor += 1;
    }

    ringIndex += 1;
  }

  return centers;
}

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(color: string) {
  const hex = color.startsWith("#") ? color.slice(1) : color;
  const normalized =
    hex.length === 3
      ? hex
          .split("")
          .map((part) => part + part)
          .join("")
      : hex;
  const value = Number.parseInt(normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgba(color: string, alpha: number) {
  const { r, g, b } = hexToRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
