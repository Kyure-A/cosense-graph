export type CosensePage = {
  id: string;
  title: string;
  links: string[];
  image?: string | null;
  updated?: number;
};

export type CosensePageDetail = {
  id: string;
  title: string;
  image?: string | null;
  updated?: number;
  descriptions: string[];
  lines: string[];
  tags: string[];
};

type CosenseSearchTitle = {
  id?: string;
  title?: string;
  links?: unknown;
  image?: string | null;
  updated?: number;
};

type CosensePageResponse = {
  id?: string;
  title?: string;
  image?: string | null;
  updated?: number;
  descriptions?: unknown;
  lines?: Array<{ text?: unknown }> | unknown;
};

export async function fetchCosensePages(project: string, signal?: AbortSignal) {
  const trimmedProject = project.trim();
  if (!trimmedProject) {
    throw new Error("Project name is required.");
  }

  const response = await fetch(
    `/cosense-api/pages/${encodeURIComponent(trimmedProject)}/search/titles`,
    { signal },
  );

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "This project is not public. Set COSENSE_COOKIE and restart the dev server.",
      );
    }
    if (response.status === 404) {
      throw new Error(`Project "${trimmedProject}" was not found.`);
    }
    throw new Error(`Cosense API returned ${response.status}.`);
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error("Cosense API returned an unexpected response.");
  }

  return payload
    .map(normalizePage)
    .filter((page): page is CosensePage => page !== null);
}

export async function fetchCosensePageDetail(
  project: string,
  title: string,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `/cosense-api/pages/${encodeURIComponent(project)}/${encodeURIComponent(title)}`,
    { signal },
  );

  if (!response.ok) {
    throw new Error(`Cosense page detail returned ${response.status}.`);
  }

  const payload = (await response.json()) as CosensePageResponse;
  return normalizePageDetail(payload);
}

function normalizePage(page: CosenseSearchTitle): CosensePage | null {
  if (!page || typeof page.title !== "string" || !page.title.trim()) {
    return null;
  }

  const links = Array.isArray(page.links)
    ? page.links
        .filter((link): link is string => typeof link === "string")
        .map((link) => link.trim())
        .filter(Boolean)
    : [];

  return {
    id: typeof page.id === "string" ? page.id : page.title,
    title: page.title,
    links,
    image: page.image ?? null,
    updated: typeof page.updated === "number" ? page.updated : undefined,
  };
}

function normalizePageDetail(page: CosensePageResponse): CosensePageDetail {
  const title = typeof page.title === "string" && page.title.trim() ? page.title : "Untitled";
  const descriptions = Array.isArray(page.descriptions)
    ? page.descriptions.filter((line): line is string => typeof line === "string")
    : [];
  const lines = Array.isArray(page.lines)
    ? page.lines
        .map((line) => (line && typeof line.text === "string" ? line.text : ""))
        .filter(Boolean)
    : [];
  const tags = [...extractTags(lines)];

  return {
    id: typeof page.id === "string" ? page.id : title,
    title,
    image: page.image ?? null,
    updated: typeof page.updated === "number" ? page.updated : undefined,
    descriptions,
    lines,
    tags,
  };
}

function extractTags(lines: string[]) {
  const tags = new Set<string>();
  for (const line of lines) {
    const matches = line.match(/(^|\s)#([^\s\]#]+)/g) ?? [];
    for (const match of matches) {
      const normalized = match.trim().replace(/^#/, "");
      if (normalized) {
        tags.add(normalized);
      }
    }
  }
  return tags;
}

export function cosensePageUrl(project: string, title: string) {
  return `https://cosen.se/${encodeURIComponent(project)}/${encodeURIComponent(title)}`;
}
