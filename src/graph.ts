import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import type { CosensePage } from "./cosense";

export type GraphNode = SimulationNodeDatum & {
  id: string;
  title: string;
  pageId?: string;
  image?: string | null;
  updated?: number;
  outgoing: number;
  incoming: number;
  degree: number;
  radius: number;
  cluster: number;
  color: string;
  isGhost: boolean;
  links: string[];
};

export type GraphLink = SimulationLinkDatum<GraphNode> & {
  id: string;
  source: string | GraphNode;
  target: string | GraphNode;
  value: number;
};

export type PageGraph = {
  nodes: GraphNode[];
  links: GraphLink[];
  stats: {
    pages: number;
    renderedNodes: number;
    renderedLinks: number;
    ghostNodes: number;
    components: number;
  };
};

export type BuildGraphOptions = {
  maxPages: number;
  includeGhosts: boolean;
  includeOrphans: boolean;
  minLinks: number;
};

const PALETTE = [
  "#6f8bd4",
  "#8774cf",
  "#9f6fb1",
  "#5f93b7",
  "#5f9b87",
  "#b07c5f",
  "#7187ba",
  "#7d79aa",
  "#7a9965",
  "#a66b76",
];

export function buildGraph(
  pages: CosensePage[],
  options: BuildGraphOptions,
): PageGraph {
  const largeProject = pages.length >= 700 || options.maxPages >= 260;
  const hugeProject = pages.length >= 2400 || options.maxPages >= 700;
  const allByTitle = new Map<string, CosensePage>();
  for (const page of pages) {
    allByTitle.set(normalizeTitle(page.title), page);
  }

  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const page of pages) {
    const sourceTitle = normalizeTitle(page.title);
    const uniqueLinks = new Set(page.links.map(normalizeTitle));
    outgoing.set(sourceTitle, uniqueLinks.size);

    for (const link of uniqueLinks) {
      if (allByTitle.has(link)) {
        incoming.set(link, (incoming.get(link) ?? 0) + 1);
      }
    }
  }

  const scoredPages = [...pages].sort((a, b) => {
    const aTitle = normalizeTitle(a.title);
    const bTitle = normalizeTitle(b.title);
    const aScore = (incoming.get(aTitle) ?? 0) * 3 + (outgoing.get(aTitle) ?? 0);
    const bScore = (incoming.get(bTitle) ?? 0) * 3 + (outgoing.get(bTitle) ?? 0);
    if (bScore !== aScore) return bScore - aScore;
    return (b.updated ?? 0) - (a.updated ?? 0);
  });

  const selectedPages = scoredPages.slice(0, options.maxPages);
  const selectedByTitle = new Map<string, CosensePage>();
  for (const page of selectedPages) {
    selectedByTitle.set(normalizeTitle(page.title), page);
  }

  const pageScore = new Map<string, number>();
  for (const page of pages) {
    const title = normalizeTitle(page.title);
    pageScore.set(
      title,
      (incoming.get(title) ?? 0) * 4 +
        (outgoing.get(title) ?? 0) * 1.5 +
        ((page.updated ?? 0) / 1_000_000_000),
    );
  }

  const ghostInboundFromSelected = new Map<string, number>();
  for (const page of selectedPages) {
    const sourceId = normalizeTitle(page.title);
    for (const targetId of new Set(page.links.map(normalizeTitle))) {
      if (!targetId || targetId === sourceId || selectedByTitle.has(targetId)) continue;
      ghostInboundFromSelected.set(
        targetId,
        (ghostInboundFromSelected.get(targetId) ?? 0) + 1,
      );
    }
  }

  const allowedGhosts = new Set<string>();
  if (options.includeGhosts) {
    const ghostCap = hugeProject ? 96 : largeProject ? 180 : Number.POSITIVE_INFINITY;
    const rankedGhosts = [...ghostInboundFromSelected.entries()]
      .sort((a, b) => {
        const aScore = a[1] * 8 + (pageScore.get(a[0]) ?? 0);
        const bScore = b[1] * 8 + (pageScore.get(b[0]) ?? 0);
        if (bScore !== aScore) return bScore - aScore;
        return a[0].localeCompare(b[0]);
      })
      .slice(0, ghostCap);
    for (const [title] of rankedGhosts) {
      allowedGhosts.add(title);
    }
  }

  const nodes = new Map<string, GraphNode>();
  for (const page of selectedPages) {
    const id = normalizeTitle(page.title);
    nodes.set(id, {
      id,
      pageId: page.id,
      title: page.title,
      image: page.image,
      updated: page.updated,
      outgoing: 0,
      incoming: 0,
      degree: 0,
      radius: 7,
      cluster: 0,
      color: PALETTE[0],
      isGhost: false,
      links: page.links,
    });
  }

  const linkIds = new Set<string>();
  const links: GraphLink[] = [];

  for (const page of selectedPages) {
    const sourceId = normalizeTitle(page.title);
    const source = nodes.get(sourceId);
    if (!source) continue;

    const sortedTargets = [...new Set(page.links.map(normalizeTitle))]
      .filter((targetId) => targetId && targetId !== sourceId)
      .sort((a, b) => (pageScore.get(b) ?? 0) - (pageScore.get(a) ?? 0));
    const selectedTargets = sortedTargets.filter((targetId) => selectedByTitle.has(targetId));
    const ghostTargets = sortedTargets.filter((targetId) => !selectedByTitle.has(targetId));
    const cappedSelectedTargets = selectedTargets;
    const cappedGhostTargets = largeProject
      ? ghostTargets.slice(0, hugeProject ? 3 : 6)
      : ghostTargets;

    for (const rawTarget of [...cappedSelectedTargets, ...cappedGhostTargets]) {
      if (!rawTarget || rawTarget === sourceId) continue;

      let target = nodes.get(rawTarget);
      if (!target && options.includeGhosts) {
        if (!allowedGhosts.has(rawTarget)) continue;
        const pageOutsideLimit = allByTitle.get(rawTarget);
        target = {
          id: rawTarget,
          pageId: pageOutsideLimit?.id,
          title: pageOutsideLimit?.title ?? rawTarget,
          image: pageOutsideLimit?.image,
          updated: pageOutsideLimit?.updated,
          outgoing: 0,
          incoming: 0,
          degree: 0,
          radius: 5,
          cluster: -1,
          color: "#7c8798",
          isGhost: true,
          links: pageOutsideLimit?.links ?? [],
        };
        nodes.set(rawTarget, target);
      }

      if (!target || !nodes.has(rawTarget)) continue;

      const linkId = `${sourceId}→${rawTarget}`;
      if (linkIds.has(linkId)) continue;
      linkIds.add(linkId);
      links.push({
        id: linkId,
        source: sourceId,
        target: rawTarget,
        value: selectedByTitle.has(rawTarget) ? 1 : largeProject ? 0.28 : 0.45,
      });
    }
  }

  for (const link of links) {
    const sourceId = nodeId(link.source);
    const targetId = nodeId(link.target);
    const source = nodes.get(sourceId);
    const target = nodes.get(targetId);
    if (!source || !target) continue;
    source.outgoing += 1;
    source.degree += 1;
    target.incoming += 1;
    target.degree += 1;
  }

  for (const node of nodes.values()) {
    node.radius = node.isGhost
      ? 4.5
      : clamp(5.5 + Math.sqrt(node.degree) * 2.6, 6.5, 22);
  }

  const minDegree = Math.max(options.minLinks, options.includeOrphans ? 0 : 1);
  const visibleNodes = [...nodes.values()].filter(
    (node) => node.degree >= minDegree,
  );
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleLinks = links.filter(
    (link) =>
      visibleNodeIds.has(nodeId(link.source)) &&
      visibleNodeIds.has(nodeId(link.target)),
  );

  const components = assignComponents(visibleNodes, visibleLinks);

  return {
    nodes: visibleNodes,
    links: visibleLinks,
    stats: {
      pages: pages.length,
      renderedNodes: visibleNodes.length,
      renderedLinks: visibleLinks.length,
      ghostNodes: visibleNodes.filter((node) => node.isGhost).length,
      components,
    },
  };
}

