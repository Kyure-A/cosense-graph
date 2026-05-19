import {
  Braces,
  ExternalLink,
  Focus,
  Ghost,
  Loader2,
  Maximize2,
  Network,
  Play,
  Search,
  SlidersHorizontal,
  Sparkles,
  Tag,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  cosensePageUrl,
  fetchCosensePageDetail,
  fetchCosensePages,
  type CosensePage,
  type CosensePageDetail,
} from "./cosense";
import { GraphCanvas } from "./GraphCanvas";
import { buildGraph, filterGraph, normalizeTitle, topNodes } from "./graph";

const DEFAULT_PROJECT = "help-jp";

type PreviewState = {
  id: string;
  x: number;
  y: number;
};

export function App() {
  const initialProject = projectFromLocation();
  const [project, setProject] = useState(initialProject);
  const [loadedProject, setLoadedProject] = useState("");
  const [pages, setPages] = useState<CosensePage[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [hoveredId, setHoveredId] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [maxPages, setMaxPages] = useState(2000);
  const [minLinks, setMinLinks] = useState(0);
  const [centerForce, setCenterForce] = useState(56);
  const [repelForce, setRepelForce] = useState(58);
  const [linkForce, setLinkForce] = useState(52);
  const [linkDistance, setLinkDistance] = useState(48);
  const [includeGhosts, setIncludeGhosts] = useState(true);
  const [includeOrphans, setIncludeOrphans] = useState(true);
  const [showParticles, setShowParticles] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [animateVersion, setAnimateVersion] = useState(0);
  const [viewVersion, setViewVersion] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewState | undefined>();
  const [details, setDetails] = useState<Record<string, CosensePageDetail>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);
  const didAutoLoad = useRef(false);
  const pendingDetailIdsRef = useRef(new Set<string>());

  const baseGraph = useMemo(
    () =>
      buildGraph(pages, {
        maxPages,
        includeGhosts,
        includeOrphans,
        minLinks,
      }),
    [includeGhosts, includeOrphans, maxPages, minLinks, pages],
  );
  const graph = useMemo(() => filterGraph(baseGraph, query), [baseGraph, query]);

  const nodeById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );
  const allNodeById = useMemo(
    () => new Map(baseGraph.nodes.map((node) => [node.id, node])),
    [baseGraph.nodes],
  );

  const selectedNode = selectedId ? nodeById.get(selectedId) : undefined;
  const hoveredNode = hoveredId ? nodeById.get(hoveredId) : undefined;
  const activeNode = hoveredNode ?? selectedNode;
  const importantNodes = useMemo(() => topNodes(graph.nodes, 7), [graph.nodes]);
  const pageLimitMax = useMemo(
    () => roundUpLimit(Math.max(pages.length, 2000), 50000),
    [pages.length],
  );
  const pageLimitStep = pageLimitMax >= 20000 ? 500 : pageLimitMax >= 5000 ? 100 : 20;

  const matchedNodes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [];
    return baseGraph.nodes
      .filter((node) => node.title.toLocaleLowerCase().includes(normalized))
      .sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title))
      .slice(0, 28);
  }, [baseGraph.nodes, query]);

  const backlinksById = useMemo(() => {
    const pageIds = new Set(pages.map((page) => normalizeTitle(page.title)));
    const backlinks = new Map<string, string[]>();

    for (const page of pages) {
      const sourceId = normalizeTitle(page.title);
      for (const targetId of new Set(page.links.map(normalizeTitle))) {
        if (!pageIds.has(targetId)) continue;
        const current = backlinks.get(targetId) ?? [];
        current.push(sourceId);
        backlinks.set(targetId, current);
      }
    }

    return backlinks;
  }, [pages]);

  const activeBacklinks = useMemo(() => {
    if (!activeNode) return [];
    return (backlinksById.get(activeNode.id) ?? [])
      .map((id) => allNodeById.get(id))
      .filter((node): node is NonNullable<typeof node> => Boolean(node))
      .sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title))
      .slice(0, 10);
  }, [activeNode, allNodeById, backlinksById]);

  const previewNode = preview ? allNodeById.get(preview.id) : undefined;
  const activeDetail = activeNode ? details[activeNode.id] : undefined;
  const previewDetail = previewNode ? details[previewNode.id] : undefined;

  useEffect(() => {
    if (!selectedId || nodeById.has(selectedId)) return;
    setSelectedId(undefined);
  }, [nodeById, selectedId]);

  useEffect(() => {
    if (preview && !nodeById.has(preview.id)) {
      setPreview(undefined);
    }
  }, [nodeById, preview]);

  useEffect(() => {
    if (didAutoLoad.current) return;
    didAutoLoad.current = true;
    void loadProject(initialProject);
  }, []);

  async function loadProject(nextProject = project) {
    const trimmed = nextProject.trim();
    if (!trimmed) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(undefined);
    setSelectedId(undefined);
    setHoveredId(undefined);
    setPreview(undefined);
    setSettingsOpen(false);
    setDetails({});
    pendingDetailIdsRef.current.clear();

    try {
      const nextPages = await fetchCosensePages(trimmed, controller.signal);
      setPages(nextPages);
      setMaxPages(nextPages.length);
      setMinLinks(0);
      setIncludeGhosts(true);
      setShowParticles(false);
      setShowLabels(true);
      setIncludeOrphans(true);
      setFocusMode(false);
      setLoadedProject(trimmed);
      setProject(trimmed);
      setViewVersion((version) => version + 1);

      const url = new URL(window.location.href);
      url.pathname = `/${encodeURIComponent(trimmed)}`;
      url.searchParams.delete("project");
      window.history.replaceState({}, "", url);
    } catch (loadError) {
      if (controller.signal.aborted) return;
      setPages([]);
      setLoadedProject("");
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load Cosense pages.",
      );
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void loadProject(project);
  }

  function openNode(id: string) {
    const node = nodeById.get(id);
    if (!node || !loadedProject) return;
    window.open(cosensePageUrl(loadedProject, node.title), "_blank", "noopener");
  }

  useEffect(() => {
    if (!loadedProject) return;
    const requestedIds = [activeNode?.id, previewNode?.id].filter(
      (id): id is string => Boolean(id),
    );

    for (const id of requestedIds) {
      if (details[id] || pendingDetailIdsRef.current.has(id)) continue;
      const node = allNodeById.get(id);
      if (!node || node.isGhost) continue;

      pendingDetailIdsRef.current.add(id);
      void fetchCosensePageDetail(loadedProject, node.title)
        .then((detail) => {
          setDetails((current) => ({ ...current, [id]: detail }));
        })
        .catch(() => {})
        .finally(() => {
          pendingDetailIdsRef.current.delete(id);
        });
    }
  }, [activeNode?.id, allNodeById, details, loadedProject, previewNode?.id]);

  const previewStyle = useMemo(() => {
    if (!preview || typeof window === "undefined") return undefined;
    return {
      left: Math.min(preview.x + 18, window.innerWidth - 336),
      top: Math.min(preview.y + 18, window.innerHeight - 248),
    };
  }, [preview]);

  return (
    <main
      className={`app-shell ${activeNode ? "has-active-node" : ""} ${
        settingsOpen ? "has-open-settings" : ""
      }`}
    >
      <section className="graph-stage" aria-label="Cosense graph">
        <GraphCanvas
          graph={graph}
          motion={{
            center: centerForce,
            repel: repelForce,
            linkDistance,
            linkStrength: linkForce,
          }}
          selectedId={selectedId}
          matchedIds={matchedNodes.map((node) => node.id)}
          animateVersion={animateVersion}
          showParticles={showParticles}
          showLabels={showLabels}
          focusMode={focusMode}
          viewVersion={viewVersion}
          onSelect={setSelectedId}
          onHover={setHoveredId}
          onPreviewChange={setPreview}
          onOpenPage={openNode}
        />
      </section>

      <header className="top-dock" aria-label="project">
        <form className="project-command" onSubmit={handleSubmit}>
          <Network size={18} />
          <input
            aria-label="Project"
            value={project}
            onChange={(event) => setProject(event.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <button className="load-button" type="submit" title="Load" disabled={loading}>
            {loading ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
          </button>
        </form>

        <div className="stat-strip" aria-label="graph stats">
          <StatPill value={graph.stats.renderedNodes} label="nodes" />
          <StatPill value={graph.stats.renderedLinks} label="links" />
          <StatPill value={graph.stats.ghostNodes} label="refs" />
          <StatPill value={graph.stats.components} label="groups" />
        </div>
      </header>

      {error ? <p className="error-toast">{error}</p> : null}

      <button
        className={`mobile-settings-toggle ${settingsOpen ? "is-open" : ""}`}
        type="button"
        title="Settings"
        aria-label="Settings"
        aria-expanded={settingsOpen}
        aria-controls="graph-settings"
        onClick={() => setSettingsOpen((value) => !value)}
      >
        <SlidersHorizontal size={19} />
      </button>

      <div className="right-rail">
        <aside
          id="graph-settings"
          className={`settings-dock ${settingsOpen ? "is-open" : ""}`}
          aria-label="settings"
        >
          <div className="settings-header">
            <SectionTitle>Settings</SectionTitle>
            <button
              className="panel-close-button"
              type="button"
              title="Close"
              aria-label="Close settings"
              onClick={() => setSettingsOpen(false)}
            >
              <X size={16} />
            </button>
          </div>
          <label className="search-box">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter graph"
              spellCheck={false}
            />
          </label>

          {matchedNodes.length > 0 ? (
            <div className="search-results" aria-label="search results">
              {matchedNodes.slice(0, 6).map((node) => (
                <button
                  className="node-list-item"
                  key={node.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(node.id);
                    setSettingsOpen(false);
                  }}
                >
                  <span className="node-swatch" style={{ backgroundColor: node.color }} />
                  <span>{node.title}</span>
                  <strong>{node.degree}</strong>
                </button>
              ))}
            </div>
          ) : null}

          <div className="dock-section">
            <SectionTitle>Filters</SectionTitle>
            <div className="mini-sliders">
              <Slider
                id="max-pages"
                label="pages"
                value={maxPages}
                displayValue={Math.min(maxPages, pages.length || maxPages)}
                min={80}
                max={pageLimitMax}
                step={pageLimitStep}
                onChange={setMaxPages}
              />
              <Slider
                id="min-links"
                label="links"
                value={minLinks}
                displayValue={minLinks}
                min={0}
                max={8}
                step={1}
                onChange={setMinLinks}
              />
            </div>
          </div>

          <div className="dock-section">
            <SectionTitle>Forces</SectionTitle>
            <div className="mini-sliders">
              <Slider
                id="center-force"
                label="center"
                value={centerForce}
                displayValue={centerForce}
                min={0}
                max={100}
                step={1}
                onChange={setCenterForce}
              />
              <Slider
                id="repel-force"
                label="repel"
                value={repelForce}
                displayValue={repelForce}
                min={0}
                max={100}
                step={1}
                onChange={setRepelForce}
              />
              <Slider
                id="link-force"
                label="link"
                value={linkForce}
                displayValue={linkForce}
                min={0}
                max={100}
                step={1}
                onChange={setLinkForce}
              />
              <Slider
                id="link-distance"
                label="distance"
                value={linkDistance}
                displayValue={linkDistance}
                min={0}
                max={100}
                step={1}
                onChange={setLinkDistance}
              />
            </div>
          </div>

          <div className="dock-section">
            <SectionTitle>Display</SectionTitle>
            <div className="tool-grid" aria-label="graph tools">
              <IconToggle
                active={includeGhosts}
                icon={<Ghost size={16} />}
                label="refs"
                title="Referenced pages"
                onClick={() => setIncludeGhosts((value) => !value)}
              />
              <IconToggle
                active={showParticles}
                icon={<Sparkles size={16} />}
                label="flow"
                title="Link flow"
                onClick={() => setShowParticles((value) => !value)}
              />
              <IconToggle
                active={showLabels}
                icon={<Tag size={16} />}
                label="text"
                title="Labels"
                onClick={() => setShowLabels((value) => !value)}
              />
              <IconToggle
                active={focusMode}
                icon={<Focus size={16} />}
                label="focus"
                title="Focus mode"
                onClick={() => setFocusMode((value) => !value)}
              />
              <IconToggle
                active={includeOrphans}
                icon={<Braces size={16} />}
                label="orph"
                title="Orphan pages"
                onClick={() => setIncludeOrphans((value) => !value)}
              />
              <button
                className="tool-button"
                type="button"
                title="Animate"
                onClick={() => setAnimateVersion((version) => version + 1)}
              >
                <Play size={16} />
                <span>anim</span>
              </button>
              <button
                className="tool-button"
                type="button"
                title="Fit graph"
                onClick={() => setViewVersion((version) => version + 1)}
              >
                <Maximize2 size={16} />
                <span>fit</span>
              </button>
            </div>
          </div>
        </aside>

        <aside
          className={`inspector-dock ${activeNode ? "is-active" : "is-summary"}`}
          aria-label="selection"
        >
          {activeNode ? (
            <div className="page-detail">
              <div className="detail-kicker">
                <span
                  className="detail-swatch"
                  style={{ backgroundColor: activeNode.color }}
                />
                <span>{activeNode.isGhost ? "reference" : "page"}</span>
              </div>
              <h1>{activeNode.title}</h1>
              {activeNode.image ? (
                <img className="page-image" src={activeNode.image} alt="" loading="lazy" />
              ) : null}
              <div className="detail-stats">
                <Metric value={activeNode.degree} label="degree" />
                <Metric value={activeNode.incoming} label="in" />
                <Metric value={activeNode.outgoing} label="out" />
              </div>
              <div className="detail-actions">
                {activeNode.updated ? (
                  <span>
                    {new Date(activeNode.updated * 1000).toLocaleDateString("ja-JP")}
                  </span>
                ) : (
                  <span>{loadedProject || project}</span>
                )}
                <button
                  className="open-button"
                  type="button"
                  disabled={!loadedProject}
                  onClick={() => openNode(activeNode.id)}
                >
                  <ExternalLink size={17} />
                  <span>open</span>
                </button>
              </div>
              {activeDetail ? (
                <>
                  <InfoSection title="Overview">
                    <p className="detail-text">{detailExcerpt(activeDetail)}</p>
                  </InfoSection>
                  {activeDetail.tags.length > 0 ? (
                    <InfoSection title="Tags">
                      <div className="tag-list">
                        {activeDetail.tags.slice(0, 12).map((tag) => (
                          <span className="tag-chip" key={tag}>
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </InfoSection>
                  ) : null}
                </>
              ) : null}
              {activeBacklinks.length > 0 ? (
                <InfoSection title={`Backlinks (${activeBacklinks.length})`}>
                  <div className="node-list compact">
                    {activeBacklinks.map((node) => (
                      <button
                        className="node-list-item"
                        key={node.id}
                        type="button"
                        onClick={() => setSelectedId(node.id)}
                      >
                        <span className="node-swatch" style={{ backgroundColor: node.color }} />
                        <span>{node.title}</span>
                        <strong>{node.degree}</strong>
                      </button>
                    ))}
                  </div>
                </InfoSection>
              ) : null}
            </div>
          ) : (
            <div className="page-detail">
              <div className="detail-kicker">
                <span className="detail-swatch warm" />
                <span>{loadedProject || project}</span>
              </div>
              <h1>{graph.stats.pages.toLocaleString()} pages</h1>
              <div className="node-list">
                {importantNodes.map((node) => (
                  <button
                    className="node-list-item"
                    key={node.id}
                    type="button"
                    onClick={() => setSelectedId(node.id)}
                  >
                    <span className="node-swatch" style={{ backgroundColor: node.color }} />
                    <span>{node.title}</span>
                    <strong>{node.degree}</strong>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      <aside className="selection-summary" aria-label="summary">
        <div className="detail-kicker">
          <span className="detail-swatch warm" />
          <span>{loadedProject || project}</span>
        </div>
        <strong>{graph.stats.pages.toLocaleString()} pages</strong>
        <span>{graph.stats.renderedNodes.toLocaleString()} shown</span>
        <span>{graph.stats.renderedLinks.toLocaleString()} links</span>
        <span>{graph.stats.components.toLocaleString()} groups</span>
      </aside>

      {previewNode && previewDetail ? (
        <aside className="preview-dock" style={previewStyle} aria-label="preview">
          <div className="detail-kicker">
            <span className="detail-swatch" style={{ backgroundColor: previewNode.color }} />
            <span>preview</span>
          </div>
          <h2>{previewNode.title}</h2>
          <p>{detailExcerpt(previewDetail)}</p>
        </aside>
      ) : null}
    </main>
  );
}

function projectFromLocation() {
  const firstPathSegment = decodeURIComponent(
    window.location.pathname.split("/").filter(Boolean)[0] ?? "",
  ).trim();
  if (firstPathSegment && firstPathSegment !== "index.html") {
    return firstPathSegment;
  }

  return (
    new URLSearchParams(window.location.search).get("project")?.trim() ||
    DEFAULT_PROJECT
  );
}

function roundUpLimit(value: number, cap: number) {
  const bounded = Math.min(value, cap);
  if (bounded <= 2000) return 2000;
  if (bounded <= 5000) return Math.ceil(bounded / 100) * 100;
  if (bounded <= 20000) return Math.ceil(bounded / 500) * 500;
  return Math.ceil(bounded / 1000) * 1000;
}

function StatPill({ value, label }: { value: number; label: string }) {
  return (
    <div className="stat-pill">
      <strong>{value.toLocaleString()}</strong>
      <span>{label}</span>
    </div>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="metric">
      <strong>{value.toLocaleString()}</strong>
      <span>{label}</span>
    </div>
  );
}

function Slider({
  id,
  label,
  value,
  displayValue,
  min,
  max,
  step,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  displayValue: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="micro-slider" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>{displayValue}</output>
    </label>
  );
}

function IconToggle({
  active,
  icon,
  label,
  title,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`tool-button ${active ? "active" : ""}`}
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="section-title">{children}</div>;
}

function InfoSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="info-section">
      <SectionTitle>{title}</SectionTitle>
      {children}
    </section>
  );
}

function detailExcerpt(detail: CosensePageDetail) {
  const candidates = [...detail.descriptions, ...detail.lines.slice(1)]
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("[http"));
  return candidates.slice(0, 3).join(" ").slice(0, 240);
}
