type Env = {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  COSENSE_COOKIE?: string;
};

const API_ORIGIN = "https://scrapbox.io";

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/cosense-api/")) {
      return proxyCosenseApi(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function proxyCosenseApi(request: Request, env: Env) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: {
        allow: "GET, HEAD",
      },
    });
  }

  const requestUrl = new URL(request.url);
  const upstreamUrl = new URL(
    requestUrl.pathname.replace(/^\/cosense-api/, "/api") + requestUrl.search,
    API_ORIGIN,
  );
  const headers = new Headers();
  const accept = request.headers.get("accept");
  const ifNoneMatch = request.headers.get("if-none-match");

  if (accept) {
    headers.set("accept", accept);
  }
  if (ifNoneMatch) {
    headers.set("if-none-match", ifNoneMatch);
  }

  const cookie = cookieHeaderFromEnv(env.COSENSE_COOKIE);
  if (cookie) {
    headers.set("cookie", cookie);
  }

  const response = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    redirect: "follow",
  });
  const responseHeaders = new Headers(response.headers);

  responseHeaders.delete("set-cookie");
  responseHeaders.delete("content-length");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

function cookieHeaderFromEnv(value?: string) {
  if (!value) return undefined;
  if (value.includes("=") || value.includes(";")) return value;
  return `connect.sid=${value}`;
}