export function filterGraph(pageGraph: PageGraph, query: string): PageGraph {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return pageGraph;

  const matchedIds = new Set(
    pageGraph.nodes
      .filter((node) => node.title.toLocaleLowerCase().includes(normalized))
      .map((node) => node.id),
  );

  if (matchedIds.size === 0) {
    return {
      nodes: [],
      links: [],
      stats: {
        ...pageGraph.stats,
        renderedNodes: 0,
        renderedLinks: 0,
        ghostNodes: 0,
        components: 0,
      },
    };
  }

  const keepIds = new Set<string>(matchedIds);
  for (const link of pageGraph.links) {
    const source = nodeId(link.source);
    const target = nodeId(link.target);
    if (matchedIds.has(source) || matchedIds.has(target)) {
      keepIds.add(source);
      keepIds.add(target);
    }
  }

  const nodes = pageGraph.nodes.filter((node) => keepIds.has(node.id));
  const links = pageGraph.links.filter(
    (link) => keepIds.has(nodeId(link.source)) && keepIds.has(nodeId(link.target)),
  );

  return {
    nodes,
    links,
    stats: {
      ...pageGraph.stats,
      renderedNodes: nodes.length,
      renderedLinks: links.length,
      ghostNodes: nodes.filter((node) => node.isGhost).length,
      components: countComponents(nodes, links),
    },
  };
}

