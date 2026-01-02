import { serve } from "./deps.ts";
import { z } from "./deps.ts";
import MealimeAPI, { CsrfError } from "./mealime-api.ts";

const mealime = new MealimeAPI(
  Deno.env.get("MEALIME_EMAIL"),
  Deno.env.get("MEALIME_PASSWORD"),
);

const handlePostItem = async (request: Request): Promise<Response> => {
  try {
    await mealime.login();
  } catch (_e) {
    return new Response("Login failed", { status: 500 });
  }

  let query = "";

  try {
    const itemResult = z.object({
      item: z.string().min(1),
    }).safeParse(await request.json());

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

  // Health check for platform warm-up (no auth required)
  // Support GET + HEAD because some warmups use HEAD.
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    (path === "/" || path === "/health")
  ) {
    return new Response("ok", { status: 200 });
  }

  const expectedToken = Deno.env.get("TOKEN");
  if (!expectedToken) {
    console.error("TOKEN env var is missing");
    return new Response("Server misconfigured", { status: 500 });
  }

  const authHeader =
    request.headers.get("authorization") ?? request.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response("Not Authorized", { status: 401 });
  }

  const providedToken = authHeader.slice("Bearer ".length).trim();
  if (providedToken !== expectedToken) {
    return new Response("Not Authorized", { status: 401 });
  }

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

// Prefer PORT if provided by the platform; default 8000 for local/dev.
const port = Number.parseInt(Deno.env.get("PORT") ?? "8000", 10);

// IMPORTANT:
// Use "::" to bind IPv6-any (usually dual-stack). This fixes platforms probing localhost via ::1.
const hostnameCandidates = [
  Deno.env.get("HOSTNAME"),
  "::",
  "0.0.0.0",
].filter((v): v is string => Boolean(v));

let lastErr: unknown = null;

for (const hostname of hostnameCandidates) {
  try {
    console.log(`HTTP webserver starting on http://${hostname}:${port}/`);
    await serve(handler, { hostname, port });
    // serve() never returns; if it does, break.
    break;
  } catch (e) {
    lastErr = e;
    console.error(`Failed to bind on ${hostname}:${port}`, e);
  }
}

if (lastErr) {
  throw lastErr;
}
