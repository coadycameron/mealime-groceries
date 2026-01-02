import { z } from "./deps.ts";
import MealimeAPI, { CsrfError } from "./mealime-api.ts";

// ---- helpers
const env = (key: string): string => {
  const v = Deno.env.get(key);
  return v ?? "";
};

const MEALIME_EMAIL = env("MEALIME_EMAIL");
const MEALIME_PASSWORD = env("MEALIME_PASSWORD");
const TOKEN = env("TOKEN");

// Keep the process booting even if env vars are missing, but make it obvious in logs.
if (!MEALIME_EMAIL || !MEALIME_PASSWORD) {
  console.warn("WARN: MEALIME_EMAIL / MEALIME_PASSWORD not set (Preview warmup may still pass, /add will fail)");
}
if (!TOKEN) {
  console.warn("WARN: TOKEN not set (Preview warmup may still pass, /add and /reset will be unauthorized)");
}

const mealime = new MealimeAPI(MEALIME_EMAIL, MEALIME_PASSWORD);

const handlePostItem = async (request: Request): Promise<Response> => {
  try {
    await mealime.login();
  } catch (e) {
    console.error("Login failed", e);
    return new Response("Login failed", { status: 500 });
  }

  let query = "";

  try {
    const itemResult = z.object({ item: z.string().min(1) }).safeParse(
      await request.json(),
    );

    if (!itemResult.success) {
      return new Response(itemResult.error.toString(), { status: 400 });
    }

    query = itemResult.data.item;
    const addResult = await mealime.addQuery(query);
    return new Response(addResult.result, { status: 200 });
  } catch (error) {
    if (error instanceof CsrfError || error instanceof Deno.errors.PermissionDenied) {
      try {
        console.log("Error while adding item, trying reset");
        await mealime.reset();
        const addResult = await mealime.addQuery(query);
        return new Response(addResult.result, { status: 200 });
      } catch (resetError) {
        console.error("Reset didn't work", resetError);
        return new Response("Reset didn't work", { status: 500 });
      }
    }

    console.error("Unexpected error", error);
    return new Response("Unexpected error", { status: 500 });
  }
};

const handler = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const path = url.pathname;

  // ---- Warmup/health: no auth required
  // Be generous: warmup probes vary (GET/HEAD, /, /health, /healthz).
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    (path === "/" || path === "/health" || path === "/healthz")
  ) {
    return new Response("ok", { status: 200 });
  }

  // ---- Auth
  const authHeader =
    request.headers.get("authorization") ?? request.headers.get("Authorization");

  if (!TOKEN) {
    return new Response("Server misconfigured", { status: 500 });
  }

  if (!authHeader) return new Response("Not Authorized", { status: 401 });

  // case-insensitive "Bearer "
  const lower = authHeader.toLowerCase();
  if (!lower.startsWith("bearer ")) return new Response("Not Authorized", { status: 401 });

  const providedToken = authHeader.slice("Bearer ".length).trim();
  if (providedToken !== TOKEN) return new Response("Not Authorized", { status: 401 });

  // ---- Routes
  if (request.method === "POST" && path === "/add") {
    return await handlePostItem(request);
  }

  if (request.method === "POST" && path === "/reset") {
    try {
      await mealime.reset();
      return new Response("OK", { status: 200 });
    } catch (error) {
      console.error("Error while resetting", error);
      return new Response("NOK", { status: 500 });
    }
  }

  return new Response("Not Found", { status: 404 });
};

// IMPORTANT: don’t force hostname (:: / 0.0.0.0). Let the platform bind correctly.
// Use PORT if provided; otherwise default to 8000.
const port = Number.parseInt(Deno.env.get("PORT") ?? "8000", 10);
console.log(`Starting server (port ${port})`);
Deno.serve({ port }, handler);