export function normalizeTitle(title: string) {
  return title.trim().replace(/\s+/g, " ");
}

export function topNodes(nodes: GraphNode[], count = 8) {
  return [...nodes]
    .filter((node) => !node.isGhost)
    .sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title))
    .slice(0, count);
}

function countComponents(nodes: GraphNode[], links: GraphLink[]) {
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) {
    adjacency.set(node.id, new Set());
  }

  for (const link of links) {
    const source = nodeId(link.source);
    const target = nodeId(link.target);
    adjacency.get(source)?.add(target);
    adjacency.get(target)?.add(source);
  }

  let components = 0;
  const visited = new Set<string>();
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    components += 1;
    const stack = [node.id];
    visited.add(node.id);

    while (stack.length) {
      const current = stack.pop();
      if (!current) continue;
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }
  }

  return components;
}

function assignComponents(nodes: GraphNode[], links: GraphLink[]) {
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) {
    adjacency.set(node.id, new Set());
  }

  for (const link of links) {
    const source = nodeId(link.source);
    const target = nodeId(link.target);
    adjacency.get(source)?.add(target);
    adjacency.get(target)?.add(source);
  }

  const visited = new Set<string>();
  const components: string[][] = [];

  for (const node of nodes) {
    if (visited.has(node.id)) continue;

    const stack = [node.id];
    const group: string[] = [];
    visited.add(node.id);

    while (stack.length) {
      const current = stack.pop();
      if (!current) continue;
      group.push(current);

      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }

    components.push(group);
  }

  components.sort((a, b) => b.length - a.length);

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const largestComponentSize = components[0]?.length ?? 0;
  const shouldSplitLargest = largestComponentSize > PALETTE.length * 4;

  for (let index = 0; index < components.length; index += 1) {
    for (const id of components[index]) {
      const node = nodeById.get(id);
      if (!node) continue;

      const cluster =
        index === 0 && shouldSplitLargest
          ? hashString(`${node.title}:${node.degree}`) % PALETTE.length
          : index;

      node.cluster = cluster;
      node.color = node.isGhost ? "#7c8798" : PALETTE[cluster % PALETTE.length];
    }
  }

  return components.length;
}

function nodeId(node: string | GraphNode | number | undefined) {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  return node?.id ?? "";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}
